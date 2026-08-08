# FastAPI application entrypoint: wires up middleware, routers, and the MongoDB lifespan hook.
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.core.db import close_mongo_connection, connect_to_mongo
from app.services.pdf_renderer import start_browser, stop_browser


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_to_mongo()
    # Started once here rather than per-request (see pdf_renderer.py) — a
    # headless Chromium launch takes ~1-2s, so every quotation PDF reuses
    # this one already-running browser instead of paying that cost each time.
    await start_browser()
    yield
    await stop_browser()
    await close_mongo_connection()


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)

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
