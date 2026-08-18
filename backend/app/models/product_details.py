# Schema for the #product_details collection.
from beanie import Document


class ProductDetails(Document):
    id: int
    product_name: str
    hsn_code: str
    vendor_id: int  # FK -> VendorDetails.id
    vendor_rate: float
    actual_price: float
    discounted_price: float
    gst_perc: float
    category_ids: list[int]  # FK -> Category.id (array)
    moq: int
    description: str
    # Storefront/catalogue visibility only: an admin can hide a product from
    # /products (and from the public inquiry cart) while still ordering,
    # quoting and invoicing it internally. Defaults to True on new products.
    is_visible: bool
    # Soft delete — the product is gone as far as every picker is concerned
    # (orders, quotations, invoices, purchase orders, storefront), but the
    # row stays so older documents referencing it still resolve to a real
    # name/HSN code. Restorable from the "Deleted" tab on /admin/products.
    # A hard delete is a separate, explicit action (delete_product with
    # permanent=True in routes/products.py) and is refused outright while
    # any document still references the product.
    is_deleted: bool = False

    class Settings:
        name = "product_details"
