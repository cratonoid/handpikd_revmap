# Read/write helpers for the #personal_details EAV table (backend/app/models/
# personal_details.py). ATTRIBUTE_IDS is the single source of truth for which
# attributes exist and their fixed row ids — db.py's _seed_personal_details
# seeds one row per entry, and update_personal_details rejects anything not
# listed here.
from app.models import PersonalDetails

ATTRIBUTE_IDS: dict[str, int] = {
    "gstin": 1,
    "address": 2,
    "name": 3,
    "phone": 4,
    "email": 5,
    "website": 6,
    "bank_name": 7,
    "bank_branch": 8,
    "bank_account_no": 9,
    "bank_account_name": 10,
    "bank_ifsc": 11,
    "invoice_tnc": 12,
    "quotation_tnc": 13,
    "quotation_notes": 14,
    "qr_value": 15,
    # "name" is the invoice's contact person (top-right "Name" line); this is
    # the business name shown in the letterhead and the "For {company_name}"
    # signature line — kept separate since they're different values in
    # practice (e.g. "Handpikd" vs. "Alvis Abreo").
    "company_name": 16,
    # "/media/signatures/<uuid>.<ext>" path (see services/storage.py's
    # upload_signature_image) of the company's own signature scan, embedded
    # on offline invoices — see routes/invoices.py's get_invoice_pdf and
    # services/invoice_pdf.py's show_signature param.
    "signature_image": 17,
}


async def get_personal_details() -> dict[str, str]:
    rows = await PersonalDetails.find_all().to_list()
    values = {row.attribute: row.value for row in rows}
    # Attributes never seeded (e.g. a fresh DB before startup seeding ran)
    # default to "" rather than a missing key, so callers can always index in.
    return {attribute: values.get(attribute, "") for attribute in ATTRIBUTE_IDS}


async def update_personal_details(values: dict[str, str]) -> None:
    unknown = set(values) - set(ATTRIBUTE_IDS)
    if unknown:
        raise ValueError(f"unknown attribute(s): {', '.join(sorted(unknown))}")

    for attribute, value in values.items():
        row_id = ATTRIBUTE_IDS[attribute]
        row = await PersonalDetails.get(row_id)
        if row is None:
            await PersonalDetails(id=row_id, attribute=attribute, value=value).insert()
        else:
            row.value = value
            await row.save()
