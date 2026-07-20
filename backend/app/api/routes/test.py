from fastapi import APIRouter

router = APIRouter(prefix="/test", tags=["test"])


@router.get("/")
def read_test():
    return {"status": "ok", "message": "FastAPI backend is up and running"}


@router.get("/ping")
def ping():
    return {"ping": "pong"}
