# Schema for the #sales_orders collection.
from datetime import datetime

from beanie import Document


class SalesOrders(Document):
    id: int
    order_no: int
    order_status_id: int  # FK -> OrderStatusMaster.id
    cust_id: int  # FK -> CustomerDetails.id
    date: datetime  # Order date, set/edited by the admin via the form.
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    description: str
    related_purchase_order_ids: list[int] = []  # FK -> PurchaseOrders.id (array)
    is_deleted: bool = False

    class Settings:
        name = "sales_orders"
