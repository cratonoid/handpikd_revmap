# Aggregates all route modules into a single router mounted by app/main.py.
from fastapi import APIRouter

from app.api.routes import (
    accounts,
    admin,
    analytics,
    auth,
    authentication,
    catalogues,
    categories,
    inquiry_form,
    inventory,
    invoices,
    orders,
    personal_details,
    printing_orders,
    printing_purchase_invoices,
    product_inquiries,
    products,
    purchase_invoices,
    quotations,
    sales_orders,
    test,
    vendors,
)

api_router = APIRouter()
api_router.include_router(test.router)
api_router.include_router(auth.router)
api_router.include_router(authentication.router)
api_router.include_router(admin.router)
api_router.include_router(analytics.router)
api_router.include_router(accounts.router)
api_router.include_router(categories.router)
api_router.include_router(vendors.router)
api_router.include_router(products.router)
api_router.include_router(products.public_router)
api_router.include_router(catalogues.router)
api_router.include_router(catalogues.public_router)
api_router.include_router(inquiry_form.router)
api_router.include_router(inquiry_form.public_router)
api_router.include_router(product_inquiries.router)
api_router.include_router(product_inquiries.public_router)
api_router.include_router(orders.router)
api_router.include_router(sales_orders.router)
api_router.include_router(inventory.router)
api_router.include_router(personal_details.router)
api_router.include_router(invoices.router)
api_router.include_router(purchase_invoices.router)
api_router.include_router(printing_orders.router)
api_router.include_router(printing_purchase_invoices.router)
api_router.include_router(quotations.router)
