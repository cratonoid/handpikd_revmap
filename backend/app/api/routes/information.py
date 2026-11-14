# Information section: reference material for the team. For now that's the
# editable holiday / gifting calendar (#holiday_event); later additions to
# the section get their own endpoints under the same prefix.
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_section
from app.models import HolidayEvent, HolidayEventIdCounter, Section, User
from app.schemas.information import (
    AddHolidayEventRequest,
    DeleteHolidayEventRequest,
    HolidayEventItem,
    UpdateHolidayEventRequest,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin/information", tags=["information"])

_require_information = require_section(Section.information)


def _to_item(event: HolidayEvent) -> HolidayEventItem:
    return HolidayEventItem(
        id=event.id,
        month=event.month,
        name=event.name,
        when=event.when,
        note=event.note,
        sort_order=event.sort_order,
    )


async def _next_sort_order(month: int) -> int:
    last = await HolidayEvent.find(HolidayEvent.month == month).sort(-HolidayEvent.sort_order).limit(1).to_list()
    return (last[0].sort_order + 1) if last else 0


async def _get_or_404(event_id: int) -> HolidayEvent:
    event = await HolidayEvent.get(event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="calendar entry not found")
    return event


@router.get("/get_holiday_events", response_model=list[HolidayEventItem])
async def get_holiday_events(_: User | None = Depends(_require_information)) -> list[HolidayEventItem]:
    events = await HolidayEvent.find_all().to_list()
    events.sort(key=lambda event: (event.month, event.sort_order, event.id))
    return [_to_item(event) for event in events]


@router.post("/add_holiday_event", response_model=HolidayEventItem)
async def add_holiday_event(
    payload: AddHolidayEventRequest,
    _: User | None = Depends(_require_information),
) -> HolidayEventItem:
    event_id = await get_next_id(HolidayEventIdCounter, "next_holiday_event_id", HolidayEvent)
    event = HolidayEvent(
        id=event_id,
        month=payload.month,
        name=payload.name,
        when=payload.when,
        note=payload.note,
        sort_order=await _next_sort_order(payload.month),
    )
    await event.insert()
    return _to_item(event)


@router.post("/update_holiday_event", response_model=HolidayEventItem)
async def update_holiday_event(
    payload: UpdateHolidayEventRequest,
    _: User | None = Depends(_require_information),
) -> HolidayEventItem:
    event = await _get_or_404(payload.id)
    if event.month != payload.month:
        # Moved to another month: goes to the end of that month's list.
        event.sort_order = await _next_sort_order(payload.month)
    event.month = payload.month
    event.name = payload.name
    event.when = payload.when
    event.note = payload.note
    await event.save()
    return _to_item(event)


@router.post("/delete_holiday_event")
async def delete_holiday_event(
    payload: DeleteHolidayEventRequest,
    _: User | None = Depends(_require_information),
) -> dict[str, str]:
    event = await _get_or_404(payload.id)
    await event.delete()
    return {"message": "calendar entry deleted"}
