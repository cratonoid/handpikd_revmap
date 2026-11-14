# Schema for the #holiday_event collection: one entry on the gifting/holiday
# calendar shown in the admin Information section (/admin/information). It's
# a planning aid for the team, so the "date" is free text ("14th-15th",
# "3rd Sunday", "varies") rather than a real date: many festivals move every
# year and some entries are themes ("corporate welcome kits") with no day.
# Seeded once from _HOLIDAY_EVENT_SEED in app/core/db.py, then edited freely.
from beanie import Document


class HolidayEvent(Document):
    id: int
    month: int  # 1-12
    name: str
    when: str = ""  # free text, e.g. "26th", "3rd Sunday", "late Jan/early Feb"
    note: str = ""
    # Order within the month; new entries go to the end.
    sort_order: int = 0

    class Settings:
        name = "holiday_event"
