# Schema for the #expense_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated ExpenseDetails.id.
from beanie import Document


class ExpenseIdCounter(Document):
    id: int
    next_expense_id: int

    class Settings:
        name = "expense_id_counter"
