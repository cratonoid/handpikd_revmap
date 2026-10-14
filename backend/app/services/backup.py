# Whole-site backup and restore: one .zip holding everything the site knows
# that isn't code, so a fresh server running this repo can be loaded with it
# and come up exactly like the one it was taken from.
#
# WHAT'S IN A BACKUP
# ------------------
#   manifest.json         format version, when/what was copied, the applied
#                         data migrations, and a SHA-256 for every entry
#   db/<collection>.bson  every collection in the database, as raw BSON — the
#                         exact bytes Mongo holds, so dates, binary data
#                         (email attachments, the logo) and number types come
#                         back unchanged, which JSON could not promise
#   db/indexes.json       each collection's index definitions
#   media/...             settings.media_root: product/catalogue images, the
#                         signature (served publicly at /media)
#   private/...           settings.purchase_invoice_root: vendor invoice PDFs
#                         and price lists (never public)
#
# Deliberately NOT included: backend/.env (secrets are per-server
# configuration, and keeping them out means a leaked backup leaks no
# passwords or API keys), the code (git), TLS certificates (certbot reissues
# them) and catalogue PDF staging (scratch, see catalogue_pdf_staging.py).
#
# HOW A RESTORE STAYS SAFE
# ------------------------
# Nothing live is touched until the whole backup has been checked and put in
# place alongside the current data:
#   1. every entry's checksum is verified;
#   2. the current data is itself backed up ("...-pre-restore.zip"), so a
#      restore can always be undone by restoring that;
#   3. the API answers 503 to everything else (see main.py) so nobody writes
#      to half-restored data;
#   4. collections are loaded into <name>__restore_tmp and files extracted to
#      a .restore-staging folder — still nothing live has changed, and a
#      failure here only cleans those up;
#   5. only then are the collections renamed over the live ones and the file
#      folders swapped, both fast metadata operations;
#   6. pending data migrations, init_beanie and the startup backfills run
#      (core/db.py's reinitialize_after_restore), so a backup from an older
#      release is brought up to this code's shape;
#   7. every login from before the restore is ended (restore_epoch.py).
#
# ONE BACKUP ON THE SERVER
# -----------------------
# The server holds a single backup at a time (_keep_only). A new backup or
# upload replaces the previous one, which is deleted only once its
# replacement is complete and checked, so a failed attempt never leaves
# nothing behind. After a successful restore the file kept is the
# pre-restore copy, the one way back; the file restored from goes, since its
# contents are now the live data. A restore that fails before changing
# anything drops its pre-restore copy instead and keeps the original. Only a
# restore that fails after the switch-over keeps both: the undo, and the
# file to retry from.
#
# DAILY BACKUP
# ------------
# daily_backup_loop (started from main.py's lifespan) takes a backup every
# day at settings.backup_daily_time, India time, and it replaces the
# server's one backup like any other. If the server was down at that time,
# a backup older than a day is caught up shortly after startup instead of
# waiting for the next night. A day whose backup can't start because another
# job is running retries for an hour, then gives up until the next day.
#
# The heavy lifting runs in a worker thread with its own synchronous Mongo
# client, so the event loop keeps answering progress polls throughout. Only
# one backup or restore runs at a time, which holds because the app is a
# single backend process (docker-compose.yml).
import asyncio
import hashlib
import importlib.util
import json
import logging
import os
import re
import shutil
import time
import uuid
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bson
from bson import json_util
from bson.codec_options import CodecOptions
from bson.raw_bson import RawBSONDocument
from pymongo import MongoClient

from app.core.config import settings

logger = logging.getLogger(__name__)

FORMAT_VERSION = 1
APP_TAG = "handpikd"
MANIFEST_NAME = "manifest.json"
INDEXES_NAME = "db/indexes.json"

# Each file area: the folder name inside the zip -> the folder on disk.
FILE_AREAS: dict[str, Callable[[], Path]] = {
    "media": lambda: Path(settings.media_root),
    "private": lambda: Path(settings.purchase_invoice_root),
}

GENERATED_PREFIX = "handpikd-backup-"
UPLOADED_PREFIX = "uploaded-"
PRE_RESTORE_SUFFIX = "-pre-restore"
DAILY_SUFFIX = "-daily"

# India has no daylight saving, so a fixed offset is exact (same approach as
# routes/authentication.py's IST).
IST = timezone(timedelta(hours=5, minutes=30))

_STAGING_DIR = ".restore-staging"
_OLD_DIR = ".restore-old"
_RESTORE_TMP_SUFFIX = "__restore_tmp"
_UPLOAD_TTL_SECONDS = 24 * 60 * 60
_COPY_CHUNK = 1024 * 1024
_INSERT_BATCH_BYTES = 8 * 1024 * 1024
_INSERT_BATCH_DOCS = 1000

# Documents are copied as RawBSONDocument both ways: never decoded into
# Python and re-encoded, so what's restored is byte-for-byte what was read.
_RAW = CodecOptions(document_class=RawBSONDocument)

# Names reach these functions from the client, so they're matched against
# the exact shapes this module issues before being joined onto a path.
_BACKUP_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$")
_UPLOAD_ID = re.compile(r"^[0-9a-f]{32}$")
_COLLECTION_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,200}$")


class BackupError(RuntimeError):
    """A backup or restore problem, worded for the admin who will read it."""


class BackupNotFoundError(BackupError):
    pass


class BackupBusyError(BackupError):
    pass


# ---------------------------------------------------------------------------
# Jobs: one backup or restore at a time, polled by the admin page
# ---------------------------------------------------------------------------


@dataclass
class Job:
    kind: str  # "backup" | "restore"
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    state: str = "running"  # "running" | "succeeded" | "failed"
    phase: str = "Starting"
    done: int = 0
    total: int = 0
    error: str | None = None
    # The backup written (a backup job) or restored from (a restore job).
    backup_name: str | None = None
    # A restore's automatic copy of the data it replaced.
    safety_backup_name: str | None = None
    # Set once a restore starts swapping live data; until then a failure
    # has changed nothing.
    live_data_changed: bool = False
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    finished_at: datetime | None = None

    def set_phase(self, phase: str, total: int = 0) -> None:
        self.phase = phase
        self.done = 0
        self.total = total


_jobs: dict[str, Job] = {}
_active_job: Job | None = None
_tasks: set[asyncio.Task] = set()
_restore_in_progress = False


def restore_in_progress() -> bool:
    return _restore_in_progress


def get_job(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def get_active_job() -> Job | None:
    return _active_job if _active_job is not None and _active_job.state == "running" else None


def _claim(kind: str) -> Job:
    global _active_job
    if get_active_job() is not None:
        raise BackupBusyError("Another backup or restore is already running. Wait for it to finish.")
    job = Job(kind=kind)
    _jobs[job.id] = job
    _active_job = job
    return job


def _finish(job: Job, error: str | None = None) -> None:
    job.state = "failed" if error else "succeeded"
    job.error = error
    job.finished_at = datetime.now(timezone.utc)


def _spawn(coroutine) -> None:
    # Held in a set so the task isn't garbage-collected mid-run.
    task = asyncio.create_task(coroutine)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def _describe(error: Exception) -> str:
    if isinstance(error, BackupError):
        return str(error)
    return f"Unexpected error: {type(error).__name__}: {error}"


# ---------------------------------------------------------------------------
# Paths and names
# ---------------------------------------------------------------------------


def ensure_server_paths() -> None:
    """Refuse to run against local-dev storage.

    Same guard as storage.py's uploads: this project's local .env points
    MONGODB_URI at the shared production database while the file roots are
    relative local folders. A local backup would pair production data with
    this laptop's files, and a local restore would overwrite the live
    database. ALLOW_LOCAL_MEDIA_UPLOADS is the same explicit opt-in, for
    someone who has pointed MONGODB_URI at a database of their own.
    """
    if settings.allow_local_media_uploads:
        return
    if all(root().is_absolute() for root in FILE_AREAS.values()):
        return
    raise BackupError(
        "Backup and restore only run on the server. Locally, MONGODB_URI points at the "
        "shared production database while files live in local folders, so a backup "
        "would be incomplete and a restore would overwrite the live site."
    )


def backup_root() -> Path:
    root = Path(settings.backup_root)
    root.mkdir(parents=True, exist_ok=True)
    return root


def backup_path(name: str) -> Path:
    if not _BACKUP_NAME.fullmatch(name):
        raise BackupNotFoundError("Backup not found.")
    path = backup_root() / name
    if not path.is_file():
        raise BackupNotFoundError("Backup not found.")
    return path


def backup_kind(name: str) -> str:
    if name.startswith(UPLOADED_PREFIX):
        return "uploaded"
    if name.removesuffix(".zip").endswith(PRE_RESTORE_SUFFIX):
        return "pre_restore"
    if name.removesuffix(".zip").endswith(DAILY_SUFFIX):
        return "daily"
    return "manual"


def _gigabytes(size: int) -> str:
    return f"{size / 1024**3:.1f} GB"


def _check_free_space(folder: Path, needed: int, what: str) -> None:
    # 5% headroom: the estimate is a sum of file sizes, not of the blocks the
    # filesystem will actually allocate.
    free = shutil.disk_usage(folder).free
    if needed * 1.05 > free:
        raise BackupError(
            f"Not enough disk space to {what}: about {_gigabytes(needed)} is needed but only "
            f"{_gigabytes(free)} is free. Delete old backups or free up space on the server."
        )


def _iter_area_files(root: Path):
    """(path on disk, path relative to root in POSIX form) for every file."""
    if not root.is_dir():
        return
    skip = {Path(settings.backup_root).resolve()}
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        dirnames[:] = sorted(
            d
            for d in dirnames
            if not (here == root and d in (_STAGING_DIR, _OLD_DIR)) and (here / d).resolve() not in skip
        )
        for filename in sorted(filenames):
            path = here / filename
            if path.is_symlink() or not path.is_file():
                continue
            yield path, path.relative_to(root).as_posix()


# ---------------------------------------------------------------------------
# Migrations (scripts/run_migrations.py)
# ---------------------------------------------------------------------------

_migration_runner = None


def _load_migration_runner():
    # Loaded by path, as run_migrations.py loads its own migrations: scripts/
    # isn't a package, and sits beside app/ both here and in the image.
    global _migration_runner
    if _migration_runner is None:
        path = Path(__file__).resolve().parents[2] / "scripts" / "run_migrations.py"
        spec = importlib.util.spec_from_file_location("_handpikd_run_migrations", path)
        if spec is None or spec.loader is None:
            raise BackupError(f"Migration runner not found at {path}.")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _migration_runner = module
    return _migration_runner


def known_migrations() -> set[str]:
    return {name for name, *_ in _load_migration_runner().MIGRATIONS}


async def apply_pending_migrations(db) -> None:
    await _load_migration_runner().apply_pending(db)


# ---------------------------------------------------------------------------
# Reading and checking a backup file
# ---------------------------------------------------------------------------


def _check_entry_name(name: str) -> None:
    if name in (MANIFEST_NAME, INDEXES_NAME):
        return
    parts = name.split("/")
    unsafe = name.startswith("/") or "\\" in name or ":" in name or any(p in ("", ".", "..") for p in parts)
    if not unsafe and parts[0] == "db" and len(parts) == 2 and parts[1].endswith(".bson"):
        collection = parts[1].removesuffix(".bson")
        if _COLLECTION_NAME.fullmatch(collection) and not collection.startswith("system."):
            return
    if not unsafe and parts[0] in FILE_AREAS and len(parts) >= 2 and parts[1] not in (_STAGING_DIR, _OLD_DIR):
        return
    raise BackupError(f"This backup file contains an unexpected entry ({name!r}), so it won't be restored.")


def read_manifest(path: Path, check_migrations: bool = True) -> dict:
    """The backup's manifest, after the quick structural checks.

    Reads only the zip's directory and manifest, so it's fast even on a
    multi-GB file; the checksums are verified separately (verify_backup),
    as the first step of a restore.
    """
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            if MANIFEST_NAME not in names:
                raise BackupError("This isn't a Handpikd backup file (it has no manifest).")
            manifest = json.loads(archive.read(MANIFEST_NAME))
    except zipfile.BadZipFile:
        raise BackupError("This isn't a Handpikd backup file (it isn't a valid zip, or it's incomplete).")
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise BackupError("This backup file's manifest is damaged.")

    if not isinstance(manifest, dict) or manifest.get("app") != APP_TAG:
        raise BackupError("This isn't a Handpikd backup file.")
    if manifest.get("format_version") != FORMAT_VERSION:
        raise BackupError(
            f"This backup uses format version {manifest.get('format_version')}, but this version of "
            f"the site reads version {FORMAT_VERSION}. Deploy the matching version of the code first."
        )

    entries = manifest.get("entries")
    collections = manifest.get("collections")
    if not isinstance(entries, dict) or not isinstance(collections, dict):
        raise BackupError("This backup file's manifest is damaged.")
    for name in names | set(entries):
        _check_entry_name(name)
    if set(entries) != names - {MANIFEST_NAME}:
        raise BackupError("This backup file is incomplete: its contents don't match its manifest.")
    for collection in collections:
        if f"db/{collection}.bson" not in entries:
            raise BackupError("This backup file is incomplete: a database collection is missing.")

    if check_migrations:
        unknown = set(manifest.get("applied_migrations") or []) - known_migrations()
        if unknown:
            raise BackupError(
                "This backup was made by a newer version of the site than the one running here "
                f"(it includes data updates this version doesn't know: {', '.join(sorted(unknown))}). "
                "Deploy the latest code first, then restore."
            )
    return manifest


def verify_backup(path: Path, job: Job) -> dict:
    """read_manifest, plus every entry's size and checksum."""
    manifest = read_manifest(path)
    entries: dict[str, dict] = manifest["entries"]
    job.set_phase("Checking the backup file", total=len(entries))
    with zipfile.ZipFile(path) as archive:
        for name, expected in entries.items():
            digest = hashlib.sha256()
            size = 0
            try:
                with archive.open(name) as stream:
                    while chunk := stream.read(_COPY_CHUNK):
                        digest.update(chunk)
                        size += len(chunk)
            except (zipfile.BadZipFile, OSError, EOFError):
                raise BackupError(f"This backup file is damaged ({name} can't be read).")
            if size != expected.get("size") or digest.hexdigest() != expected.get("sha256"):
                raise BackupError(f"This backup file is damaged ({name} doesn't match its checksum).")
            job.done += 1
    return manifest


def summarize(manifest: dict) -> dict:
    collections = manifest["collections"]
    return {
        "created_at": manifest.get("created_at"),
        "database": manifest.get("database"),
        "collection_count": len(collections),
        "document_count": sum(int(c.get("count", 0)) for c in collections.values()),
        "media_file_count": int(manifest.get("files", {}).get("media", 0)),
        "private_file_count": int(manifest.get("files", {}).get("private", 0)),
        "content_bytes": int(manifest.get("content_bytes", 0)),
    }


def list_backups() -> list[dict]:
    root = backup_root()
    _purge_stale_uploads(root)
    items = []
    for path in sorted(root.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True):
        if not _BACKUP_NAME.fullmatch(path.name):
            continue
        stat = path.stat()
        item = {
            "name": path.name,
            "kind": backup_kind(path.name),
            "size": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc),
            "summary": None,
            "problem": None,
        }
        try:
            item["summary"] = summarize(read_manifest(path))
        except BackupError as error:
            item["problem"] = str(error)
        items.append(item)
    return items


def delete_backup(name: str) -> None:
    backup_path(name).unlink()


# ---------------------------------------------------------------------------
# Writing a backup
# ---------------------------------------------------------------------------


def _zip_info(name: str, compress_type: int) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=time.localtime()[:6])
    info.compress_type = compress_type
    # rw-r--r--, so an unzip by hand doesn't produce unreadable files.
    info.external_attr = 0o644 << 16
    return info


def write_backup(job: Job, suffix: str = "", label: str = "Copying") -> str:
    """Write a new backup into backup_root and return its file name."""
    ensure_server_paths()
    root = backup_root()
    created_at = datetime.now(timezone.utc)
    name = f"{GENERATED_PREFIX}{created_at:%Y%m%d-%H%M%S}{suffix}.zip"
    # Written under a dot-name list_backups ignores, and renamed only once
    # complete, so a half-written backup is never offered for download.
    partial = root / f".{name}.partial"

    client = MongoClient(settings.mongodb_uri)
    try:
        db = client[settings.mongodb_db_name]
        collections = sorted(
            n
            for n in db.list_collection_names(filter={"type": "collection"})
            if not n.startswith("system.") and not n.endswith(_RESTORE_TMP_SUFFIX)
        )
        area_files = {area: list(_iter_area_files(root_of())) for area, root_of in FILE_AREAS.items()}

        file_bytes = sum(path.stat().st_size for files in area_files.values() for path, _ in files)
        data_bytes = int(db.command("dbStats").get("dataSize", 0))
        _check_free_space(root, file_bytes + data_bytes, "create a backup")

        entries: dict[str, dict] = {}
        counts: dict[str, dict] = {}
        indexes: dict[str, list] = {}

        with zipfile.ZipFile(partial, "w", allowZip64=True) as archive:
            job.set_phase(f"{label} the database", total=len(collections))
            for collection_name in collections:
                collection = db.get_collection(collection_name, codec_options=_RAW)
                entry = f"db/{collection_name}.bson"
                digest = hashlib.sha256()
                size = count = 0
                with archive.open(_zip_info(entry, zipfile.ZIP_DEFLATED), "w", force_zip64=True) as out:
                    for document in collection.find({}):
                        raw = document.raw
                        out.write(raw)
                        digest.update(raw)
                        size += len(raw)
                        count += 1
                entries[entry] = {"size": size, "sha256": digest.hexdigest()}
                counts[collection_name] = {"count": count}
                indexes[collection_name] = [dict(spec) for spec in collection.list_indexes()]
                job.done += 1

            index_bytes = json_util.dumps(indexes, json_options=json_util.CANONICAL_JSON_OPTIONS).encode()
            archive.writestr(_zip_info(INDEXES_NAME, zipfile.ZIP_DEFLATED), index_bytes)
            entries[INDEXES_NAME] = {"size": len(index_bytes), "sha256": hashlib.sha256(index_bytes).hexdigest()}

            job.set_phase(f"{label} files", total=sum(len(files) for files in area_files.values()))
            file_counts = {}
            for area, files in area_files.items():
                file_counts[area] = 0
                for path, relative in files:
                    entry = f"{area}/{relative}"
                    digest = hashlib.sha256()
                    size = 0
                    try:
                        source = path.open("rb")
                    except FileNotFoundError:
                        # Deleted since the folder was listed — e.g. an image
                        # replaced while the backup ran. Nothing points at it.
                        job.done += 1
                        continue
                    # Stored, not compressed: images and PDFs already are.
                    with source, archive.open(_zip_info(entry, zipfile.ZIP_STORED), "w", force_zip64=True) as out:
                        while chunk := source.read(_COPY_CHUNK):
                            out.write(chunk)
                            digest.update(chunk)
                            size += len(chunk)
                    entries[entry] = {"size": size, "sha256": digest.hexdigest()}
                    file_counts[area] += 1
                    job.done += 1

            applied = []
            if "schema_migrations" in collections:
                applied = sorted(doc["_id"] for doc in db["schema_migrations"].find({}, {"_id": 1}))

            manifest = {
                "app": APP_TAG,
                "format_version": FORMAT_VERSION,
                "created_at": created_at.isoformat(),
                "database": settings.mongodb_db_name,
                "applied_migrations": applied,
                "collections": counts,
                "files": file_counts,
                "content_bytes": sum(e["size"] for e in entries.values()),
                "entries": entries,
            }
            archive.writestr(_zip_info(MANIFEST_NAME, zipfile.ZIP_DEFLATED), json.dumps(manifest, indent=1))

        os.replace(partial, root / name)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    finally:
        client.close()

    return name


def _keep_only(*names: str | None) -> None:
    """Delete every backup on the server except `names` (see the header)."""
    keep = {name for name in names if name}
    for path in backup_root().glob("*.zip"):
        if path.name not in keep:
            path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Uploading a backup (in chunks — see routes/backups.py)
# ---------------------------------------------------------------------------


def _upload_path(upload_id: str) -> Path:
    return backup_root() / f".upload-{upload_id}.part"


def _purge_stale_uploads(root: Path) -> None:
    cutoff = time.time() - _UPLOAD_TTL_SECONDS
    for part in root.glob(".upload-*.part"):
        try:
            if part.stat().st_mtime < cutoff:
                part.unlink(missing_ok=True)
        except OSError:
            pass


def start_upload() -> str:
    upload_id = uuid.uuid4().hex
    _upload_path(upload_id).touch()
    return upload_id


def upload_part_path(upload_id: str) -> Path:
    if not _UPLOAD_ID.fullmatch(upload_id):
        raise BackupNotFoundError("Upload not found.")
    path = _upload_path(upload_id)
    if not path.is_file():
        raise BackupNotFoundError("Upload not found. It may have expired; start the upload again.")
    return path


def cancel_upload(upload_id: str) -> None:
    upload_part_path(upload_id).unlink(missing_ok=True)


def finish_upload(upload_id: str) -> str:
    # Completing replaces the server's backup, which mustn't happen under a
    # restore reading from it.
    if get_active_job() is not None:
        raise BackupBusyError("Wait for the running backup or restore to finish, then upload again.")
    part = upload_part_path(upload_id)
    try:
        read_manifest(part)
    except BackupError:
        part.unlink(missing_ok=True)
        raise
    name = f"{UPLOADED_PREFIX}{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.zip"
    os.replace(part, backup_root() / name)
    _keep_only(name)
    return name


# ---------------------------------------------------------------------------
# Restoring
# ---------------------------------------------------------------------------


def _create_index(collection, spec: dict) -> None:
    spec = dict(spec)
    keys = list(spec.pop("key").items())
    for server_only in ("v", "ns", "background"):
        spec.pop(server_only, None)
    collection.create_index(keys, **spec)


def _load_collections(db, archive: zipfile.ZipFile, manifest: dict, job: Job) -> list[str]:
    names = list(manifest["collections"])
    indexes = json_util.loads(archive.read(INDEXES_NAME)) if INDEXES_NAME in manifest["entries"] else {}
    job.set_phase("Loading the database", total=len(names))
    for name in names:
        temp = db[name + _RESTORE_TMP_SUFFIX]
        temp.drop()
        # Created explicitly so an empty collection still exists to rename.
        db.create_collection(temp.name)
        batch: list[RawBSONDocument] = []
        batch_bytes = 0
        with archive.open(f"db/{name}.bson") as stream:
            for document in bson.decode_file_iter(stream, codec_options=_RAW):
                batch.append(document)
                batch_bytes += len(document.raw)
                if batch_bytes >= _INSERT_BATCH_BYTES or len(batch) >= _INSERT_BATCH_DOCS:
                    temp.insert_many(batch)
                    batch, batch_bytes = [], 0
        if batch:
            temp.insert_many(batch)
        for spec in indexes.get(name, []):
            if spec.get("name") != "_id_":
                _create_index(temp, spec)
        job.done += 1
    return names


def _extract_files(archive: zipfile.ZipFile, manifest: dict, job: Job) -> None:
    entries: dict[str, dict] = manifest["entries"]
    by_area = {area: [e for e in entries if e.startswith(f"{area}/")] for area in FILE_AREAS}

    for area, root_of in FILE_AREAS.items():
        root = root_of()
        root.mkdir(parents=True, exist_ok=True)
        _check_free_space(root, sum(entries[e]["size"] for e in by_area[area]), "unpack the backup's files")

    job.set_phase("Unpacking files", total=sum(len(v) for v in by_area.values()))
    for area, root_of in FILE_AREAS.items():
        staging = root_of() / _STAGING_DIR
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir()
        resolved_staging = staging.resolve()
        for entry in by_area[area]:
            target = staging.joinpath(*entry.split("/")[1:])
            # Belt and braces behind _check_entry_name: never write outside.
            if not target.resolve().is_relative_to(resolved_staging):
                raise BackupError(f"This backup file contains an unsafe path ({entry!r}).")
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open("wb") as out:
                shutil.copyfileobj(source, out, _COPY_CHUNK)
            job.done += 1


def _swap_in_files() -> None:
    keep = {_STAGING_DIR, _OLD_DIR}
    backups = Path(settings.backup_root).resolve()
    for root_of in FILE_AREAS.values():
        root = root_of()
        staging, old = root / _STAGING_DIR, root / _OLD_DIR
        shutil.rmtree(old, ignore_errors=True)
        old.mkdir()
        # Moves, not copies: staging sits inside the same folder, so every
        # rename stays on one filesystem (the bind-mounted volume) and is
        # instant whatever the size.
        for child in list(root.iterdir()):
            if child.name not in keep and child.resolve() != backups:
                os.replace(child, old / child.name)
        for child in list(staging.iterdir()):
            os.replace(child, root / child.name)
        shutil.rmtree(staging, ignore_errors=True)
        shutil.rmtree(old, ignore_errors=True)


def _cleanup_staging(db) -> None:
    for name in db.list_collection_names():
        if name.endswith(_RESTORE_TMP_SUFFIX):
            db.drop_collection(name)
    for root_of in FILE_AREAS.values():
        shutil.rmtree(root_of() / _STAGING_DIR, ignore_errors=True)


def restore_data(path: Path, manifest: dict, job: Job) -> None:
    """Steps 4 and 5 of the header: stage everything, then swap it in."""
    client = MongoClient(settings.mongodb_uri)
    try:
        db = client[settings.mongodb_db_name]
        try:
            with zipfile.ZipFile(path) as archive:
                names = _load_collections(db, archive, manifest, job)
                _extract_files(archive, manifest, job)
        except BaseException:
            _cleanup_staging(db)
            raise

        job.set_phase("Switching over to the restored data")
        job.live_data_changed = True
        for name in names:
            db[name + _RESTORE_TMP_SUFFIX].rename(name, dropTarget=True)
        # Whatever the backup didn't have goes, so the result matches it
        # exactly rather than being a merge of the two.
        restored = set(names)
        for name in db.list_collection_names(filter={"type": "collection"}):
            if name not in restored and not name.startswith("system."):
                db.drop_collection(name)
        _swap_in_files()
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Entry points used by routes/backups.py
# ---------------------------------------------------------------------------


def start_backup_job(suffix: str = "") -> Job:
    ensure_server_paths()
    job = _claim("backup")

    async def run() -> None:
        try:
            job.backup_name = await asyncio.to_thread(write_backup, job, suffix)
            await asyncio.to_thread(_keep_only, job.backup_name)
            _finish(job)
        except Exception as error:
            logger.exception("backup failed")
            _finish(job, _describe(error))

    _spawn(run())
    return job


def start_restore_job(name: str) -> Job:
    from app.core.db import reinitialize_after_restore
    from app.services.restore_epoch import mark_restored

    ensure_server_paths()
    path = backup_path(name)
    read_manifest(path)
    job = _claim("restore")
    job.backup_name = name

    async def run() -> None:
        global _restore_in_progress
        try:
            manifest = await asyncio.to_thread(verify_backup, path, job)
            job.safety_backup_name = await asyncio.to_thread(
                write_backup, job, PRE_RESTORE_SUFFIX, "Saving a copy of"
            )
            _restore_in_progress = True
            try:
                await asyncio.to_thread(restore_data, path, manifest, job)
                job.set_phase("Updating the restored data to this version")
                await reinitialize_after_restore()
                await mark_restored()
            finally:
                _restore_in_progress = False
            await asyncio.to_thread(_keep_only, job.safety_backup_name)
            _finish(job)
        except Exception as error:
            logger.exception("restore failed")
            message = _describe(error)
            if not job.live_data_changed:
                message += " Nothing was changed: the site still has the data it had before."
                _keep_only(name)
            elif job.safety_backup_name:
                message += (
                    f" The data as it was before this restore is saved as {job.safety_backup_name} — "
                    "restore that to go back."
                )
            _finish(job, message)

    _spawn(run())
    return job


# ---------------------------------------------------------------------------
# Daily backup (see the header)
# ---------------------------------------------------------------------------

_STARTUP_DELAY_SECONDS = 10 * 60
_BUSY_RETRY_SECONDS = 10 * 60
_BUSY_RETRIES = 6
_CATCH_UP_AFTER = timedelta(hours=25)


@dataclass
class DailyStatus:
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    last_succeeded: bool | None = None
    last_error: str | None = None


daily_status = DailyStatus()


def daily_time() -> tuple[int, int]:
    """settings.backup_daily_time as (hour, minute); 02:00 if it's malformed."""
    try:
        hour, minute = (int(part) for part in settings.backup_daily_time.split(":"))
        if 0 <= hour < 24 and 0 <= minute < 60:
            return hour, minute
    except ValueError:
        pass
    logger.warning("BACKUP_DAILY_TIME %r isn't HH:MM; using 02:00", settings.backup_daily_time)
    return 2, 0


def next_daily_run(now: datetime) -> datetime:
    """The next scheduled time strictly after `now` (aware), in UTC."""
    hour, minute = daily_time()
    local_now = now.astimezone(IST)
    candidate = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= local_now:
        candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc)


def daily_backup_enabled() -> bool:
    if not settings.backup_daily_enabled:
        return False
    try:
        ensure_server_paths()
    except BackupError:
        # Local dev: no backups at all, scheduled or otherwise.
        return False
    return True


def _newest_backup_age(now: datetime) -> timedelta | None:
    times = [p.stat().st_mtime for p in backup_root().glob("*.zip")]
    if not times:
        return None
    return now - datetime.fromtimestamp(max(times), timezone.utc)


async def _run_daily_backup() -> None:
    daily_status.last_run_at = datetime.now(timezone.utc)
    for attempt in range(_BUSY_RETRIES + 1):
        try:
            job = start_backup_job(DAILY_SUFFIX)
            break
        except BackupBusyError:
            if attempt == _BUSY_RETRIES:
                daily_status.last_succeeded = False
                daily_status.last_error = "Skipped: another backup or restore was running for over an hour."
                return
            await asyncio.sleep(_BUSY_RETRY_SECONDS)
        except BackupError as error:
            daily_status.last_succeeded = False
            daily_status.last_error = str(error)
            return

    while job.state == "running":
        await asyncio.sleep(5)
    daily_status.last_succeeded = job.state == "succeeded"
    daily_status.last_error = job.error
    if job.error:
        logger.error("daily backup failed: %s", job.error)


async def daily_backup_loop() -> None:
    if not daily_backup_enabled():
        return

    now = datetime.now(timezone.utc)
    daily_status.next_run_at = next_daily_run(now)
    # Caught up after a delay, so a restart mid-deploy settles first.
    age = _newest_backup_age(now)
    if age is None or age > _CATCH_UP_AFTER:
        await asyncio.sleep(_STARTUP_DELAY_SECONDS)
        await _run_daily_backup()

    while True:
        now = datetime.now(timezone.utc)
        daily_status.next_run_at = next_daily_run(now)
        await asyncio.sleep((daily_status.next_run_at - now).total_seconds())
        try:
            await _run_daily_backup()
        except asyncio.CancelledError:
            raise
        except Exception:
            # Never let one bad night stop every night after it.
            logger.exception("daily backup crashed")
