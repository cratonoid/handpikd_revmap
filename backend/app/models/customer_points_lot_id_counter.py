# Schema for the #customer_points_lot_id_counter collection. Single document
# (_id=1) that tracks the next auto-generated CustomerPointsLot.id.
from beanie import Document


class CustomerPointsLotIdCounter(Document):
    id: int
    next_customer_points_lot_id: int

    class Settings:
        name = "customer_points_lot_id_counter"
