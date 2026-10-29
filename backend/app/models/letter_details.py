# Schema for the #letter_details collection: a general-purpose letter drafted
# on the company letterhead (see services/letter_pdf.py). Unlike a quotation
# it carries no line items or totals — just the addressee and the prose.
from datetime import datetime

from beanie import Document


class LetterDetails(Document):
    id: int
    # The "Ref. No." printed on the letter. Drawn from the same counter as id
    # (see routes/letters.py) — a letter has no separate numbering series the
    # way invoices do, so a second counter would only ever mirror the first.
    letter_no: int
    date: datetime
    # Free text rather than a CustomerDetails FK: letters go to banks,
    # landlords and government offices as often as to clients. The form can
    # prefill these from a client, but what's stored is the snapshot.
    recipient_name: str
    recipient_address: str = ""
    subject: str = ""
    salutation: str = "Dear Sir/Madam,"
    body: str
    closing: str = "Yours sincerely,"
    signatory_name: str = ""
    signatory_designation: str = ""
    # Embeds personal_details' scanned signature_image above the signatory
    # line, same asset offline invoices use.
    include_signature: bool = False
    is_deleted: bool = False

    class Settings:
        name = "letter_details"
