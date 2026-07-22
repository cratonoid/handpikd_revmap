# Health-check endpoints used to verify the API and MongoDB connection are reachable.
from fastapi import APIRouter

from app.core.db import get_db

router = APIRouter(prefix="/test", tags=["test"])


@router.get("/")
def read_test():
    return {"status": "ok", "message": "FastAPI backend is up and running"}


@router.get("/ping")
def ping():
    return {"ping": "pong"}


@router.get("/db-ping")
async def db_ping():
    db = get_db()
    result = await db.command("ping")
    return {"mongodb": result}
