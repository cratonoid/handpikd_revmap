# Read/write helpers for the #personal_details EAV table (backend/app/models/
# personal_details.py). ATTRIBUTE_IDS is the single source of truth for which
# attributes exist and their fixed row ids — db.py's _seed_personal_details
# seeds one row per entry, and update_personal_details rejects anything not
# listed here.
from app.models import PersonalDetails
from app.services.gst import normalise_state_code, state_code_from_gstin, state_name_for_code

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
    # Our own state, as a two-digit GST state code and its name — the
    # seller side of every intra/inter-state decision (see services/gst.py).
    # Seeded from "gstin"'s first two digits and auto-filled again by
    # update_personal_details whenever the GSTIN changes and the admin
    # hasn't set a state of their own, but editable, so a profile whose
    # GSTIN is blank or wrong can still state where we supply from.
    "state_code": 18,
    "state_name": 19,
}


async def get_personal_details() -> dict[str, str]:
    rows = await PersonalDetails.find_all().to_list()
    values = {row.attribute: row.value for row in rows}
    # Attributes never seeded (e.g. a fresh DB before startup seeding ran)
    # default to "" rather than a missing key, so callers can always index in.
    details = {attribute: values.get(attribute, "") for attribute in ATTRIBUTE_IDS}
    return _with_state_filled_in(details)


def _with_state_filled_in(details: dict[str, str]) -> dict[str, str]:
    """Fills a blank state_code/state_name in from the GSTIN.

    Profiles saved before state_code existed hold "" for it, and the tax
    split can't fall back to the GSTIN the way services/gst.py's
    resolve_state_code does for a party record — the profile form reads
    these two attributes directly and would show them empty. Deriving here
    keeps the read path and the form agreeing, and the next save persists
    what the admin saw.
    """
    state_code = normalise_state_code(details.get("state_code")) or state_code_from_gstin(details.get("gstin"))
    details["state_code"] = state_code or ""
    details["state_name"] = state_name_for_code(state_code) or ""
    return details


async def update_personal_details(values: dict[str, str]) -> None:
    unknown = set(values) - set(ATTRIBUTE_IDS)
    if unknown:
        raise ValueError(f"unknown attribute(s): {', '.join(sorted(unknown))}")

    values = _resolve_state_in(values)

    for attribute, value in values.items():
        row_id = ATTRIBUTE_IDS[attribute]
        row = await PersonalDetails.get(row_id)
        if row is None:
            await PersonalDetails(id=row_id, attribute=attribute, value=value).insert()
        else:
            row.value = value
            await row.save()


def _resolve_state_in(values: dict[str, str]) -> dict[str, str]:
    """Normalises an incoming state_code and keeps state_name in step with it.

    An explicit state_code wins (that's the point of the field being
    editable); a blank one alongside a GSTIN falls back to the GSTIN's
    prefix, which is what makes "just paste the GSTIN" enough on the profile
    form. state_name is always derived rather than trusted, so it can never
    drift from the code the tax split actually reads. An unrecognised code
    is rejected outright — silently blanking it would flip every future
    invoice to IGST without anyone noticing.
    """
    if "state_code" not in values and "gstin" not in values:
        return values

    values = dict(values)
    raw = values.get("state_code", "")
    if raw.strip():
        state_code = normalise_state_code(raw)
        if state_code is None:
            raise ValueError(f"unknown GST state code: {raw}")
    else:
        state_code = state_code_from_gstin(values.get("gstin"))

    if state_code is None and "state_code" not in values:
        # A GSTIN-only update whose GSTIN has no usable state code: leave
        # whatever state the admin already set alone.
        return values

    values["state_code"] = state_code or ""
    values["state_name"] = state_name_for_code(state_code) or ""
    return values
