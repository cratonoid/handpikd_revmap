# Work board: the team's own stories, each with tasks under it
# (models/work_story.py). Stories and tasks each have a status (New, Active,
# Completed) and can be assigned to a team member, who is told through the
# notification bell. Separate from Tickets, which are client support threads.
#
# Stories are grouped (models/work_group.py): a team member sees only the
# stories of groups they belong to, and only a group's members can be
# assigned to its stories and tasks. The Administrator manages the groups and
# sees every story; a story outside your groups is a 404 to you, as if it
# didn't exist.
#
# A task can carry a deadline. While a task is Active its assignee's phone is
# reminded every few hours (services/work_reminders.py).
#
# Statuses are set by hand on each: a story isn't completed automatically
# when its tasks are, since a story can still have work no task covers.
from datetime import datetime, timezone

from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_allowed_sections, require_administrator, require_section
from app.models import (
    Section,
    User,
    UserRole,
    WorkGroup,
    WorkGroupIdCounter,
    WorkStatus,
    WorkStory,
    WorkStoryIdCounter,
    WorkTask,
)
from app.schemas.inquiries import AssignableUser
from app.schemas.work_board import (
    AddTaskRequest,
    CreateGroupRequest,
    CreateStoryRequest,
    GroupResponse,
    StoryResponse,
    UpdateGroupRequest,
    UpdateStoryRequest,
    UpdateTaskRequest,
    WorkGroupItem,
    WorkGroupMember,
    WorkStoryItem,
    WorkTaskItem,
)
from app.services.counters import get_next_id
from app.services.notifications import notify

router = APIRouter(prefix="/admin/work_board", tags=["work-board"])

_require_work_board = require_section(Section.work_board)

TITLE_MAX_LENGTH = 200
GROUP_NAME_MAX_LENGTH = 80
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


async def _check_assignee(user_id: int | None, group: WorkGroup | None) -> None:
    if user_id is None:
        return
    user = await User.get(user_id)
    if user is None or user.role != UserRole.admin or not user.is_active:
        raise _bad_request("that user can't be assigned: pick an active team member")
    if group is not None and user_id not in group.member_user_ids:
        raise _bad_request(f"{_user_name(user)} isn't in the {group.name} group: add them to it first")


async def _is_administrator(user: User | None) -> bool:
    # No user means auth is disabled locally: treated as the Administrator.
    return user is None or await get_allowed_sections(user) is None


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found")


async def _get_group_for(user: User | None, group_id: int) -> WorkGroup:
    """The group, if `user` may work in it (a member, or the Administrator)."""
    group = await WorkGroup.get(group_id)
    if group is None or not (await _is_administrator(user) or user.id in group.member_user_ids):
        raise _not_found("group")
    return group


async def _get_story_for(user: User | None, story_id: int) -> tuple[WorkStory, WorkGroup | None]:
    """The story and its group, if `user` may see it."""
    story = await WorkStory.get(story_id)
    if story is None:
        raise _not_found("story")
    group = await WorkGroup.get(story.group_id) if story.group_id is not None else None
    if not await _is_administrator(user) and (group is None or user.id not in group.member_user_ids):
        raise _not_found("story")
    return story, group


def _unassign_non_members(story: WorkStory, members: list[int]) -> None:
    if story.assigned_user_id not in members:
        story.assigned_user_id = None
    for task in story.tasks:
        if task.assigned_user_id not in members:
            task.assigned_user_id = None


def _clean_deadline(value: datetime | None) -> datetime | None:
    # Stored as naive UTC like every other datetime; a deadline sent with an
    # offset (the board sends ISO with "Z") is converted first.
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _find_task(story: WorkStory, task_id: int) -> WorkTask:
    for task in story.tasks:
        if task.id == task_id:
            return task
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="task not found")


async def _to_items(stories: list[WorkStory]) -> list[WorkStoryItem]:
    group_ids = list({story.group_id for story in stories if story.group_id is not None})
    groups = {g.id: g for g in await WorkGroup.find(In(WorkGroup.id, group_ids)).to_list()} if group_ids else {}
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
            group_id=story.group_id,
            group_name=groups[story.group_id].name if story.group_id in groups else None,
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
                    deadline=task.deadline,
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


async def _group_items(groups: list[WorkGroup]) -> list[WorkGroupItem]:
    user_ids = list({user_id for group in groups for user_id in group.member_user_ids})
    users = {u.id: u for u in await User.find(In(User.id, user_ids)).to_list()} if user_ids else {}
    return [
        WorkGroupItem(
            group_id=group.id,
            name=group.name,
            members=sorted(
                (
                    WorkGroupMember(user_id=user_id, name=_user_name(users[user_id]))
                    for user_id in group.member_user_ids
                    if user_id in users
                ),
                key=lambda member: member.name.lower(),
            ),
        )
        for group in groups
    ]


def _clean_group_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise _bad_request("enter a group name")
    if len(name) > GROUP_NAME_MAX_LENGTH:
        raise _bad_request(f"a group name can be at most {GROUP_NAME_MAX_LENGTH} characters")
    return name


async def _clean_members(user_ids: list[int]) -> list[int]:
    wanted = sorted(set(user_ids))
    for user_id in wanted:
        await _check_assignee(user_id, None)
    return wanted


async def _check_name_free(name: str, except_id: int | None = None) -> None:
    for group in await WorkGroup.find_all().to_list():
        if group.id != except_id and group.name.lower() == name.lower():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"there's already a group called {group.name}")


@router.get("/get_groups", response_model=list[WorkGroupItem])
async def get_groups(current_user: User | None = Depends(_require_work_board)) -> list[WorkGroupItem]:
    """Every group for the Administrator; your own groups for anyone else."""
    if await _is_administrator(current_user):
        groups = await WorkGroup.find_all().to_list()
    else:
        groups = await WorkGroup.find(WorkGroup.member_user_ids == current_user.id).to_list()
    return await _group_items(sorted(groups, key=lambda group: group.name.lower()))


@router.post("/create_group", response_model=GroupResponse)
async def create_group(
    payload: CreateGroupRequest,
    _: User | None = Depends(require_administrator),
) -> GroupResponse:
    name = _clean_group_name(payload.name)
    await _check_name_free(name)
    now = _now()
    group = WorkGroup(
        id=0,
        name=name,
        member_user_ids=await _clean_members(payload.member_user_ids),
        created_at=now,
        updated_at=now,
    )
    group.id = await get_next_id(WorkGroupIdCounter, "next_work_group_id", WorkGroup)
    await group.insert()
    (item,) = await _group_items([group])
    return GroupResponse(message="group created", group=item)


@router.post("/update_group", response_model=GroupResponse)
async def update_group(
    payload: UpdateGroupRequest,
    _: User | None = Depends(require_administrator),
) -> GroupResponse:
    group = await WorkGroup.get(payload.group_id)
    if group is None:
        raise _not_found("group")
    stories = await WorkStory.find(WorkStory.group_id == group.id).to_list()

    if payload.delete:
        if stories:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{group.name} still has {len(stories)} story(ies): move or delete them first",
            )
        await group.delete()
        return GroupResponse(message="group deleted")

    if payload.name is None and payload.member_user_ids is None:
        raise _bad_request("no changes specified")
    if payload.name is not None:
        group.name = _clean_group_name(payload.name)
        await _check_name_free(group.name, except_id=group.id)
    if payload.member_user_ids is not None:
        group.member_user_ids = await _clean_members(payload.member_user_ids)
        # Someone taken out of the group no longer sees its stories, so
        # nothing in it can stay assigned to them.
        for story in stories:
            before = (story.assigned_user_id, [task.assigned_user_id for task in story.tasks])
            _unassign_non_members(story, group.member_user_ids)
            if (story.assigned_user_id, [task.assigned_user_id for task in story.tasks]) != before:
                await story.save()
    group.updated_at = _now()
    await group.save()
    (item,) = await _group_items([group])
    return GroupResponse(message="group updated", group=item)


@router.get("/get_stories", response_model=list[WorkStoryItem])
async def get_stories(current_user: User | None = Depends(_require_work_board)) -> list[WorkStoryItem]:
    """Every story for the Administrator; your groups' stories for anyone else."""
    if await _is_administrator(current_user):
        query = WorkStory.find_all()
    else:
        groups = await WorkGroup.find(WorkGroup.member_user_ids == current_user.id).to_list()
        query = WorkStory.find(In(WorkStory.group_id, [group.id for group in groups]))
    stories = await query.sort(-WorkStory.updated_at).to_list()
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
    group = await _get_group_for(current_user, payload.group_id)
    title = _clean_title(payload.title)
    description = _clean_description(payload.description)
    await _check_assignee(payload.assigned_user_id, group)

    now = _now()
    story = WorkStory(
        id=0,
        group_id=group.id,
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
    story, group = await _get_story_for(current_user, payload.story_id)
    if payload.delete:
        await story.delete()
        return StoryResponse(message="story deleted")

    assignee_sent = "assigned_user_id" in payload.model_fields_set
    nothing = payload.title is None and payload.description is None and payload.status is None
    if nothing and payload.group_id is None and not assignee_sent:
        raise _bad_request("no changes specified")
    if payload.group_id is not None and payload.group_id != story.group_id:
        group = await _get_group_for(current_user, payload.group_id)
        story.group_id = group.id
        _unassign_non_members(story, group.member_user_ids)
    if payload.title is not None:
        story.title = _clean_title(payload.title)
    if payload.description is not None:
        story.description = _clean_description(payload.description)
    if payload.status is not None:
        story.status = payload.status
    newly_assigned = None
    if assignee_sent and payload.assigned_user_id != story.assigned_user_id:
        await _check_assignee(payload.assigned_user_id, group)
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
    story, group = await _get_story_for(current_user, payload.story_id)
    title = _clean_title(payload.title)
    await _check_assignee(payload.assigned_user_id, group)

    now = _now()
    task = WorkTask(
        id=max((task.id for task in story.tasks), default=0) + 1,
        title=title,
        status=payload.status,
        assigned_user_id=payload.assigned_user_id,
        deadline=_clean_deadline(payload.deadline),
        # The phone reminder clock starts at the assignment push.
        reminded_at=now if payload.assigned_user_id is not None else None,
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
    story, group = await _get_story_for(current_user, payload.story_id)
    task = _find_task(story, payload.task_id)
    now = _now()

    if payload.delete:
        story.tasks = [other for other in story.tasks if other.id != task.id]
        story.updated_at = now
        await story.save()
        return await _story_response("task deleted", story)

    assignee_sent = "assigned_user_id" in payload.model_fields_set
    deadline_sent = "deadline" in payload.model_fields_set
    if payload.title is None and payload.status is None and not assignee_sent and not deadline_sent:
        raise _bad_request("no changes specified")
    if payload.title is not None:
        task.title = _clean_title(payload.title)
    if payload.status is not None:
        if payload.status == WorkStatus.active and task.status != WorkStatus.active:
            # Reminders come every few hours from the moment it turns Active.
            task.reminded_at = now
        task.status = payload.status
    if deadline_sent:
        task.deadline = _clean_deadline(payload.deadline)
    newly_assigned = None
    if assignee_sent and payload.assigned_user_id != task.assigned_user_id:
        await _check_assignee(payload.assigned_user_id, group)
        task.assigned_user_id = payload.assigned_user_id
        newly_assigned = payload.assigned_user_id
        if newly_assigned is not None:
            task.reminded_at = now
    task.updated_at = now
    story.updated_at = now
    await story.save()
    await _notify_assigned(newly_assigned, current_user, "task", task.title, story.id)
    return await _story_response("task updated", story)

