# Aggregates all route modules into a single router mounted by app/main.py.
from fastapi import APIRouter

from app.api.routes import auth, test

api_router = APIRouter()
api_router.include_router(test.router)
api_router.include_router(auth.router)
