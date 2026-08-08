# Models package: database document/schema models, one per MongoDB collection.
from app.models.catalogue_details import CatalogueDetails
from app.models.catalogue_id_counter import CatalogueIdCounter
from app.models.catalogue_image_details import CatalogueImageDetails
from app.models.catalogue_image_id_counter import CatalogueImageIdCounter
from app.models.category import Category
from app.models.category_id_counter import CategoryIdCounter
from app.models.customer_details import CustomerDetails
from app.models.customer_id_counter import CustomerIdCounter
from app.models.customer_poc_details import CustomerPocDetails
from app.models.customer_poc_id_counter import CustomerPocIdCounter
from app.models.inventory import Inventory
from app.models.inventory_history import InventoryHistory
from app.models.inventory_history_id_counter import InventoryHistoryIdCounter
from app.models.inventory_id_counter import InventoryIdCounter
from app.models.invoice_details import InvoiceDetails, InvoiceType, OnlineOrOffline
from app.models.invoice_id_counter import InvoiceIdCounter
from app.models.invoice_no_counter_master import InvoiceNoCounterMaster
from app.models.order_no_counter_master import OrderNoCounterMaster
from app.models.order_status_master import OrderStatusMaster
from app.models.personal_details import PersonalDetails
from app.models.product_details import ProductDetails
from app.models.product_id_counter import ProductIdCounter
from app.models.product_image_details import ProductImageDetails
from app.models.product_image_id_counter import ProductImageIdCounter
from app.models.purchase_order_id_counter import PurchaseOrderIdCounter
from app.models.purchase_orders import PurchaseOrders
from app.models.purchase_summary import PurchaseSummary
from app.models.purchase_summary_id_counter import PurchaseSummaryIdCounter
from app.models.sales_order_id_counter import SalesOrderIdCounter
from app.models.sales_orders import SalesOrders
from app.models.sales_summary import SalesSummary
from app.models.sales_summary_id_counter import SalesSummaryIdCounter
from app.models.user import User, UserRole
from app.models.user_id_counter import UserIdCounter
from app.models.vendor_details import VendorDetails
from app.models.vendor_id_counter import VendorIdCounter
from app.models.vendor_poc_details import VendorPocDetails
from app.models.vendor_poc_id_counter import VendorPocIdCounter

__all__ = [
    "CatalogueDetails",
    "CatalogueIdCounter",
    "CatalogueImageDetails",
    "CatalogueImageIdCounter",
    "Category",
    "CategoryIdCounter",
    "CustomerDetails",
    "CustomerIdCounter",
    "CustomerPocDetails",
    "CustomerPocIdCounter",
    "Inventory",
    "InventoryHistory",
    "InventoryHistoryIdCounter",
    "InventoryIdCounter",
    "InvoiceDetails",
    "InvoiceType",
    "OnlineOrOffline",
    "InvoiceIdCounter",
    "InvoiceNoCounterMaster",
    "OrderNoCounterMaster",
    "OrderStatusMaster",
    "PersonalDetails",
    "ProductDetails",
    "ProductIdCounter",
    "ProductImageDetails",
    "ProductImageIdCounter",
    "PurchaseOrderIdCounter",
    "PurchaseOrders",
    "PurchaseSummary",
    "PurchaseSummaryIdCounter",
    "SalesOrderIdCounter",
    "SalesOrders",
    "SalesSummary",
    "SalesSummaryIdCounter",
    "User",
    "UserRole",
    "UserIdCounter",
    "VendorDetails",
    "VendorIdCounter",
    "VendorPocDetails",
    "VendorPocIdCounter",
]
