# Schema for the #inventory_id_counter collection. Single document
# (_id=1) that tracks the next auto-generated Inventory.id.
from beanie import Document


class InventoryIdCounter(Document):
    id: int
    next_inventory_id: int

    class Settings:
        name = "inventory_id_counter"
