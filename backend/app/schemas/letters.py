# Request/response bodies for the letters module's endpoints.
from datetime import date

from pydantic import BaseModel, field_validator


class _LetterPayloadBase(BaseModel):
    date: date
    recipient_name: str
    recipient_address: str = ""
    subject: str = ""
    salutation: str = ""
    body: str
    closing: str = ""
    signatory_name: str = ""
    signatory_designation: str = ""
    include_signature: bool = False
    acknowledgement: str = ""

    @field_validator("recipient_name", "body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value


class CreateNewLetterRequest(_LetterPayloadBase):
    pass


class CreateNewLetterResponse(BaseModel):
    message: str
    id: int
    letter_no: int


class LetterDetailItem(BaseModel):
    id: int
    letter_no: int
    date: date
    recipient_name: str
    recipient_address: str
    subject: str
    salutation: str
    body: str
    closing: str
    signatory_name: str
    signatory_designation: str
    include_signature: bool
    acknowledgement: str
    is_deleted: bool


class UpdateLetterDetailsRequest(_LetterPayloadBase):
    id: int
    is_deleted: bool = False


class UpdateLetterDetailsResponse(BaseModel):
    message: str
