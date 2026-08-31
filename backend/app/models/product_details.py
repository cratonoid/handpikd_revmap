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
    # Stock bought without a bill (see models/unbilled_purchase_orders.py).
    # Such a product is created inline by the unbilled purchase form the
    # first time its name is used, and carries no hsn_code and a gst_perc of
    # 0 because there is no vendor invoice classifying it.
    #
    # It is a full ProductDetails row on purpose: #inventory,
    # #inventory_history, #sales_summary, #sales_order_costing and the
    # invoice line join are all keyed on product_id, and giving unbilled
    # stock its own collection would have made every one of those references
    # ambiguous. Keeping it here also means promoting one — buying the same
    # goods WITH a bill later — is filling in an HSN code and clearing this
    # flag, not migrating rows between collections.
    #
    # Two things must hold wherever this is True, both enforced rather than
    # assumed: it never becomes storefront-visible (services/inventory.py's
    # _set_product_visibility refuses to show one on restock, and
    # get_public_products filters it out), and it never lands on a GST
    # purchase order (routes/orders.py's _validate_products_belong_to_vendor
    # rejects it). Identity is the NAME, since "" is the only HSN code these
    # have to be told apart by — see _validate_hsn_code_product_name in
    # routes/products.py, whose (hsn, name) pair rule already spells exactly
    # that for an empty code.
    is_unbilled: bool = False

    class Settings:
        name = "product_details"
