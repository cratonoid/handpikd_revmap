# Phone reminders for Active Work board tasks (routes/work_board.py).
#
# While a task is Active and assigned, its assignee gets a push every
# REMINDER_INTERVAL, counted from the last time they were told about it
# (task.reminded_at: set on being assigned, on turning Active, and on each
# reminder). Nothing is sent between QUIET_FROM and QUIET_UNTIL India time;
# whatever fell due overnight goes out together in the morning. A person's
# due tasks are grouped into one push, so three tasks mean one buzz, not
# three. Reminders go to phones only, never the bell, which would otherwise
# fill up with repeats.
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone

from app.models import WorkStatus, WorkStory, WorkTask
from app.services.push import send_push

logger = logging.getLogger(__name__)

REMINDER_INTERVAL = timedelta(hours=3)
CHECK_EVERY_SECONDS = 10 * 60
IST = timezone(timedelta(hours=5, minutes=30))
QUIET_UNTIL = time(9, 0)  # reminders start at 9am IST...
QUIET_FROM = time(21, 0)  # ...and stop at 9pm IST


@dataclass
class DueTask:
    story: WorkStory
    task: WorkTask


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def in_quiet_hours(now_utc: datetime) -> bool:
    local = now_utc.replace(tzinfo=timezone.utc).astimezone(IST).time()
    return not (QUIET_UNTIL <= local < QUIET_FROM)


def due_by_user(stories: list[WorkStory], now: datetime) -> dict[int, list[DueTask]]:
    due: dict[int, list[DueTask]] = {}
    for story in stories:
        for task in story.tasks:
            if task.status != WorkStatus.active or task.assigned_user_id is None:
                continue
            if task.reminded_at is not None and now - task.reminded_at < REMINDER_INTERVAL:
                continue
            due.setdefault(task.assigned_user_id, []).append(DueTask(story, task))
    return due


def _deadline_text(task: WorkTask, now: datetime) -> str:
    if task.deadline is None:
        return ""
    if task.deadline <= now:
        return " (overdue)"
    local = task.deadline.replace(tzinfo=timezone.utc).astimezone(IST)
    return f" (due {local.strftime('%d %b, %I:%M %p').replace(' 0', ' ').lstrip('0')})"


def reminder_message(tasks: list[DueTask], now: datetime) -> tuple[str, str, str]:
    """(title, body, link) for one person's reminder push."""
    # Overdue first, then soonest deadline, then those without one.
    ordered = sorted(tasks, key=lambda due: (due.task.deadline is None, due.task.deadline or now))
    if len(ordered) == 1:
        title = f"Reminder: {ordered[0].task.title}"
    else:
        title = f"Reminder: {len(ordered)} active tasks"
    body = "\n".join(f"• {due.task.title}{_deadline_text(due.task, now)}" for due in ordered)
    story_ids = {due.story.id for due in ordered}
    link = f"/admin/work-board?story={story_ids.pop()}" if len(story_ids) == 1 else "/admin/work-board"
    return title, body, link


async def send_work_reminders(now: datetime | None = None) -> int:
    """Send every reminder due now. Returns how many people were reminded."""
    now = now or _now()
    if in_quiet_hours(now):
        return 0
    stories = await WorkStory.find(
        {"tasks": {"$elemMatch": {"status": WorkStatus.active.value, "assigned_user_id": {"$ne": None}}}}
    ).to_list()
    due = due_by_user(stories, now)
    touched: dict[int, WorkStory] = {}
    for user_id, tasks in due.items():
        title, body, link = reminder_message(tasks, now)
        await send_push(user_id, title, body, link)
        for item in tasks:
            # Marked even with no phone signed up, so someone who turns
            # alerts on later isn't flooded with a backlog.
            item.task.reminded_at = now
            touched[item.story.id] = item.story
    for story in touched.values():
        # Only reminded_at changed: updated_at is left alone so the board's
        # "recently updated" order isn't reshuffled by reminders.
        await story.save()
    return len(due)


async def work_reminder_loop() -> None:
    # Started from app/main.py's lifespan. A failed round is logged and the
    # next one retries; never fatal.
    await asyncio.sleep(90)
    from app.services.backup import restore_in_progress

    while True:
        try:
            if not restore_in_progress():
                await send_work_reminders()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("work reminder round failed")
        await asyncio.sleep(CHECK_EVERY_SECONDS)
