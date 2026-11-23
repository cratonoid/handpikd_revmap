# Unit tests for phone reminders on Work board tasks
# (services/work_reminders.py), task deadlines (routes/work_board.py) and the
# push endpoint allowlist (services/push.py). No Mongo, no push service.
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.api.routes import work_board
from app.models.work_story import WorkStatus, WorkTask
from app.schemas.work_board import UpdateTaskRequest
from app.services import push, work_reminders
from tests.test_work_board import world  # noqa: F401  (fixture)

# 11:00 IST
_NOON_IST = datetime(2026, 11, 23, 5, 30)


def _task(task_id, status=WorkStatus.active, user=5, reminded=None, deadline=None, title="Pack"):
    return WorkTask(
        id=task_id,
        title=title,
        status=status,
        assigned_user_id=user,
        reminded_at=reminded,
        deadline=deadline,
        created_at=_NOON_IST,
        updated_at=_NOON_IST,
    )


def test_quiet_hours_are_9pm_to_9am_india_time():
    assert not work_reminders.in_quiet_hours(datetime(2026, 11, 23, 3, 30))  # 9:00 IST
    assert work_reminders.in_quiet_hours(datetime(2026, 11, 23, 3, 29))  # 8:59 IST
    assert work_reminders.in_quiet_hours(datetime(2026, 11, 23, 15, 30))  # 21:00 IST


def test_only_active_assigned_tasks_three_hours_on_are_due():
    story = SimpleNamespace(
        id=1,
        tasks=[
            _task(1, reminded=_NOON_IST - timedelta(hours=3)),  # due
            _task(2, reminded=_NOON_IST - timedelta(hours=2)),  # too soon
            _task(3, status=WorkStatus.new),  # not active
            _task(4, user=None),  # nobody to remind
            _task(5, user=6),  # never reminded: due
        ],
    )
    due = work_reminders.due_by_user([story], _NOON_IST)
    assert {user: [item.task.id for item in items] for user, items in due.items()} == {5: [1], 6: [5]}


def test_one_push_per_person_lists_overdue_first():
    story = SimpleNamespace(id=7)
    tasks = [
        work_reminders.DueTask(story, _task(1, title="Labels")),
        work_reminders.DueTask(story, _task(2, title="Invoice", deadline=_NOON_IST - timedelta(hours=1))),
    ]
    title, body, link = work_reminders.reminder_message(tasks, _NOON_IST)
    assert title == "Reminder: 2 active tasks"
    assert body.splitlines() == ["• Invoice (overdue)", "• Labels"]
    assert link == "/admin/work-board?story=7"


def test_reminders_mark_tasks_and_skip_quiet_hours(monkeypatch):
    task = _task(1)
    saved = []
    story = SimpleNamespace(id=1, tasks=[task])

    async def save():
        saved.append(story.id)

    story.save = save
    pushed = []

    async def fake_push(user_id, title, body, link):
        pushed.append(user_id)
        return 1

    class _Stories:
        @staticmethod
        def find(_query):
            class _Q:
                async def to_list(self):
                    return [story]

            return _Q()

    monkeypatch.setattr(work_reminders, "WorkStory", _Stories)
    monkeypatch.setattr(work_reminders, "send_push", fake_push)

    assert asyncio.run(work_reminders.send_work_reminders(datetime(2026, 11, 23, 18, 0))) == 0  # 23:30 IST
    assert asyncio.run(work_reminders.send_work_reminders(_NOON_IST)) == 1
    assert (pushed, saved, task.reminded_at) == ([5], [1], _NOON_IST)
    # Straight after, nothing is due again.
    assert asyncio.run(work_reminders.send_work_reminders(_NOON_IST + timedelta(hours=1))) == 0


def test_a_deadline_is_stored_as_utc_and_null_clears_it(world):  # noqa: F811
    ist_5pm = datetime(2026, 11, 25, 17, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    asyncio.run(work_board.update_task(UpdateTaskRequest(story_id=1, task_id=1, deadline=ist_5pm), None))
    assert world.story.tasks[0].deadline == datetime(2026, 11, 25, 11, 30)

    asyncio.run(work_board.update_task(UpdateTaskRequest(story_id=1, task_id=1, title="Shoot"), None))
    assert world.story.tasks[0].deadline is not None

    asyncio.run(work_board.update_task(UpdateTaskRequest(story_id=1, task_id=1, deadline=None), None))
    assert world.story.tasks[0].deadline is None


def test_turning_active_restarts_the_reminder_clock(world):  # noqa: F811
    asyncio.run(work_board.update_task(UpdateTaskRequest(story_id=1, task_id=1, status=WorkStatus.active), None))
    assert world.story.tasks[0].reminded_at is not None


def test_only_real_push_services_are_accepted():
    assert push.is_push_service("https://fcm.googleapis.com/fcm/send/abc")
    assert push.is_push_service("https://web.push.apple.com/QK")
    assert not push.is_push_service("http://fcm.googleapis.com/fcm/send/abc")
    assert not push.is_push_service("https://evil.example/fcm.googleapis.com")
    assert not push.is_push_service("https://fcm.googleapis.com.evil.example/x")
