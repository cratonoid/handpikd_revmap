# Schema for the #database_contact_id_counter collection. Single document
# (_id=1) that tracks the next auto-generated DatabaseContact.id.
from beanie import Document


class DatabaseContactIdCounter(Document):
    id: int
    next_database_contact_id: int

    class Settings:
        name = "database_contact_id_counter"
