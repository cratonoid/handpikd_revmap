# Schema for the #role_id_counter collection. Single document (_id=1) that
# tracks the next auto-generated Role.id.
from beanie import Document


class RoleIdCounter(Document):
    id: int
    next_role_id: int

    class Settings:
        name = "role_id_counter"
