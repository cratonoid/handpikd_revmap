# Aggregates all route modules into a single router mounted by app/main.py.
from fastapi import APIRouter

from app.api.routes import test

api_router = APIRouter()
api_router.include_router(test.router)
