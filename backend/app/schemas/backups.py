# Request/response bodies for the backup and restore endpoints
# (routes/backups.py). Upload chunks are raw request bodies, not JSON.
from datetime import datetime

from pydantic import BaseModel


class BackupSummary(BaseModel):
    created_at: str | None
    database: str | None
    collection_count: int
    document_count: int
    media_file_count: int
    private_file_count: int
    content_bytes: int


class BackupItem(BaseModel):
    name: str
    kind: str  # "manual" | "daily" | "pre_restore" | "uploaded"
    size: int
    modified_at: datetime
    # None when the file couldn't be read as a backup; `problem` says why.
    summary: BackupSummary | None
    problem: str | None


class BackupNameRequest(BaseModel):
    name: str


class RestoreRequest(BaseModel):
    name: str
    # Must be exactly "RESTORE" — typed by the admin, not set by the page.
    confirm: str


class BackupJobStatus(BaseModel):
    id: str
    kind: str  # "backup" | "restore"
    state: str  # "running" | "succeeded" | "failed"
    phase: str
    done: int
    total: int
    error: str | None
    backup_name: str | None
    safety_backup_name: str | None
    started_at: datetime
    finished_at: datetime | None


class BackupSchedule(BaseModel):
    enabled: bool
    time: str  # "HH:MM", India time
    next_run_at: datetime | None
    last_run_at: datetime | None
    last_succeeded: bool | None
    last_error: str | None


class DownloadLinkResponse(BaseModel):
    # Relative to the API base (e.g. /api/v1); valid for a few minutes.
    path: str


class StartUploadResponse(BaseModel):
    upload_id: str
    chunk_size: int


class UploadChunkResponse(BaseModel):
    received: int


class MessageResponse(BaseModel):
    message: str
