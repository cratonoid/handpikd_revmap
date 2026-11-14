# Request/response bodies for the Information section's endpoints
# (app/api/routes/information.py).
from pydantic import BaseModel, Field, field_validator


class _HolidayEventPayloadBase(BaseModel):
    month: int = Field(ge=1, le=12)
    name: str = Field(max_length=200)
    when: str = Field(default="", max_length=100)
    note: str = Field(default="", max_length=500)

    @field_validator("name")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value.strip()

    @field_validator("when", "note")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class AddHolidayEventRequest(_HolidayEventPayloadBase):
    pass


class UpdateHolidayEventRequest(_HolidayEventPayloadBase):
    id: int


class DeleteHolidayEventRequest(BaseModel):
    id: int


class HolidayEventItem(BaseModel):
    id: int
    month: int
    name: str
    when: str
    note: str
    sort_order: int
