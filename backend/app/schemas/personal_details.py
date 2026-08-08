# Request/response bodies for the personal details (seller/company profile)
# module's endpoints.
from pydantic import BaseModel, model_validator

from app.services.personal_details import ATTRIBUTE_IDS


class PersonalDetailsItem(BaseModel):
    attribute: str
    value: str


class UpdatePersonalDetailsRequest(BaseModel):
    # Partial update: only the attributes present are changed, so the
    # settings form doesn't need to round-trip quotation_tnc/quotation_notes
    # (owned by the not-yet-built quotations module) just to edit invoice
    # fields.
    values: dict[str, str]

    @model_validator(mode="after")
    def _check_known_attributes(self) -> "UpdatePersonalDetailsRequest":
        unknown = set(self.values) - set(ATTRIBUTE_IDS)
        if unknown:
            raise ValueError(f"unknown attribute(s): {', '.join(sorted(unknown))}")
        return self


class UpdatePersonalDetailsResponse(BaseModel):
    message: str
