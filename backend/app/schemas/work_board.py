# Request/response bodies for the Work board (routes/work_board.py).
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.work_story import WorkStatus


class WorkTaskItem(BaseModel):
    task_id: int
    title: str
    status: WorkStatus
    assigned_user_id: int | None
    assigned_user_name: str | None
    deadline: datetime | None = None  # naive UTC
    created_at: datetime
    updated_at: datetime


class WorkGroupMember(BaseModel):
    user_id: int
    name: str


class WorkGroupItem(BaseModel):
    group_id: int
    name: str
    members: list[WorkGroupMember]


class CreateGroupRequest(BaseModel):
    name: str = Field(min_length=1)
    member_user_ids: list[int] = []


# Fields left out are unchanged. `delete` removes an empty group.
class UpdateGroupRequest(BaseModel):
    group_id: int
    name: str | None = None
    member_user_ids: list[int] | None = None
    delete: bool = False


class GroupResponse(BaseModel):
    message: str
    group: WorkGroupItem | None = None


class WorkStoryItem(BaseModel):
    story_id: int
    group_id: int | None
    group_name: str | None
    title: str
    description: str | None
    status: WorkStatus
    assigned_user_id: int | None
    assigned_user_name: str | None
    tasks: list[WorkTaskItem]
    created_at: datetime
    updated_at: datetime


class CreateStoryRequest(BaseModel):
    group_id: int
    title: str = Field(min_length=1)
    description: str | None = None
    status: WorkStatus = WorkStatus.new
    assigned_user_id: int | None = None


# Fields left out are unchanged. assigned_user_id is set whenever it's sent,
# so null unassigns. `delete` removes the story and its tasks. Moving it to
# another group (group_id) unassigns anyone on it who isn't in that group.
class UpdateStoryRequest(BaseModel):
    story_id: int
    group_id: int | None = None
    title: str | None = None
    description: str | None = None
    status: WorkStatus | None = None
    assigned_user_id: int | None = None
    delete: bool = False


class AddTaskRequest(BaseModel):
    story_id: int
    title: str = Field(min_length=1)
    status: WorkStatus = WorkStatus.new
    assigned_user_id: int | None = None
    deadline: datetime | None = None


# As for stories: assigned_user_id and deadline are set whenever they're
# sent, so null clears them.
class UpdateTaskRequest(BaseModel):
    story_id: int
    task_id: int
    title: str | None = None
    status: WorkStatus | None = None
    assigned_user_id: int | None = None
    deadline: datetime | None = None
    delete: bool = False


class StoryResponse(BaseModel):
    message: str
    story: WorkStoryItem | None = None
