# Aggregates all route modules into a single router mounted by app/main.py.
from fastapi import APIRouter

from app.api.routes import admin, auth, authentication, categories, test

api_router = APIRouter()
api_router.include_router(test.router)
api_router.include_router(auth.router)
api_router.include_router(authentication.router)
api_router.include_router(admin.router)
api_router.include_router(categories.router)
