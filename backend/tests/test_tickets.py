# Unit tests for the support ticket rules in app/api/routes/tickets.py:
#
#   - a client can only reach their own tickets, and someone else's reads as
#     "not found" rather than "forbidden",
#   - a closed ticket takes no new messages from either side,
#   - a client replying to a resolved ticket reopens it,
#   - a team status change is recorded on the thread but doesn't count as a
#     reply (the "awaiting reply" flag stays put),
#   - a linked order must be one of the ticket's client's own live orders.
#
# Ticket / TicketMessage are stubbed rather than queried, same approach as
# test_customer_invoice_access.py: real Beanie queries need a live Mongo.
import asyncio
from datetime import datetime

import pytest
from fastapi import HTTPException

from app.api.routes import tickets
from app.models import TicketMessageKind, TicketSide, TicketStatus
from app.schemas.tickets import PostTicketMessageRequest, UpdateTicketStatusRequest


class _StubTicket:
    def __init__(self, ticket_id: int, cust_id: int, status: TicketStatus = TicketStatus.open) -> None:
        self.id = ticket_id
        self.cust_id = cust_id
        self.status = status
        self.last_message_by = TicketSide.client
        self.last_message_at = datetime(2026, 1, 1)
        self.updated_at = datetime(2026, 1, 1)
        self.saved = 0

    async def save(self) -> None:
        self.saved += 1


class _StubCustomer:
    def __init__(self, customer_id: int, user_id: int = 50) -> None:
        self.id = customer_id
        self.user_id = user_id
        self.registered_name = "Acme"
        self.company_or_department = ""
        self.is_deleted = False


class _StubUser:
    def __init__(self, user_id: int = 7, name: str = "Priya") -> None:
        self.id = user_id
        self.name = name


@pytest.fixture
def stored(monkeypatch):
    """Stubs Ticket.get, the message writer and the detail builder.

    Returns a dict the tests fill with the ticket Ticket.get should return,
    and read back the messages and status-change entries that were written.
    """
    state: dict = {"ticket": None, "messages": [], "inserted": [], "notified": []}

    class _TicketModel:
        @classmethod
        async def get(cls, _ticket_id):
            return state["ticket"]

    class _MessageModel:
        def __init__(self, **fields) -> None:
            self.fields = fields

        async def insert(self) -> None:
            state["inserted"].append(self.fields)

    async def _add_message(ticket, side, author_user_id, author_name, body):
        state["messages"].append((side, author_user_id, author_name, body))
        ticket.last_message_by = side

    async def _to_detail(ticket, _customer):
        return ticket

    async def _next_id(*_args):
        return 1

    async def _no_customer(_cust_id):
        return None

    async def _notify(kind, title, section, body="", link="", recipient_user_id=None):
        state["notified"].append((kind, title, section, body, link))

    monkeypatch.setattr(tickets, "notify", _notify)
    monkeypatch.setattr(tickets, "Ticket", _TicketModel)
    monkeypatch.setattr(tickets, "TicketMessage", _MessageModel)
    monkeypatch.setattr(tickets, "_add_message", _add_message)
    monkeypatch.setattr(tickets, "_to_detail", _to_detail)
    monkeypatch.setattr(tickets, "get_next_id", _next_id)
    monkeypatch.setattr(tickets.CustomerDetails, "get", _no_customer)
    return state


# ---------------------------------------------------------------------------
# Ownership
# ---------------------------------------------------------------------------
def test_a_client_reads_their_own_ticket(stored):
    stored["ticket"] = _StubTicket(3, cust_id=4)
    ticket = asyncio.run(tickets._get_owned_ticket_or_404(3, _StubCustomer(4)))
    assert ticket.id == 3


def test_another_clients_ticket_is_not_found(stored):
    stored["ticket"] = _StubTicket(3, cust_id=9)
    with pytest.raises(HTTPException) as error:
        asyncio.run(tickets._get_owned_ticket_or_404(3, _StubCustomer(4)))
    assert error.value.status_code == 404


def test_a_missing_ticket_is_not_found(stored):
    with pytest.raises(HTTPException) as error:
        asyncio.run(tickets._get_owned_ticket_or_404(3, _StubCustomer(4)))
    assert error.value.status_code == 404


# ---------------------------------------------------------------------------
# Posting
# ---------------------------------------------------------------------------
def test_a_client_reply_reopens_a_resolved_ticket(stored):
    stored["ticket"] = _StubTicket(3, cust_id=4, status=TicketStatus.resolved)

    ticket = asyncio.run(
        tickets.post_my_ticket_message(PostTicketMessageRequest(ticket_id=3, body="  still broken  "), _StubCustomer(4))
    )

    assert ticket.status == TicketStatus.open
    assert stored["messages"] == [(TicketSide.client, 50, "Acme", "still broken")]
    # The team hears about the reply, linked straight to the ticket.
    ((kind, _title, section, body, link),) = stored["notified"]
    assert kind == "ticket.client_replied"
    assert section == tickets.Section.tickets
    assert body == "still broken"
    assert link == "/admin/tickets?ticket=3"


def test_a_client_reply_leaves_an_in_progress_ticket_alone(stored):
    stored["ticket"] = _StubTicket(3, cust_id=4, status=TicketStatus.in_progress)

    ticket = asyncio.run(
        tickets.post_my_ticket_message(PostTicketMessageRequest(ticket_id=3, body="any update?"), _StubCustomer(4))
    )

    assert ticket.status == TicketStatus.in_progress


@pytest.mark.parametrize("side", ["client", "team"])
def test_a_closed_ticket_takes_no_messages(stored, side):
    stored["ticket"] = _StubTicket(3, cust_id=4, status=TicketStatus.closed)
    payload = PostTicketMessageRequest(ticket_id=3, body="hello")

    with pytest.raises(HTTPException) as error:
        if side == "client":
            asyncio.run(tickets.post_my_ticket_message(payload, _StubCustomer(4)))
        else:
            asyncio.run(tickets.post_ticket_message(payload, _StubUser()))

    assert error.value.status_code == 400
    assert stored["messages"] == []


def test_a_blank_message_is_refused(stored):
    stored["ticket"] = _StubTicket(3, cust_id=4)
    with pytest.raises(HTTPException) as error:
        asyncio.run(tickets.post_ticket_message(PostTicketMessageRequest(ticket_id=3, body="   "), _StubUser()))
    assert error.value.status_code == 400


def test_a_team_message_is_signed_with_the_team_members_name(stored):
    stored["ticket"] = _StubTicket(3, cust_id=4)
    asyncio.run(tickets.post_ticket_message(PostTicketMessageRequest(ticket_id=3, body="On it"), _StubUser()))
    assert stored["messages"] == [(TicketSide.team, 7, "Priya", "On it")]
    # The team's own replies don't notify the team.
    assert stored["notified"] == []


def test_a_team_message_without_a_signed_in_user_falls_back_to_the_team_name(stored):
    # settings.auth_enabled off: require_section resolves to None.
    stored["ticket"] = _StubTicket(3, cust_id=4)
    asyncio.run(tickets.post_ticket_message(PostTicketMessageRequest(ticket_id=3, body="On it"), None))
    assert stored["messages"] == [(TicketSide.team, None, tickets.TEAM_FALLBACK_NAME, "On it")]


# ---------------------------------------------------------------------------
# Status changes
# ---------------------------------------------------------------------------
def test_a_status_change_is_recorded_without_counting_as_a_reply(stored):
    ticket = _StubTicket(3, cust_id=4, status=TicketStatus.open)
    stored["ticket"] = ticket

    asyncio.run(
        tickets.update_ticket_status(UpdateTicketStatusRequest(ticket_id=3, status=TicketStatus.resolved), _StubUser())
    )

    assert ticket.status == TicketStatus.resolved
    # The client spoke last, and still did: the status change isn't a reply.
    assert ticket.last_message_by == TicketSide.client
    (entry,) = stored["inserted"]
    assert entry["kind"] == TicketMessageKind.status_change
    assert entry["new_status"] == TicketStatus.resolved
    assert entry["author_name"] == "Priya"


def test_setting_the_same_status_writes_nothing(stored):
    ticket = _StubTicket(3, cust_id=4, status=TicketStatus.in_progress)
    stored["ticket"] = ticket

    asyncio.run(
        tickets.update_ticket_status(
            UpdateTicketStatusRequest(ticket_id=3, status=TicketStatus.in_progress), _StubUser()
        )
    )

    assert stored["inserted"] == []
    assert ticket.saved == 0


def test_the_team_can_reopen_a_closed_ticket(stored):
    ticket = _StubTicket(3, cust_id=4, status=TicketStatus.closed)
    stored["ticket"] = ticket

    asyncio.run(
        tickets.update_ticket_status(UpdateTicketStatusRequest(ticket_id=3, status=TicketStatus.open), _StubUser())
    )

    assert ticket.status == TicketStatus.open


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def test_subject_is_trimmed_and_required():
    assert tickets._clean_subject("  Late delivery ") == "Late delivery"
    with pytest.raises(HTTPException):
        tickets._clean_subject("   ")
    with pytest.raises(HTTPException):
        tickets._clean_subject("x" * (tickets.SUBJECT_MAX_LENGTH + 1))


# ---------------------------------------------------------------------------
# Related order
# ---------------------------------------------------------------------------
class _StubOrder:
    def __init__(self, order_id: int, cust_id: int, is_deleted: bool = False) -> None:
        self.id = order_id
        self.cust_id = cust_id
        self.is_deleted = is_deleted


@pytest.fixture
def orders(monkeypatch):
    by_id: dict[int, _StubOrder] = {}

    async def _get(order_id):
        return by_id.get(order_id)

    monkeypatch.setattr(tickets.SalesOrders, "get", _get)
    return by_id


def test_no_order_is_fine(orders):
    assert asyncio.run(tickets._check_order(_StubCustomer(4), None)) is None


def test_the_clients_own_order_can_be_linked(orders):
    orders[11] = _StubOrder(11, cust_id=4)
    assert asyncio.run(tickets._check_order(_StubCustomer(4), 11)) == 11


@pytest.mark.parametrize(
    "order",
    [None, _StubOrder(11, cust_id=9), _StubOrder(11, cust_id=4, is_deleted=True)],
    ids=["missing", "another-clients", "deleted"],
)
def test_an_order_that_isnt_the_clients_is_refused(orders, order):
    if order is not None:
        orders[11] = order
    with pytest.raises(HTTPException) as error:
        asyncio.run(tickets._check_order(_StubCustomer(4), 11))
    # One answer for all three, so ids can't be probed.
    assert error.value.status_code == 400
    assert error.value.detail == "order not found for this client"
