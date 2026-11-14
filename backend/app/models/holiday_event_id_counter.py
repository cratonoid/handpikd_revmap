# Schema for the #holiday_event_id_counter collection. Its existence also
# marks the calendar as seeded (see _seed_holiday_events in app/core/db.py),
# so deleting every entry doesn't bring the defaults back on the next start.
from beanie import Document


class HolidayEventIdCounter(Document):
    id: int
    next_holiday_event_id: int

    class Settings:
        name = "holiday_event_id_counter"
