# Aggregates all route modules into a single router mounted by app/main.py.
from fastapi import APIRouter

from app.api.routes import (
    admin,
    auth,
    authentication,
    categories,
    inventory,
    orders,
    products,
    sales_orders,
    test,
    vendors,
)

api_router = APIRouter()
api_router.include_router(test.router)
api_router.include_router(auth.router)
api_router.include_router(authentication.router)
api_router.include_router(admin.router)
api_router.include_router(categories.router)
api_router.include_router(vendors.router)
api_router.include_router(products.router)
api_router.include_router(orders.router)
api_router.include_router(sales_orders.router)
api_router.include_router(inventory.router)
