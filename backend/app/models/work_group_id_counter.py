# Schema for the #work_group_id_counter collection. Single document holding
# the next WorkGroup id (see services/counters.py).
from beanie import Document


class WorkGroupIdCounter(Document):
    id: int
    next_work_group_id: int

    class Settings:
        name = "work_group_id_counter"
