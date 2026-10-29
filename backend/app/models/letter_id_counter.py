# Schema for the #letter_id_counter collection.
from beanie import Document


class LetterIdCounter(Document):
    id: int
    next_letter_id: int

    class Settings:
        name = "letter_id_counter"
