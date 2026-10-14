# Backup & restore module: whole-site backups an Administrator can create,
# download, upload and restore from /admin/backups. What a backup holds and
# how a restore stays safe is in app/services/backup.py's header.
#
# Every endpoint is Administrator-only (require_administrator) except two,
# each guarded another way:
#   - GET /jobs/{job_id}: a restore signs everybody out partway through (see
#     services/restore_epoch.py), including the admin watching it, so its
#     progress has to stay readable without a login. The job id is a random
#     128-bit value only the starter was given, and the status holds nothing
#     beyond progress text and backup file names.
#   - GET /download/{name}: authorized by a short-lived link token instead of
#     the Authorization header, so the browser can stream a multi-GB file
#     straight to disk rather than through fetch() into memory.
#
# Uploads come in chunks (start, PUT each chunk at its offset, complete):
# backups run to gigabytes, past nginx's per-request limit, and a dropped
# connection then costs one chunk instead of the whole upload. A PUT whose
# offset doesn't match what the server holds gets a 409 carrying the right
# offset, so the client resumes from there.
import asyncio

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse

from app.api.deps import get_allowed_sections, require_administrator
from app.core.config import settings
from app.core.security import create_purpose_token, decode_purpose_token
from app.models import User
from app.schemas.backups import (
    BackupItem,
    BackupJobStatus,
    BackupNameRequest,
    BackupSchedule,
    DownloadLinkResponse,
    MessageResponse,
    RestoreRequest,
    StartUploadResponse,
    UploadChunkResponse,
)
from app.services import backup
from app.services.backup import BackupBusyError, BackupError, BackupNotFoundError, Job

router = APIRouter(prefix="/admin/backups", tags=["backups"])

_DOWNLOAD_PURPOSE = "backup_download"
# Well under nginx's 400M limit on /api/ (deploy/nginx.conf).
UPLOAD_CHUNK_SIZE = 32 * 1024 * 1024
_MAX_CHUNK_SIZE = 2 * UPLOAD_CHUNK_SIZE


def _http_error(error: BackupError) -> HTTPException:
    if isinstance(error, BackupNotFoundError):
        code = status.HTTP_404_NOT_FOUND
    elif isinstance(error, BackupBusyError):
        code = status.HTTP_409_CONFLICT
    else:
        code = status.HTTP_400_BAD_REQUEST
    return HTTPException(status_code=code, detail=str(error))


def _job_status(job: Job) -> BackupJobStatus:
    return BackupJobStatus(
        id=job.id,
        kind=job.kind,
        state=job.state,
        phase=job.phase,
        done=job.done,
        total=job.total,
        error=job.error,
        backup_name=job.backup_name,
        safety_backup_name=job.safety_backup_name,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


@router.get("", response_model=list[BackupItem])
async def get_backups(_: User | None = Depends(require_administrator)) -> list[dict]:
    return await asyncio.to_thread(backup.list_backups)


@router.get("/schedule", response_model=BackupSchedule)
async def get_schedule(_: User | None = Depends(require_administrator)) -> BackupSchedule:
    daily = backup.daily_status
    hour, minute = backup.daily_time()
    return BackupSchedule(
        enabled=backup.daily_backup_enabled(),
        time=f"{hour:02d}:{minute:02d}",
        next_run_at=daily.next_run_at,
        last_run_at=daily.last_run_at,
        last_succeeded=daily.last_succeeded,
        last_error=daily.last_error,
    )


@router.post("/create", response_model=BackupJobStatus)
async def create_backup(_: User | None = Depends(require_administrator)) -> BackupJobStatus:
    try:
        return _job_status(backup.start_backup_job())
    except BackupError as error:
        raise _http_error(error)


# Lets the page pick a running job back up after a reload. Declared before
# /jobs/{job_id} so "active" isn't taken for a job id.
@router.get("/jobs/active", response_model=BackupJobStatus | None)
async def get_active_job(_: User | None = Depends(require_administrator)) -> BackupJobStatus | None:
    job = backup.get_active_job()
    return _job_status(job) if job else None


@router.get("/jobs/{job_id}", response_model=BackupJobStatus)
async def get_job(job_id: str) -> BackupJobStatus:
    job = backup.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    return _job_status(job)


@router.post("/download_link", response_model=DownloadLinkResponse)
async def create_download_link(
    body: BackupNameRequest, current_user: User | None = Depends(require_administrator)
) -> DownloadLinkResponse:
    try:
        backup.backup_path(body.name)
    except BackupError as error:
        raise _http_error(error)
    token = create_purpose_token(current_user.id if current_user else None, _DOWNLOAD_PURPOSE, body.name)
    return DownloadLinkResponse(path=f"/admin/backups/download/{body.name}?token={token}")


@router.get("/download/{name}")
async def download_backup(name: str, token: str = Query(...)) -> FileResponse:
    forbidden = HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This download link is invalid or has expired.")
    try:
        payload = decode_purpose_token(token, _DOWNLOAD_PURPOSE)
    except jwt.PyJWTError:
        raise forbidden
    if payload.get("subject") != name:
        raise forbidden

    # Re-checked at download time: the link must stop working for someone
    # who has since been disabled or lost the Administrator role.
    user_id = payload.get("uid")
    if user_id is None:
        if settings.auth_enabled:
            raise forbidden
    else:
        user = await User.get(int(user_id))
        if user is None or not user.is_active or await get_allowed_sections(user) is not None:
            raise forbidden

    try:
        path = backup.backup_path(name)
    except BackupError as error:
        raise _http_error(error)
    # FileResponse answers Range requests, so an interrupted download of a
    # large backup can be resumed by the browser.
    return FileResponse(path, media_type="application/zip", filename=name)


@router.post("/delete", response_model=MessageResponse)
async def delete_backup(body: BackupNameRequest, _: User | None = Depends(require_administrator)) -> MessageResponse:
    try:
        await asyncio.to_thread(backup.delete_backup, body.name)
    except BackupError as error:
        raise _http_error(error)
    return MessageResponse(message="Backup deleted")


@router.post("/uploads", response_model=StartUploadResponse)
async def start_upload(_: User | None = Depends(require_administrator)) -> StartUploadResponse:
    try:
        backup.ensure_server_paths()
    except BackupError as error:
        raise _http_error(error)
    return StartUploadResponse(upload_id=backup.start_upload(), chunk_size=UPLOAD_CHUNK_SIZE)


@router.put("/uploads/{upload_id}", response_model=UploadChunkResponse)
async def upload_chunk(
    upload_id: str,
    request: Request,
    offset: int = Query(..., ge=0),
    _: User | None = Depends(require_administrator),
):
    try:
        path = backup.upload_part_path(upload_id)
    except BackupError as error:
        raise _http_error(error)

    received = path.stat().st_size
    if offset != received:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "offset doesn't match the bytes received so far", "received": received},
        )

    written = 0
    with path.open("ab") as out:
        async for chunk in request.stream():
            written += len(chunk)
            if written > _MAX_CHUNK_SIZE:
                out.truncate(received)
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="chunk too large")
            out.write(chunk)
    return UploadChunkResponse(received=received + written)


@router.post("/uploads/{upload_id}/complete", response_model=BackupItem)
async def complete_upload(upload_id: str, _: User | None = Depends(require_administrator)) -> dict:
    try:
        name = await asyncio.to_thread(backup.finish_upload, upload_id)
        items = await asyncio.to_thread(backup.list_backups)
    except BackupError as error:
        raise _http_error(error)
    return next(item for item in items if item["name"] == name)


@router.post("/uploads/{upload_id}/cancel", response_model=MessageResponse)
async def cancel_upload(upload_id: str, _: User | None = Depends(require_administrator)) -> MessageResponse:
    try:
        backup.cancel_upload(upload_id)
    except BackupNotFoundError:
        pass
    return MessageResponse(message="Upload cancelled")


@router.post("/restore", response_model=BackupJobStatus)
async def restore_backup(body: RestoreRequest, _: User | None = Depends(require_administrator)) -> BackupJobStatus:
    if body.confirm != "RESTORE":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Type RESTORE to confirm.')
    try:
        # Its up-front checks read only the zip's directory and manifest, so
        # they're quick enough to run inline; the restore itself runs as a job.
        return _job_status(backup.start_restore_job(body.name))
    except BackupError as error:
        raise _http_error(error)
