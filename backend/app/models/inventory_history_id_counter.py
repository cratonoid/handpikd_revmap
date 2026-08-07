# Schema for the #inventory_history_id_counter collection. Single document
# (_id=1) that tracks the next auto-generated InventoryHistory.id.
from beanie import Document


class InventoryHistoryIdCounter(Document):
    id: int
    next_inventory_history_id: int

    class Settings:
        name = "inventory_history_id_counter"
