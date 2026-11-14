# Unit tests for the notification module (app/services/notifications.py):
# who a notification is visible to, that notify() can never fail the request
# that called it, and that marking something read twice is harmless.
import asyncio

from pymongo.errors import DuplicateKeyError

from app.models import Section, User, UserRole
from app.services import notifications


def test_an_administrator_sees_every_section():
    # get_allowed_sections returns None for the system role.
    assert notifications.visible_filter(5, None) == {
        "$and": [{"$or": [{"recipient_user_id": None}, {"recipient_user_id": 5}]}]
    }


def test_a_custom_role_sees_only_its_sections():
    query = notifications.visible_filter(5, {Section.tickets})
    assert {"section": {"$in": ["tickets"]}} in query["$and"]


def test_a_role_with_no_sections_sees_nothing_sectioned():
    query = notifications.visible_filter(5, set())
    assert {"section": {"$in": []}} in query["$and"]


def test_a_notification_aimed_at_someone_else_is_hidden():
    # Broadcast (None) or addressed to this user. Nobody else's.
    (recipients, *_) = notifications.visible_filter(5, None)["$and"]
    assert recipients == {"$or": [{"recipient_user_id": None}, {"recipient_user_id": 5}]}


def test_reader_id_falls_back_for_the_auth_disabled_admin():
    assert notifications.reader_id(None) == notifications.LOCAL_ADMIN_USER_ID
    user = User.model_construct(id=9, mail="a@b.c", password="x", role=UserRole.admin)
    assert notifications.reader_id(user) == 9


def test_notify_never_raises(monkeypatch):
    async def _broken_counter(*_args):
        raise RuntimeError("mongo is down")

    monkeypatch.setattr(notifications, "get_next_id", _broken_counter)

    result = asyncio.run(notifications.notify("ticket.raised", "New ticket", Section.tickets))

    assert result is None


def test_marking_read_twice_is_harmless(monkeypatch):
    inserted: list[tuple[int, int]] = []

    class _StubRead:
        def __init__(self, notification_id, user_id, read_at):
            self.key = (notification_id, user_id)

        async def insert(self):
            if self.key in inserted:
                raise DuplicateKeyError("dup")
            inserted.append(self.key)

    monkeypatch.setattr(notifications, "NotificationRead", _StubRead)

    asyncio.run(notifications.mark_read(5, [1, 2]))
    asyncio.run(notifications.mark_read(5, [2, 3, 3]))

    assert sorted(inserted) == [(1, 5), (2, 5), (3, 5)]
