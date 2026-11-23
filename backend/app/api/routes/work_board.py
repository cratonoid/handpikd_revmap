# Work board: the team's own stories, each with tasks under it
# (models/work_story.py). Stories and tasks each have a status (New, Active,
# Completed) and can be assigned to a team member, who is told through the
# notification bell. Separate from Tickets, which are client support threads.
#
# Statuses are set by hand on each: a story isn't completed automatically
# when its tasks are, since a story can still have work no task covers.
from datetime import datetime, timezone

from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_section
from app.models import Section, User, UserRole, WorkStory, WorkStoryIdCounter, WorkTask
from app.schemas.inquiries import AssignableUser
from app.schemas.work_board import (
    AddTaskRequest,
    CreateStoryRequest,
    StoryResponse,
    UpdateStoryRequest,
    UpdateTaskRequest,
    WorkStoryItem,
    WorkTaskItem,
)
from app.services.counters import get_next_id
from app.services.notifications import notify

router = APIRouter(prefix="/admin/work_board", tags=["work-board"])

_require_work_board = require_section(Section.work_board)

TITLE_MAX_LENGTH = 200
DESCRIPTION_MAX_LENGTH = 5_000


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _user_name(user: User) -> str:
    return user.name.strip() or user.mail


def _clean_title(value: str) -> str:
    title = value.strip()
    if not title:
        raise _bad_request("enter a title")
    if len(title) > TITLE_MAX_LENGTH:
        raise _bad_request(f"a title can be at most {TITLE_MAX_LENGTH} characters")
    return title


def _clean_description(value: str | None) -> str | None:
    description = (value or "").strip() or None
    if description and len(description) > DESCRIPTION_MAX_LENGTH:
        raise _bad_request(f"a description can be at most {DESCRIPTION_MAX_LENGTH} characters")
    return description


async def _check_assignee(user_id: int | None) -> None:
    if user_id is None:
        return
    user = await User.get(user_id)
    if user is None or user.role != UserRole.admin or not user.is_active:
        raise _bad_request("that user can't be assigned: pick an active team member")


async def _get_story_or_404(story_id: int) -> WorkStory:
    story = await WorkStory.get(story_id)
    if story is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="story not found")
    return story


def _find_task(story: WorkStory, task_id: int) -> WorkTask:
    for task in story.tasks:
        if task.id == task_id:
            return task
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="task not found")


async def _to_items(stories: list[WorkStory]) -> list[WorkStoryItem]:
    user_ids = {story.assigned_user_id for story in stories} | {
        task.assigned_user_id for story in stories for task in story.tasks
    }
    user_ids.discard(None)
    users = {u.id: u for u in await User.find(In(User.id, list(user_ids))).to_list()} if user_ids else {}

    def name_of(user_id: int | None) -> str | None:
        user = users.get(user_id) if user_id is not None else None
        return _user_name(user) if user else None

    return [
        WorkStoryItem(
            story_id=story.id,
            title=story.title,
            description=story.description,
            status=story.status,
            assigned_user_id=story.assigned_user_id,
            assigned_user_name=name_of(story.assigned_user_id),
            tasks=[
                WorkTaskItem(
                    task_id=task.id,
                    title=task.title,
                    status=task.status,
                    assigned_user_id=task.assigned_user_id,
                    assigned_user_name=name_of(task.assigned_user_id),
                    created_at=task.created_at,
                    updated_at=task.updated_at,
                )
                for task in story.tasks
            ],
            created_at=story.created_at,
            updated_at=story.updated_at,
        )
        for story in stories
    ]


async def _notify_assigned(user_id: int | None, assigner: User | None, what: str, title: str, story_id: int) -> None:
    # Nobody needs telling they assigned something to themselves.
    if user_id is None or (assigner and assigner.id == user_id):
        return
    await notify(
        kind=f"work_board.{what}_assigned",
        title=f"{what.capitalize()} assigned to you: {title}",
        section=Section.work_board,
        link=f"/admin/work-board?story={story_id}",
        recipient_user_id=user_id,
    )


async def _story_response(message: str, story: WorkStory) -> StoryResponse:
    (item,) = await _to_items([story])
    return StoryResponse(message=message, story=item)


@router.get("/get_stories", response_model=list[WorkStoryItem])
async def get_stories(_: User | None = Depends(_require_work_board)) -> list[WorkStoryItem]:
    stories = await WorkStory.find_all().sort(-WorkStory.updated_at).to_list()
    return await _to_items(stories)


@router.get("/get_assignable_users", response_model=list[AssignableUser])
async def get_assignable_users(_: User | None = Depends(_require_work_board)) -> list[AssignableUser]:
    users = await User.find(User.role == UserRole.admin, User.is_active == True).to_list()  # noqa: E712
    return sorted(
        (AssignableUser(user_id=user.id, name=_user_name(user)) for user in users),
        key=lambda user: user.name.lower(),
    )


@router.post("/create_story", response_model=StoryResponse)
async def create_story(
    payload: CreateStoryRequest,
    current_user: User | None = Depends(_require_work_board),
) -> StoryResponse:
    title = _clean_title(payload.title)
    description = _clean_description(payload.description)
    await _check_assignee(payload.assigned_user_id)

    now = _now()
    story = WorkStory(
        id=0,
        title=title,
        description=description,
        status=payload.status,
        assigned_user_id=payload.assigned_user_id,
        created_by_user_id=current_user.id if current_user else None,
        created_at=now,
        updated_at=now,
    )
    story.id = await get_next_id(WorkStoryIdCounter, "next_work_story_id", WorkStory)
    await story.insert()
    await _notify_assigned(story.assigned_user_id, current_user, "story", story.title, story.id)
    return await _story_response("story created", story)


@router.post("/update_story", response_model=StoryResponse)
async def update_story(
    payload: UpdateStoryRequest,
    current_user: User | None = Depends(_require_work_board),
) -> StoryResponse:
    story = await _get_story_or_404(payload.story_id)
    if payload.delete:
        await story.delete()
        return StoryResponse(message="story deleted")

    assignee_sent = "assigned_user_id" in payload.model_fields_set
    if payload.title is None and payload.description is None and payload.status is None and not assignee_sent:
        raise _bad_request("no changes specified")
    if payload.title is not None:
        story.title = _clean_title(payload.title)
    if payload.description is not None:
        story.description = _clean_description(payload.description)
    if payload.status is not None:
        story.status = payload.status
    newly_assigned = None
    if assignee_sent and payload.assigned_user_id != story.assigned_user_id:
        await _check_assignee(payload.assigned_user_id)
        story.assigned_user_id = payload.assigned_user_id
        newly_assigned = payload.assigned_user_id
    story.updated_at = _now()
    await story.save()
    await _notify_assigned(newly_assigned, current_user, "story", story.title, story.id)
    return await _story_response("story updated", story)


@router.post("/add_task", response_model=StoryResponse)
async def add_task(
    payload: AddTaskRequest,
    current_user: User | None = Depends(_require_work_board),
) -> StoryResponse:
    story = await _get_story_or_404(payload.story_id)
    title = _clean_title(payload.title)
    await _check_assignee(payload.assigned_user_id)

    now = _now()
    task = WorkTask(
        id=max((task.id for task in story.tasks), default=0) + 1,
        title=title,
        status=payload.status,
        assigned_user_id=payload.assigned_user_id,
        created_at=now,
        updated_at=now,
    )
    story.tasks.append(task)
    story.updated_at = now
    await story.save()
    await _notify_assigned(task.assigned_user_id, current_user, "task", task.title, story.id)
    return await _story_response("task added", story)


@router.post("/update_task", response_model=StoryResponse)
async def update_task(
    payload: UpdateTaskRequest,
    current_user: User | None = Depends(_require_work_board),
) -> StoryResponse:
    story = await _get_story_or_404(payload.story_id)
    task = _find_task(story, payload.task_id)
    now = _now()

    if payload.delete:
        story.tasks = [other for other in story.tasks if other.id != task.id]
        story.updated_at = now
        await story.save()
        return await _story_response("task deleted", story)

    assignee_sent = "assigned_user_id" in payload.model_fields_set
    if payload.title is None and payload.status is None and not assignee_sent:
        raise _bad_request("no changes specified")
    if payload.title is not None:
        task.title = _clean_title(payload.title)
    if payload.status is not None:
        task.status = payload.status
    newly_assigned = None
    if assignee_sent and payload.assigned_user_id != task.assigned_user_id:
        await _check_assignee(payload.assigned_user_id)
        task.assigned_user_id = payload.assigned_user_id
        newly_assigned = payload.assigned_user_id
    task.updated_at = now
    story.updated_at = now
    await story.save()
    await _notify_assigned(newly_assigned, current_user, "task", task.title, story.id)
    return await _story_response("task updated", story)

