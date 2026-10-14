# Unit tests for whole-site backup/restore (app/services/backup.py,
# app/api/routes/backups.py) — the parts that need no Mongo connection: what
# a backup file must look like to be accepted, the file-area copy and swap,
# who may run it, and which tokens it accepts. Role lookups are stubbed as in
# test_role_access.py.
import asyncio
import hashlib
import io
import json
import zipfile
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException

from app.api import deps
from app.core.config import settings
from app.core.security import create_access_token, create_purpose_token, decode_purpose_token
from app.models import SYSTEM_ROLE_ID, Section, UserRole
from app.services import backup, restore_epoch


def _entry(data: bytes) -> dict:
    return {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _write_backup(path, files: dict[str, bytes], **manifest_overrides) -> None:
    manifest = {
        "app": "handpikd",
        "format_version": backup.FORMAT_VERSION,
        "created_at": "2026-10-14T00:00:00+00:00",
        "database": "handpikd",
        "applied_migrations": [],
        "collections": {name[3:-5]: {"count": 0} for name in files if name.startswith("db/")},
        "files": {},
        "entries": {name: _entry(data) for name, data in files.items()},
    }
    manifest.update(manifest_overrides)
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
        archive.writestr("manifest.json", json.dumps(manifest))


@pytest.fixture
def no_migrations(monkeypatch):
    monkeypatch.setattr(backup, "known_migrations", lambda: {"migrate_known"})


def test_valid_backup_is_accepted(tmp_path, no_migrations):
    path = tmp_path / "b.zip"
    _write_backup(path, {"db/user.bson": b"", "media/catalogues/p1.png": b"png"})
    manifest = backup.read_manifest(path)
    assert backup.summarize(manifest)["collection_count"] == 1


@pytest.mark.parametrize(
    "entry",
    ["../evil", "media/../../evil", "/abs/path", "media\\evil", "db/system.users.bson", "db/x/y.bson", "media/.restore-old/x", "other/x", "C:evil"],
)
def test_unsafe_entries_are_refused(tmp_path, no_migrations, entry):
    path = tmp_path / "b.zip"
    _write_backup(path, {"db/user.bson": b"", entry: b"x"})
    with pytest.raises(backup.BackupError):
        backup.read_manifest(path)


def test_not_a_zip_is_refused(tmp_path, no_migrations):
    path = tmp_path / "b.zip"
    path.write_bytes(b"definitely not a zip")
    with pytest.raises(backup.BackupError, match="isn't a Handpikd backup"):
        backup.read_manifest(path)


def test_other_apps_zip_is_refused(tmp_path, no_migrations):
    path = tmp_path / "b.zip"
    _write_backup(path, {"db/user.bson": b""}, app="something-else")
    with pytest.raises(backup.BackupError, match="isn't a Handpikd backup"):
        backup.read_manifest(path)


def test_entries_must_match_manifest(tmp_path, no_migrations):
    path = tmp_path / "b.zip"
    _write_backup(path, {"db/user.bson": b""})
    with zipfile.ZipFile(path, "a") as archive:
        archive.writestr("media/smuggled.png", b"x")
    with pytest.raises(backup.BackupError, match="incomplete"):
        backup.read_manifest(path)


def test_backup_from_newer_code_is_refused(tmp_path, no_migrations):
    path = tmp_path / "b.zip"
    _write_backup(path, {"db/user.bson": b""}, applied_migrations=["migrate_known", "migrate_from_the_future"])
    with pytest.raises(backup.BackupError, match="newer version"):
        backup.read_manifest(path)


def test_registered_migrations_are_known():
    # The real runner loads, and its registry is what the newer-code check uses.
    assert "migrate_price_list_pdf_path_to_file_path" in backup.known_migrations()


def test_checksum_mismatch_is_caught(tmp_path, no_migrations):
    path = tmp_path / "b.zip"
    _write_backup(path, {"db/user.bson": b"", "media/a.png": b"original"})
    # Rewrite with different bytes but the original manifest.
    with zipfile.ZipFile(path) as archive:
        manifest = archive.read("manifest.json")
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("db/user.bson", b"")
        archive.writestr("media/a.png", b"tampered")
        archive.writestr("manifest.json", manifest)
    with pytest.raises(backup.BackupError, match="damaged"):
        backup.verify_backup(path, backup.Job(kind="restore"))


def test_extract_and_swap_replace_each_area_exactly(tmp_path, monkeypatch, no_migrations):
    media, private = tmp_path / "media", tmp_path / "private"
    monkeypatch.setitem(backup.FILE_AREAS, "media", lambda: media)
    monkeypatch.setitem(backup.FILE_AREAS, "private", lambda: private)
    monkeypatch.setattr(settings, "backup_root", str(tmp_path / "backups"))
    (media / "catalogues").mkdir(parents=True)
    (media / "stale.png").write_bytes(b"not in the backup")
    (media / "catalogues" / "old.png").write_bytes(b"old")
    private.mkdir()

    path = tmp_path / "b.zip"
    _write_backup(path, {"db/user.bson": b"", "media/catalogues/p1.png": b"p1", "media/a.png": b"a", "private/price_lists/x.pdf": b"pdf"})
    manifest = backup.read_manifest(path)
    with zipfile.ZipFile(path) as archive:
        backup._extract_files(archive, manifest, backup.Job(kind="restore"))
    # Extracting alone changes nothing live.
    assert (media / "stale.png").exists()

    backup._swap_in_files()
    files = {p.relative_to(tmp_path).as_posix(): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file() and "b.zip" not in p.name}
    assert files == {"media/catalogues/p1.png": b"p1", "media/a.png": b"a", "private/price_lists/x.pdf": b"pdf"}


def test_area_listing_skips_restore_folders(tmp_path):
    (tmp_path / ".restore-staging").mkdir()
    (tmp_path / ".restore-staging" / "x").write_bytes(b"x")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "y.png").write_bytes(b"y")
    assert [rel for _, rel in backup._iter_area_files(tmp_path)] == ["sub/y.png"]


@pytest.mark.parametrize("name", ["../x.zip", "x.zip/../../y.zip", ".hidden.zip", "x.txt", "a/b.zip"])
def test_backup_names_are_checked(name):
    with pytest.raises(backup.BackupNotFoundError):
        backup.backup_path(name)


def test_relative_storage_is_refused_without_opt_in(monkeypatch):
    monkeypatch.setattr(settings, "allow_local_media_uploads", False)
    monkeypatch.setattr(settings, "media_root", "media")
    with pytest.raises(backup.BackupError, match="only run on the server"):
        backup.ensure_server_paths()


def test_server_keeps_one_backup(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "backup_root", str(tmp_path))
    for name in ("handpikd-backup-1.zip", "uploaded-2.zip", "handpikd-backup-3-pre-restore.zip"):
        (tmp_path / name).write_bytes(b"zip")
    # In-flight work isn't a backup yet and must survive.
    (tmp_path / ".handpikd-backup-4.zip.partial").write_bytes(b"partial")
    (tmp_path / ".upload-abc.part").write_bytes(b"part")

    backup._keep_only("uploaded-2.zip")

    assert sorted(p.name for p in tmp_path.iterdir()) == [".handpikd-backup-4.zip.partial", ".upload-abc.part", "uploaded-2.zip"]


def test_completing_an_upload_waits_for_a_running_job(monkeypatch):
    monkeypatch.setattr(backup, "_active_job", backup.Job(kind="restore"))
    with pytest.raises(backup.BackupBusyError):
        backup.finish_upload("0" * 32)


def _utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def test_daily_run_is_at_the_set_india_time(monkeypatch):
    monkeypatch.setattr(settings, "backup_daily_time", "02:00")
    # 02:00 IST is 20:30 UTC the previous day.
    assert backup.next_daily_run(_utc(2026, 10, 14, 12, 0)) == _utc(2026, 10, 14, 20, 30)
    # Exactly on time, or just after, means tomorrow's.
    assert backup.next_daily_run(_utc(2026, 10, 14, 20, 30)) == _utc(2026, 10, 15, 20, 30)
    assert backup.next_daily_run(_utc(2026, 10, 14, 20, 31)) == _utc(2026, 10, 15, 20, 30)


def test_daily_run_crosses_month_ends(monkeypatch):
    monkeypatch.setattr(settings, "backup_daily_time", "23:45")
    # 23:45 IST on 31 Oct is 18:15 UTC; just after it, the next is 1 Nov.
    assert backup.next_daily_run(_utc(2026, 10, 31, 18, 16)) == _utc(2026, 11, 1, 18, 15)


@pytest.mark.parametrize("value", ["2am", "25:00", "02:60", ""])
def test_malformed_daily_time_falls_back_to_2am(monkeypatch, value):
    monkeypatch.setattr(settings, "backup_daily_time", value)
    assert backup.daily_time() == (2, 0)


def test_daily_backup_is_off_locally(monkeypatch):
    monkeypatch.setattr(settings, "allow_local_media_uploads", False)
    monkeypatch.setattr(settings, "media_root", "media")
    assert backup.daily_backup_enabled() is False


def test_backup_kinds():
    assert backup.backup_kind("handpikd-backup-20261014-203000-daily.zip") == "daily"
    assert backup.backup_kind("uploaded-20261014-120000.zip") == "uploaded"
    assert backup.backup_kind("handpikd-backup-20261014-120000-pre-restore.zip") == "pre_restore"
    assert backup.backup_kind("handpikd-backup-20261014-120000.zip") == "manual"


# --- tokens -----------------------------------------------------------------


class _Credentials:
    def __init__(self, token: str) -> None:
        self.credentials = token


def test_download_token_is_not_a_login():
    token = create_purpose_token(1, "backup_download", "x.zip")
    with pytest.raises(HTTPException) as caught:
        asyncio.run(deps._user_from_credentials(_Credentials(token)))
    assert caught.value.status_code == 401


def test_login_token_is_not_a_download_token():
    with pytest.raises(jwt.InvalidTokenError):
        decode_purpose_token(create_access_token(1, "admin"), "backup_download")


def test_tokens_from_before_a_restore_are_refused(monkeypatch):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(restore_epoch, "_restored_at", now)
    before = int((now - timedelta(minutes=5)).timestamp())
    after = int((now + timedelta(seconds=5)).timestamp())
    assert restore_epoch.token_predates_restore({"iat": before})
    assert restore_epoch.token_predates_restore({})
    assert not restore_epoch.token_predates_restore({"iat": after})

    monkeypatch.setattr(restore_epoch, "_restored_at", None)
    assert not restore_epoch.token_predates_restore({})


# --- who may run it -----------------------------------------------------------


class _StubUser:
    def __init__(self, role_ids: list[int]) -> None:
        self.id = 7
        self.role = UserRole.admin
        self.role_ids = role_ids
        self.is_active = True


class _StubRole:
    def __init__(self, sections, is_system=False) -> None:
        self.sections = sections
        self.is_system = is_system


def test_only_the_administrator_role_may_back_up(monkeypatch):
    roles = {SYSTEM_ROLE_ID: _StubRole([], is_system=True), 2: _StubRole(list(Section))}

    async def fake_get(role_id):
        return roles.get(role_id)

    monkeypatch.setattr(deps.Role, "get", fake_get)
    admin = _StubUser([SYSTEM_ROLE_ID])
    assert asyncio.run(deps.require_administrator(current_user=admin)) is admin

    # Even a custom role ticked with every section is not enough.
    with pytest.raises(HTTPException) as caught:
        asyncio.run(deps.require_administrator(current_user=_StubUser([2])))
    assert caught.value.status_code == 403


def test_every_backup_route_but_two_requires_the_administrator():
    from fastapi.routing import APIRoute

    from app.api.routes import backups

    open_routes = set()
    for route in backups.router.routes:
        assert isinstance(route, APIRoute)
        if not any(dep.call is deps.require_administrator for dep in route.dependant.dependencies):
            open_routes.add(route.path)
    assert open_routes == {"/admin/backups/jobs/{job_id}", "/admin/backups/download/{name}"}
