# FastAPI application entrypoint: wires up middleware, routers, and the MongoDB lifespan hook.
import asyncio
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.core.db import close_mongo_connection, connect_to_mongo
from app.services.backup import daily_backup_loop, restore_in_progress
from app.services.email_bounces import bounce_check_loop
from app.services.pdf_renderer import start_browser, stop_browser


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_to_mongo()
    # Started once here rather than per-request (see pdf_renderer.py) — a
    # headless Chromium launch takes ~1-2s, so every quotation PDF reuses
    # this one already-running browser instead of paying that cost each time.
    await start_browser()
    # Looks for bounce reports in the Titan inbox every few minutes (see
    # services/email_bounces.py); a no-op until SMTP_USER/SMTP_PASSWORD are set.
    bounce_task = asyncio.create_task(bounce_check_loop())
    # Takes the automatic daily backup (see services/backup.py); a no-op
    # locally, where backups are refused.
    backup_task = asyncio.create_task(daily_backup_loop())
    yield
    for task in (bounce_task, backup_task):
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    await stop_browser()
    await close_mongo_connection()


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)

# While a restore swaps the database and files out (see
# app/services/backup.py), every other API call is turned away, so nobody
# reads or writes half-restored data. The restore's own progress poll is the
# one exception. Registered before CORSMiddleware so CORS still wraps it.
_RESTORE_PROGRESS_PATH = f"{settings.api_v1_prefix}/admin/backups/jobs/"


@app.middleware("http")
async def refuse_requests_during_restore(request: Request, call_next):
    path = request.url.path
    if restore_in_progress() and path.startswith(settings.api_v1_prefix) and not path.startswith(_RESTORE_PROGRESS_PATH):
        return JSONResponse(
            status_code=503,
            content={"detail": "The site is being restored from a backup. Try again in a few minutes."},
        )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)

# Serves uploaded product images (see app/services/storage.py) at the same
# "/media" path storage.py bakes into stored image_path values.
Path(settings.media_root).mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.media_root), name="media")


@app.get("/")
def root():
    return {"message": f"{settings.app_name} is running"}
