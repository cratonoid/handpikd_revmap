# Schema for the #user_id_counter collection. Single document (_id=1) that
# tracks the next auto-generated User.id.
from beanie import Document


class UserIdCounter(Document):
    id: int
    next_user_id: int

    class Settings:
        name = "user_id_counter"
