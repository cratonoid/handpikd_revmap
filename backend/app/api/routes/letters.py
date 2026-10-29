# Letters module: endpoints for drafting general letters on the company
# letterhead (to a client, a bank, a landlord — anything that isn't a
# quotation or an invoice) and generating their PDFs. Gated on
# Section.letters, same shape as routes/quotations.py.
#
# A letter's addressee is free text, snapshotted onto the letter itself: the
# form can prefill it from a client, but a letter is a record of what was
# sent, so a later edit to that client's address shouldn't rewrite it.
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.deps import require_section
from app.models import LetterDetails, LetterIdCounter, Section, User
from app.schemas.letters import (
    CreateNewLetterRequest,
    CreateNewLetterResponse,
    LetterDetailItem,
    UpdateLetterDetailsRequest,
    UpdateLetterDetailsResponse,
)
from app.services.counters import get_next_id
from app.services.letter_pdf import generate_letter_pdf
from app.services.personal_details import get_personal_details

router = APIRouter(prefix="/admin", tags=["letters"])


def _apply_payload(letter: LetterDetails, payload: CreateNewLetterRequest | UpdateLetterDetailsRequest) -> None:
    letter.date = datetime.combine(payload.date, datetime.min.time())
    letter.recipient_name = payload.recipient_name.strip()
    letter.recipient_address = payload.recipient_address.strip()
    letter.subject = payload.subject.strip()
    letter.salutation = payload.salutation.strip()
    letter.body = payload.body.strip()
    letter.closing = payload.closing.strip()
    letter.signatory_name = payload.signatory_name.strip()
    letter.signatory_designation = payload.signatory_designation.strip()
    letter.include_signature = payload.include_signature


@router.post("/create_new_letter", response_model=CreateNewLetterResponse)
async def create_new_letter(
    payload: CreateNewLetterRequest,
    _: User | None = Depends(require_section(Section.letters)),
) -> CreateNewLetterResponse:
    letter_id = await get_next_id(LetterIdCounter, "next_letter_id", LetterDetails)
    letter = LetterDetails(
        id=letter_id,
        letter_no=letter_id,
        date=datetime.combine(payload.date, datetime.min.time()),
        recipient_name=payload.recipient_name,
        body=payload.body,
    )
    _apply_payload(letter, payload)
    await letter.insert()

    # Carries id/letter_no back for the same reason create_new_quotation
    # does: the form's "Generate" button chains straight into the PDF.
    return CreateNewLetterResponse(message="letter successfully created", id=letter.id, letter_no=letter.letter_no)


@router.get("/get_letter_details", response_model=list[LetterDetailItem])
async def get_letter_details(
    _: User | None = Depends(require_section(Section.letters)),
) -> list[LetterDetailItem]:
    letters = await LetterDetails.find(LetterDetails.is_deleted == False).to_list()
    return [
        LetterDetailItem(
            id=letter.id,
            letter_no=letter.letter_no,
            date=letter.date.date(),
            recipient_name=letter.recipient_name,
            recipient_address=letter.recipient_address,
            subject=letter.subject,
            salutation=letter.salutation,
            body=letter.body,
            closing=letter.closing,
            signatory_name=letter.signatory_name,
            signatory_designation=letter.signatory_designation,
            include_signature=letter.include_signature,
            is_deleted=letter.is_deleted,
        )
        for letter in letters
    ]


@router.post("/update_letter_details", response_model=UpdateLetterDetailsResponse)
async def update_letter_details(
    payload: UpdateLetterDetailsRequest,
    _: User | None = Depends(require_section(Section.letters)),
) -> UpdateLetterDetailsResponse:
    letter = await LetterDetails.get(payload.id)
    if letter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="letter not found")

    _apply_payload(letter, payload)
    letter.is_deleted = payload.is_deleted
    await letter.save()

    return UpdateLetterDetailsResponse(message="letter updated successfully")


@router.get("/get_letter_pdf")
async def get_letter_pdf(
    letter_id: int,
    _: User | None = Depends(require_section(Section.letters)),
) -> Response:
    letter = await LetterDetails.get(letter_id)
    if letter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="letter not found")

    personal = await get_personal_details()

    pdf_bytes = await generate_letter_pdf(
        letter_no=letter.letter_no,
        letter_date=letter.date,
        recipient_name=letter.recipient_name,
        recipient_address=letter.recipient_address,
        subject=letter.subject,
        salutation=letter.salutation,
        body=letter.body,
        closing=letter.closing,
        signatory_name=letter.signatory_name,
        signatory_designation=letter.signatory_designation,
        include_signature=letter.include_signature,
        personal=personal,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="letter-{letter.letter_no}.pdf"'},
    )
