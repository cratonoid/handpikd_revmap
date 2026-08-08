# Schema for the #personal_details collection: an EAV-style table (fixed
# id/attribute/value rows) holding Handpikd's own seller/company profile —
# used to render the letterhead, bank details, and terms & conditions on
# generated documents (invoices today, quotations later). Modeled as EAV
# rather than named fields to match the attribute list already designed for
# this table (attributes/services/personal_details.py holds the canonical
# id<->attribute mapping), and to leave room for quotation_tnc/quotation_notes
# which don't belong to invoices at all.
from beanie import Document


class PersonalDetails(Document):
    id: int
    attribute: str
    value: str

    class Settings:
        name = "personal_details"
