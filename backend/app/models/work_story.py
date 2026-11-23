# Schema for the #work_story collection: the Work board (routes/work_board.py),
# the team's own stories and the tasks under them. Not to be confused with
# Tickets (models/ticket.py), which are client support threads.
#
# Tasks live on their story rather than in their own collection: they're only
# ever read and written with it. Each task's id is unique within its story.
from datetime import datetime
from enum import Enum

from beanie import Document
from pydantic import BaseModel


class WorkStatus(str, Enum):
    new = "new"
    active = "active"
    completed = "completed"


class WorkTask(BaseModel):
    id: int
    title: str
    status: WorkStatus = WorkStatus.new
    assigned_user_id: int | None = None  # FK -> User.id (a team account)
    deadline: datetime | None = None  # naive UTC
    # When the assignee was last told about this task by phone (on being
    # assigned, on it turning Active, or a reminder): reminders repeat every
    # few hours from here while it stays Active (services/work_reminders.py).
    reminded_at: datetime | None = None  # naive UTC
    created_at: datetime
    updated_at: datetime


class WorkStory(Document):
    id: int
    title: str
    description: str | None = None
    status: WorkStatus = WorkStatus.new
    assigned_user_id: int | None = None  # FK -> User.id (a team account)
    tasks: list[WorkTask] = []
    created_by_user_id: int | None = None
    created_at: datetime
    updated_at: datetime

    class Settings:
        name = "work_story"
