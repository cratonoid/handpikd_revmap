# Renders a LetterDetails row into a PDF on the company letterhead. Same
# pipeline as quotation_pdf.py — a Jinja2 template (app/templates/letter.html)
# rasterized by the shared headless Chromium (pdf_renderer.py) — and the same
# letterhead: logo, contact block and the yellow/black corner accents, so a
# letter and a quotation sent to the same client look like they came from
# the same desk. Pure rendering only; routes/letters.py does the lookups.
from __future__ import annotations

from datetime import datetime

from app.services.invoice_pdf import _resolve_media_path
from app.services.pdf_renderer import render_html_to_pdf
from app.services.quotation_pdf import (
    _FOOTER_TEMPLATE,
    _FULL_BLEED_MARGIN,
    _LOGO_DATA_URI,
    _env,
    _file_to_data_uri,
)


def _paragraphs(text: str) -> list[list[str]]:
    # A blank line starts a new paragraph; a single newline inside one is a
    # line break (an address, a list of items). Returned as lines rather than
    # pre-joined HTML so the template's autoescaping still applies to the
    # admin's text.
    paragraphs: list[list[str]] = []
    current: list[str] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.strip():
            current.append(line.rstrip())
        elif current:
            paragraphs.append(current)
            current = []
    if current:
        paragraphs.append(current)
    return paragraphs


async def generate_letter_pdf(
    *,
    letter_no: int,
    letter_date: datetime,
    recipient_name: str,
    recipient_address: str,
    subject: str,
    salutation: str,
    body: str,
    closing: str,
    signatory_name: str,
    signatory_designation: str,
    include_signature: bool,
    personal: dict[str, str],
) -> bytes:
    signature_data_uri = None
    if include_signature:
        signature_path = _resolve_media_path(personal.get("signature_image", ""))
        if signature_path is not None:
            signature_data_uri = _file_to_data_uri(signature_path)

    template = _env.get_template("letter.html")
    html_content = template.render(
        logo_data_uri=_LOGO_DATA_URI,
        company_name=personal.get("company_name") or "Handpikd",
        personal=personal,
        letter_no=letter_no,
        letter_date=letter_date.strftime("%d %b, %Y"),
        recipient_name=recipient_name,
        recipient_address_lines=[line.strip() for line in recipient_address.splitlines() if line.strip()],
        subject=subject.strip(),
        salutation=salutation.strip(),
        body_paragraphs=_paragraphs(body),
        closing=closing.strip(),
        signatory_name=signatory_name.strip(),
        signatory_designation=signatory_designation.strip(),
        signature_data_uri=signature_data_uri,
    )

    return await render_html_to_pdf(
        html_content,
        footer_template=_FOOTER_TEMPLATE,
        margin=_FULL_BLEED_MARGIN,
    )
