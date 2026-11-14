# Support tickets: a client (or a team member on the client's behalf) raises a
# ticket, both sides post messages on the same thread, and the team moves it
# through open -> in progress -> resolved -> closed.
#
# Two routers, same split as customer_invoices.py vs the admin modules:
#
#   - customer_router (/customer/...) is scoped to the CustomerDetails row
#     behind the signed-in login (require_customer_account). It authenticates
#     for real even with settings.auth_enabled off, for the same reason the
#     invoice portal does: it has to know which client is asking.
#   - router (/admin/tickets/...) sits behind require_section(Section.tickets)
#     and covers every client's tickets.
#
# A client can never set a ticket's status directly. The one way their action
# moves it is replying to a resolved ticket, which reopens it (see
# TicketStatus).
#
# Both sides hear about the other's activity through the notification module
# (services/notifications.py). The team is told of a new ticket from a client
# and of a client reply; the client is told when the team replies, or raises
# a ticket for them. Nobody is notified of their own side's actions.
from datetime import datetime, timezone

from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_section
from app.api.routes.customer_invoices import require_customer_account
from app.models import (
    CustomerDetails,
    SalesOrders,
    Section,
    Ticket,
    TicketIdCounter,
    TicketMessage,
    TicketMessageIdCounter,
    TicketMessageKind,
    TicketSide,
    TicketStatus,
    User,
)
from app.schemas.tickets import (
    CreateMyTicketRequest,
    CreateTicketRequest,
    PostTicketMessageRequest,
    TicketDetail,
    TicketListItem,
    TicketMessageItem,
    TicketOrderOption,
    UpdateTicketStatusRequest,
)
from app.services.counters import get_next_id
from app.services.notifications import notify

router = APIRouter(prefix="/admin/tickets", tags=["tickets"])

customer_router = APIRouter(prefix="/customer", tags=["customer-tickets"])

_require_tickets = require_section(Section.tickets)

SUBJECT_MAX_LENGTH = 200
MESSAGE_MAX_LENGTH = 10_000

# What a client sees as the author of a team message when no named team
# member wrote it (auth disabled, or an account with no display name).
TEAM_FALLBACK_NAME = "Handpikd team"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _customer_label(customer: CustomerDetails | None) -> str:
    if customer is None:
        return "Unknown client"
    if customer.company_or_department:
        return f"{customer.registered_name} · {customer.company_or_department}"
    return customer.registered_name


def _ticket_link(ticket: Ticket) -> str:
    return f"/admin/tickets?ticket={ticket.id}"


def _client_ticket_link(ticket: Ticket) -> str:
    return f"/customer/tickets?ticket={ticket.id}"


async def _notify_client(kind: str, title: str, ticket: Ticket, customer: CustomerDetails | None, body: str) -> None:
    # Addressed to the client's own login only (see models/notification.py).
    if customer is None or customer.is_deleted:
        return
    await notify(
        kind,
        title,
        Section.tickets,
        body=body,
        link=_client_ticket_link(ticket),
        recipient_user_id=customer.user_id,
    )


def _preview(body: str, limit: int = 140) -> str:
    return body if len(body) <= limit else f"{body[: limit - 1].rstrip()}…"


def _team_author_name(user: User | None) -> str:
    return (user.name.strip() if user is not None else "") or TEAM_FALLBACK_NAME


def _clean_subject(subject: str) -> str:
    subject = subject.strip()
    if not subject:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="subject is required")
    if len(subject) > SUBJECT_MAX_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"subject must be at most {SUBJECT_MAX_LENGTH} characters",
        )
    return subject


def _clean_body(body: str) -> str:
    body = body.strip()
    if not body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="message is required")
    if len(body) > MESSAGE_MAX_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"message must be at most {MESSAGE_MAX_LENGTH} characters",
        )
    return body


def _check_open_for_messages(ticket: Ticket) -> None:
    if ticket.status == TicketStatus.closed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="this ticket is closed and can't take new messages",
        )


async def _order_options(customer: CustomerDetails) -> list[TicketOrderOption]:
    # The client's live orders, newest first, for the "Related order" picker.
    orders = (
        await SalesOrders.find(SalesOrders.cust_id == customer.id, SalesOrders.is_deleted == False)  # noqa: E712
        .sort(-SalesOrders.date, -SalesOrders.id)
        .to_list()
    )
    return [
        TicketOrderOption(
            id=order.id,
            order_no=order.order_no,
            date=order.date,
            total_amount_after_tax=order.total_amount_after_tax,
        )
        for order in orders
    ]


async def _check_order(customer: CustomerDetails, sales_order_id: int | None) -> int | None:
    # The same "order not found" whether the id doesn't exist, is deleted or
    # belongs to another client, so a client can't probe for other orders.
    if sales_order_id is None:
        return None
    order = await SalesOrders.get(sales_order_id)
    if order is None or order.is_deleted or order.cust_id != customer.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="order not found for this client")
    return order.id


async def _add_message(
    ticket: Ticket,
    side: TicketSide,
    author_user_id: int | None,
    author_name: str,
    body: str,
) -> None:
    now = _now()
    message_id = await get_next_id(TicketMessageIdCounter, "next_ticket_message_id", TicketMessage)
    await TicketMessage(
        id=message_id,
        ticket_id=ticket.id,
        kind=TicketMessageKind.message,
        side=side,
        author_user_id=author_user_id,
        author_name=author_name,
        body=body,
        created_at=now,
    ).insert()

    ticket.last_message_at = now
    ticket.last_message_by = side
    ticket.updated_at = now
    await ticket.save()


async def _create_ticket(
    customer: CustomerDetails,
    subject: str,
    message: str,
    side: TicketSide,
    user_id: int | None,
    author_name: str,
    sales_order_id: int | None = None,
) -> Ticket:
    # All validated before anything is written, so a bad message or order
    # can't leave behind a half-made ticket.
    subject = _clean_subject(subject)
    body = _clean_body(message)
    sales_order_id = await _check_order(customer, sales_order_id)

    now = _now()
    ticket_id = await get_next_id(TicketIdCounter, "next_ticket_id", Ticket)
    ticket = Ticket(
        id=ticket_id,
        cust_id=customer.id,
        sales_order_id=sales_order_id,
        subject=subject,
        status=TicketStatus.open,
        raised_by=side,
        raised_by_user_id=user_id,
        created_at=now,
        updated_at=now,
        last_message_at=now,
        last_message_by=side,
    )
    await ticket.insert()
    await _add_message(ticket, side, user_id, author_name, body)
    return ticket


async def _message_counts(ticket_ids: list[int]) -> dict[int, int]:
    # Status-change entries are left out: the count is "how much has been
    # said", and a ticket the team only closed hasn't gained a reply.
    if not ticket_ids:
        return {}
    collection = TicketMessage.get_pymongo_collection()
    cursor = await collection.aggregate(
        [
            {"$match": {"ticket_id": {"$in": ticket_ids}, "kind": TicketMessageKind.message.value}},
            {"$group": {"_id": "$ticket_id", "count": {"$sum": 1}}},
        ]
    )
    return {row["_id"]: row["count"] async for row in cursor}


async def _order_nos(sales_order_ids: list[int]) -> dict[int, int]:
    if not sales_order_ids:
        return {}
    orders = await SalesOrders.find(In(SalesOrders.id, sales_order_ids)).to_list()
    return {order.id: order.order_no for order in orders}


def _to_list_item(
    ticket: Ticket, customer_name: str, message_count: int, order_no_by_id: dict[int, int]
) -> TicketListItem:
    return TicketListItem(
        id=ticket.id,
        cust_id=ticket.cust_id,
        customer_name=customer_name,
        sales_order_id=ticket.sales_order_id,
        # None if the order was hard-deleted since; the id is kept regardless.
        order_no=order_no_by_id.get(ticket.sales_order_id) if ticket.sales_order_id is not None else None,
        subject=ticket.subject,
        status=ticket.status,
        raised_by=ticket.raised_by,
        created_at=ticket.created_at,
        last_message_at=ticket.last_message_at,
        last_message_by=ticket.last_message_by,
        message_count=message_count,
    )


async def _to_detail(ticket: Ticket, customer: CustomerDetails | None) -> TicketDetail:
    messages = (
        await TicketMessage.find(TicketMessage.ticket_id == ticket.id)
        .sort(+TicketMessage.created_at, +TicketMessage.id)
        .to_list()
    )
    message_count = sum(1 for message in messages if message.kind == TicketMessageKind.message)
    order_nos = await _order_nos([ticket.sales_order_id] if ticket.sales_order_id is not None else [])
    base = _to_list_item(ticket, _customer_label(customer), message_count, order_nos)
    return TicketDetail(
        **base.model_dump(),
        messages=[
            TicketMessageItem(
                id=message.id,
                kind=message.kind,
                side=message.side,
                author_name=message.author_name,
                body=message.body,
                new_status=message.new_status,
                created_at=message.created_at,
            )
            for message in messages
        ],
    )


async def _list_items(tickets: list[Ticket]) -> list[TicketListItem]:
    cust_ids = sorted({ticket.cust_id for ticket in tickets})
    customers = await CustomerDetails.find(In(CustomerDetails.id, cust_ids)).to_list() if cust_ids else []
    label_by_id = {customer.id: _customer_label(customer) for customer in customers}
    counts = await _message_counts([ticket.id for ticket in tickets])
    order_nos = await _order_nos(sorted({t.sales_order_id for t in tickets if t.sales_order_id is not None}))
    return [
        _to_list_item(
            ticket, label_by_id.get(ticket.cust_id, _customer_label(None)), counts.get(ticket.id, 0), order_nos
        )
        for ticket in tickets
    ]


# ---------------------------------------------------------------------------
# Client portal
# ---------------------------------------------------------------------------
async def _get_owned_ticket_or_404(ticket_id: int, customer: CustomerDetails) -> Ticket:
    ticket = await Ticket.get(ticket_id)
    # 404 rather than 403 on another client's ticket, same reasoning as
    # _get_owned_invoice_or_404: walking ids mustn't reveal what exists.
    if ticket is None or ticket.cust_id != customer.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ticket not found")
    return ticket


@customer_router.get("/get_my_tickets", response_model=list[TicketListItem])
async def get_my_tickets(
    customer: CustomerDetails = Depends(require_customer_account),
) -> list[TicketListItem]:
    tickets = await Ticket.find(Ticket.cust_id == customer.id).sort(-Ticket.last_message_at, -Ticket.id).to_list()
    return await _list_items(tickets)


@customer_router.get("/get_my_ticket_details", response_model=TicketDetail)
async def get_my_ticket_details(
    ticket_id: int,
    customer: CustomerDetails = Depends(require_customer_account),
) -> TicketDetail:
    ticket = await _get_owned_ticket_or_404(ticket_id, customer)
    return await _to_detail(ticket, customer)


@customer_router.get("/get_my_ticket_orders", response_model=list[TicketOrderOption])
async def get_my_ticket_orders(
    customer: CustomerDetails = Depends(require_customer_account),
) -> list[TicketOrderOption]:
    return await _order_options(customer)


@customer_router.post("/create_my_ticket", response_model=TicketDetail)
async def create_my_ticket(
    payload: CreateMyTicketRequest,
    customer: CustomerDetails = Depends(require_customer_account),
) -> TicketDetail:
    ticket = await _create_ticket(
        customer,
        payload.subject,
        payload.message,
        TicketSide.client,
        customer.user_id,
        customer.registered_name,
        payload.sales_order_id,
    )
    await notify(
        "ticket.raised",
        f"New ticket #{ticket.id} from {_customer_label(customer)}",
        Section.tickets,
        body=ticket.subject,
        link=_ticket_link(ticket),
    )
    return await _to_detail(ticket, customer)


@customer_router.post("/post_my_ticket_message", response_model=TicketDetail)
async def post_my_ticket_message(
    payload: PostTicketMessageRequest,
    customer: CustomerDetails = Depends(require_customer_account),
) -> TicketDetail:
    ticket = await _get_owned_ticket_or_404(payload.ticket_id, customer)
    _check_open_for_messages(ticket)
    body = _clean_body(payload.body)

    # A reply on a resolved ticket says it isn't resolved after all.
    if ticket.status == TicketStatus.resolved:
        ticket.status = TicketStatus.open

    await _add_message(ticket, TicketSide.client, customer.user_id, customer.registered_name, body)
    await notify(
        "ticket.client_replied",
        f"{_customer_label(customer)} replied on ticket #{ticket.id}",
        Section.tickets,
        body=_preview(body),
        link=_ticket_link(ticket),
    )
    return await _to_detail(ticket, customer)


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------
async def _get_ticket_or_404(ticket_id: int) -> Ticket:
    ticket = await Ticket.get(ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ticket not found")
    return ticket


@router.get("/get_tickets", response_model=list[TicketListItem])
async def get_tickets(_: User | None = Depends(_require_tickets)) -> list[TicketListItem]:
    tickets = await Ticket.find_all().sort(-Ticket.last_message_at, -Ticket.id).to_list()
    return await _list_items(tickets)


@router.get("/get_ticket_details", response_model=TicketDetail)
async def get_ticket_details(ticket_id: int, _: User | None = Depends(_require_tickets)) -> TicketDetail:
    ticket = await _get_ticket_or_404(ticket_id)
    return await _to_detail(ticket, await CustomerDetails.get(ticket.cust_id))


@router.get("/get_client_orders", response_model=list[TicketOrderOption])
async def get_client_orders(cust_id: int, _: User | None = Depends(_require_tickets)) -> list[TicketOrderOption]:
    # Lives under Tickets rather than Orders so a role with only the Tickets
    # section can still fill in the picker.
    customer = await CustomerDetails.get(cust_id)
    if customer is None or customer.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="client not found")
    return await _order_options(customer)


@router.post("/create_ticket", response_model=TicketDetail)
async def create_ticket(
    payload: CreateTicketRequest,
    current_user: User | None = Depends(_require_tickets),
) -> TicketDetail:
    customer = await CustomerDetails.get(payload.cust_id)
    if customer is None or customer.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="client not found")

    ticket = await _create_ticket(
        customer,
        payload.subject,
        payload.message,
        TicketSide.team,
        current_user.id if current_user is not None else None,
        _team_author_name(current_user),
        payload.sales_order_id,
    )
    await _notify_client(
        "ticket.raised_for_client",
        f"The Handpikd team opened ticket #{ticket.id} for you",
        ticket,
        customer,
        ticket.subject,
    )
    return await _to_detail(ticket, customer)


@router.post("/post_ticket_message", response_model=TicketDetail)
async def post_ticket_message(
    payload: PostTicketMessageRequest,
    current_user: User | None = Depends(_require_tickets),
) -> TicketDetail:
    ticket = await _get_ticket_or_404(payload.ticket_id)
    _check_open_for_messages(ticket)
    body = _clean_body(payload.body)

    author_name = _team_author_name(current_user)
    await _add_message(
        ticket,
        TicketSide.team,
        current_user.id if current_user is not None else None,
        author_name,
        body,
    )
    customer = await CustomerDetails.get(ticket.cust_id)
    await _notify_client(
        "ticket.team_replied",
        f"{author_name} replied on ticket #{ticket.id}",
        ticket,
        customer,
        _preview(body),
    )
    return await _to_detail(ticket, customer)


@router.post("/update_ticket_status", response_model=TicketDetail)
async def update_ticket_status(
    payload: UpdateTicketStatusRequest,
    current_user: User | None = Depends(_require_tickets),
) -> TicketDetail:
    ticket = await _get_ticket_or_404(payload.ticket_id)

    if ticket.status != payload.status:
        now = _now()
        message_id = await get_next_id(TicketMessageIdCounter, "next_ticket_message_id", TicketMessage)
        await TicketMessage(
            id=message_id,
            ticket_id=ticket.id,
            kind=TicketMessageKind.status_change,
            side=TicketSide.team,
            author_user_id=current_user.id if current_user is not None else None,
            author_name=_team_author_name(current_user),
            new_status=payload.status,
            created_at=now,
        ).insert()

        # last_message_* is left alone: a status change isn't a reply, so it
        # mustn't clear the "awaiting reply" flag on a client's message.
        ticket.status = payload.status
        ticket.updated_at = now
        await ticket.save()

    return await _to_detail(ticket, await CustomerDetails.get(ticket.cust_id))
