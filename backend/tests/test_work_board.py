# Unit tests for the Work board (app/api/routes/work_board.py): adding,
# updating and deleting tasks under a story, unassigning by sending null,
# the "assigned to you" notification, and groups: who sees which story and
# who can be assigned. Beanie is stubbed out, as in
# test_purchase_order_duplicate_guard.py.
import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.routes import work_board
from app.models.work_story import WorkStatus, WorkTask
from app.schemas.work_board import AddTaskRequest, UpdateGroupRequest, UpdateStoryRequest, UpdateTaskRequest

_AT = datetime(2026, 11, 23, 9, 0)


@pytest.fixture
def world(monkeypatch):
    story = SimpleNamespace(
        id=1,
        group_id=1,
        title="Diwali launch",
        description=None,
        status=WorkStatus.active,
        assigned_user_id=None,
        tasks=[WorkTask(id=1, title="Shoot hampers", created_at=_AT, updated_at=_AT)],
        created_at=_AT,
        updated_at=_AT,
        saved=0,
    )

    async def save():
        story.saved += 1

    story.save = save
    group = SimpleNamespace(id=1, name="Marketing", member_user_ids=[5, 9], saved=0)

    async def save_group():
        group.saved += 1

    group.save = save_group
    # User ids whose role is the Administrator's.
    state = SimpleNamespace(story=story, group=group, notified=[], administrators={0})

    class _Groups:
        id = SimpleNamespace(name="id")

        @staticmethod
        async def get(group_id):
            return group if group_id == 1 else None

        @staticmethod
        def find(*_args):
            class _Q:
                async def to_list(self):
                    return [group]

            return _Q()

    async def allowed_sections(user):
        return None if user.id in state.administrators else {work_board.Section.work_board}

    class _Stories:
        @staticmethod
        async def get(story_id):
            return story if story_id == 1 else None

    class _Users:
        id = SimpleNamespace(name="id")

        @staticmethod
        async def get(user_id):
            return SimpleNamespace(id=user_id, role=work_board.UserRole.admin, is_active=True, name="Riya", mail="")

        @staticmethod
        def find(*_args):
            class _Q:
                async def to_list(self):
                    return [SimpleNamespace(id=5, name="Riya", mail="")]

            return _Q()

    async def fake_notify(**kwargs):
        state.notified.append(kwargs)

    _Stories.group_id = SimpleNamespace(name="group_id")

    @staticmethod
    def find_stories(*_args):
        class _Q:
            async def to_list(self):
                return [story]

        return _Q()

    _Stories.find = find_stories
    monkeypatch.setattr(work_board, "WorkStory", _Stories)
    monkeypatch.setattr(work_board, "WorkGroup", _Groups)
    monkeypatch.setattr(work_board, "get_allowed_sections", allowed_sections)
    monkeypatch.setattr(work_board, "User", _Users)
    monkeypatch.setattr(work_board, "In", lambda field, values: ("in", values))
    monkeypatch.setattr(work_board, "notify", fake_notify)
    return state


def test_a_new_task_takes_the_next_id_and_notifies_its_assignee(world):
    response = asyncio.run(
        work_board.add_task(AddTaskRequest(story_id=1, title="  Print labels ", assigned_user_id=5), SimpleNamespace(id=9))
    )

    task = world.story.tasks[-1]
    assert (task.id, task.title, task.status) == (2, "Print labels", WorkStatus.new)
    assert response.story.tasks[-1].assigned_user_name == "Riya"
    assert world.notified[0]["recipient_user_id"] == 5
    assert world.notified[0]["link"] == "/admin/work-board?story=1"


def test_a_task_status_changes_on_its_own(world):
    asyncio.run(work_board.update_task(UpdateTaskRequest(story_id=1, task_id=1, status=WorkStatus.completed), None))

    assert world.story.tasks[0].status == WorkStatus.completed
    # The story keeps its own status: it's set by hand.
    assert world.story.status == WorkStatus.active


def test_sending_null_unassigns_but_leaving_it_out_does_not(world):
    world.story.assigned_user_id = 5

    asyncio.run(work_board.update_story(UpdateStoryRequest(story_id=1, title="Diwali launch v2"), None))
    assert world.story.assigned_user_id == 5

    asyncio.run(work_board.update_story(UpdateStoryRequest(story_id=1, assigned_user_id=None), None))
    assert world.story.assigned_user_id is None


def test_deleting_a_task_keeps_the_rest(world):
    world.story.tasks.append(WorkTask(id=2, title="Pack", created_at=_AT, updated_at=_AT))

    asyncio.run(work_board.update_task(UpdateTaskRequest(story_id=1, task_id=1, delete=True), None))

    assert [task.id for task in world.story.tasks] == [2]


def test_an_unknown_task_is_a_404(world):
    with pytest.raises(HTTPException) as error:
        asyncio.run(work_board.update_task(UpdateTaskRequest(story_id=1, task_id=99, title="x"), None))
    assert error.value.status_code == 404


def test_assigning_to_yourself_sends_no_notification(world):
    asyncio.run(work_board.add_task(AddTaskRequest(story_id=1, title="Mine", assigned_user_id=5), SimpleNamespace(id=5)))
    assert world.notified == []


def test_someone_outside_the_group_cannot_see_its_story(world):
    with pytest.raises(HTTPException) as error:
        asyncio.run(work_board.update_task(UpdateTaskRequest(story_id=1, task_id=1, title="x"), SimpleNamespace(id=7)))
    assert error.value.status_code == 404


def test_only_group_members_can_be_assigned(world):
    with pytest.raises(HTTPException) as error:
        asyncio.run(work_board.add_task(AddTaskRequest(story_id=1, title="Pack", assigned_user_id=7), None))
    assert error.value.status_code == 400
    assert "isn't in the Marketing group" in error.value.detail


def test_taking_someone_out_of_a_group_unassigns_them(world):
    world.story.assigned_user_id = 9
    world.story.tasks[0].assigned_user_id = 9

    asyncio.run(work_board.update_group(UpdateGroupRequest(group_id=1, member_user_ids=[5]), None))

    assert world.group.member_user_ids == [5]
    assert (world.story.assigned_user_id, world.story.tasks[0].assigned_user_id) == (None, None)
    assert world.story.saved == 1


def test_a_group_with_stories_cannot_be_deleted(world):
    with pytest.raises(HTTPException) as error:
        asyncio.run(work_board.update_group(UpdateGroupRequest(group_id=1, delete=True), None))
    assert error.value.status_code == 409
