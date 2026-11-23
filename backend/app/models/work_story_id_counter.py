# Schema for the #work_story_id_counter collection. Single document holding
# the next WorkStory id (see services/counters.py).
from beanie import Document


class WorkStoryIdCounter(Document):
    id: int
    next_work_story_id: int

    class Settings:
        name = "work_story_id_counter"
