# Auto-increment counter for DatabaseVendor.id — see services/counters.py.
from beanie import Document


class DatabaseVendorIdCounter(Document):
    next_database_vendor_id: int = 0

    class Settings:
        name = "database_vendor_id_counter"