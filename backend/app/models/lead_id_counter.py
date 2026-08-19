# Auto-increment counter for Lead.id — see services/counters.py.
from beanie import Document


class LeadIdCounter(Document):
    next_lead_id: int = 0

    class Settings:
        name = "lead_id_counter"