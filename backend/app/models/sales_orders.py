# Schema for the #sales_orders collection.
from beanie import Document


class SalesOrders(Document):
    id: int
    order_no: int
    order_status_id: int  # FK -> OrderStatusMaster.id
    cust_id: int  # FK -> CustomerDetails.id (assumption, please confirm)
    total_amount_before_tax: float
    sgst_amount: float | None = None
    cgst_amount: float | None = None
    igst_amount: float | None = None
    total_amount_after_tax: float
    description: str
    related_purchase_order_ids: list[int]  # FK -> PurchaseOrders.id (array)

    class Settings:
        name = "sales_orders"
