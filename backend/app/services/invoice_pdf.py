# Renders an InvoiceDetails row (plus its joined sales order/line items/
# customer/seller data) into a PDF matching Handpikd's brand — a
# Jinja2-templated HTML document (app/templates/invoice.html) rasterized by
# headless Chromium, the same pipeline quotation_pdf.py uses. Swap the
# template's markup to restyle the document without touching this module.
# Pure rendering only — routes/invoices.py (and purchase_invoice_pdf.py, a
# thin relabeling wrapper around this same function) do all the DB lookups
# and joins and pass plain data in.
from __future__ import annotations

import base64
import io
import mimetypes
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import qrcode
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import settings
from app.services.gst import (
    TaxKind,
    place_of_supply_text as _place_of_supply_text,
    split_tax,
    state_code_from_gstin,
    tax_kind_for,
)
from app.services.number_to_words import rupees_to_words
from app.services.pdf_renderer import render_html_to_pdf
from app.services.storage import MEDIA_URL_PREFIX

_APP_DIR = Path(__file__).resolve().parent.parent
_TEMPLATE_DIR = _APP_DIR / "templates"
_env = Environment(loader=FileSystemLoader(_TEMPLATE_DIR), autoescape=select_autoescape(["html"]))

# Same company logo asset quotation_pdf.py uses for its letterhead — one
# brand mark, not a quotation-specific one, despite the filename.
_LOGO_PATH = _APP_DIR / "static" / "quotation_logo.png"


def _file_to_data_uri(path: Path) -> str | None:
    if not path.is_file():
        return None
    mime_type, _ = mimetypes.guess_type(path.name)
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type or 'application/octet-stream'};base64,{encoded}"


# Read once at import time — the logo is a static repo asset, not per-request
# data.
_LOGO_DATA_URI = _file_to_data_uri(_LOGO_PATH)


def _resolve_media_path(url_path: str) -> Path | None:
    if not url_path:
        return None
    relative = url_path.removeprefix(f"{MEDIA_URL_PREFIX}/")
    path = Path(settings.media_root) / relative
    return path if path.is_file() else None


@dataclass
class InvoiceLineItem:
    product_name: str
    hsn_code: str
    quantity: int
    rate: float
    taxable_value: float
    tax_perc: float
    tax_amount: float
    total: float


def _amount(value: float) -> str:
    return f"{value:,.2f}"


def _money(value: float) -> str:
    # Only the grand-total line carries a currency mark in the sample
    # ("Rs." rather than "₹" — kept from the previous ReportLab rendering,
    # where the base-14 PDF fonts didn't include the Rupee glyph; harmless to
    # keep for visual consistency with quotation_pdf.py's _money now that
    # rendering goes through a real browser).
    return f"Rs.{value:,.2f}"


# Narrower than pdf_renderer's default so the invoice's ruled grid runs close
# to the paper edge, the way a printed GST invoice does — the template is one
# full-width bordered table, not a letterhead with breathing room. The
# resulting content box is handed to the template too, which stretches its
# line-item grid to fill the leftover height.
_A4_WIDTH_MM, _A4_HEIGHT_MM = 210, 297
_MARGIN_MM = {"top": 10, "right": 10, "bottom": 12, "left": 10}
_PAGE_MARGIN = {side: f"{value}mm" for side, value in _MARGIN_MM.items()}
_CONTENT_WIDTH_MM = _A4_WIDTH_MM - _MARGIN_MM["left"] - _MARGIN_MM["right"]
_CONTENT_HEIGHT_MM = _A4_HEIGHT_MM - _MARGIN_MM["top"] - _MARGIN_MM["bottom"]

# See quotation_pdf.py's _FOOTER_TEMPLATE for why this is a separate HTML
# snippet rather than a CSS @page rule.
_FOOTER_TEMPLATE = """
<div style="width: 100%; font-family: Helvetica, Arial, sans-serif; font-size: 7.5px; color: #888; text-align: right; padding-right: 10mm;">
  Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>
"""


async def generate_invoice_pdf(
    *,
    invoice_no: int | str,
    invoice_date: datetime,
    due_date: datetime,
    transport: str,
    line_items: list[InvoiceLineItem],
    total_amount_before_tax: float,
    total_tax_amount: float,
    total_amount_after_tax: float,
    customer_name: str,
    customer_address: str,
    customer_phone: str,
    customer_gstin: str,
    personal: dict[str, str],
    title_text: str = "TAX INVOICE",
    party_label: str = "Customer",
    show_signature: bool = False,
    tax_kind: TaxKind | None = None,
    place_of_supply_code: str = "",
) -> bytes:
    # tax_kind/place_of_supply_code are the values the document was raised
    # with (InvoiceDetails/PurchaseInvoiceDetails snapshot both), so a
    # reprint states what went out originally even if the party's state has
    # since been corrected. Documents raised before those columns existed
    # pass neither, and fall back to deciding from the two GSTINs — which is
    # all this function ever had to go on.
    if tax_kind is None:
        tax_kind = tax_kind_for(state_code_from_gstin(customer_gstin), state_code_from_gstin(personal.get("gstin")))
    if not place_of_supply_code:
        place_of_supply_code = state_code_from_gstin(customer_gstin) or ""
    intra_state = tax_kind == TaxKind.cgst_sgst

    rendered_items = []
    for index, item in enumerate(line_items, start=1):
        tax = split_tax(item.tax_perc, item.tax_amount, tax_kind)
        rendered_items.append(
            {
                "sr_no": index,
                "product_name": item.product_name,
                "hsn_code": item.hsn_code,
                "quantity": _amount(item.quantity),
                "rate": _amount(item.rate),
                "taxable_value": _amount(item.taxable_value),
                "tax_perc_1": f"{(tax.cgst_perc if intra_state else tax.igst_perc):.2f}",
                "tax_amount_1": _amount(tax.cgst_amount if intra_state else tax.igst_amount),
                "tax_perc_2": f"{tax.sgst_perc:.2f}" if intra_state else None,
                "tax_amount_2": _amount(tax.sgst_amount) if intra_state else None,
                "total": _amount(item.total),
            }
        )

    total_qty = sum(item.quantity for item in line_items)

    place_of_supply = _place_of_supply_text(place_of_supply_code)

    signature_data_uri = None
    if show_signature:
        signature_path = _resolve_media_path(personal.get("signature_image", ""))
        if signature_path is not None:
            signature_data_uri = _file_to_data_uri(signature_path)

    qr_data_uri = None
    qr_value = personal.get("qr_value", "")
    if qr_value:
        qr_img = qrcode.make(qr_value)
        qr_buffer = io.BytesIO()
        qr_img.save(qr_buffer, format="PNG")
        qr_data_uri = f"data:image/png;base64,{base64.b64encode(qr_buffer.getvalue()).decode('ascii')}"

    template = _env.get_template("invoice.html")
    html_content = template.render(
        content_height_mm=_CONTENT_HEIGHT_MM,
        logo_data_uri=_LOGO_DATA_URI,
        company_name=personal.get("company_name") or "Handpikd",
        personal=personal,
        title_text=title_text,
        party_label=party_label,
        invoice_no=invoice_no,
        invoice_date=invoice_date.strftime("%d-%b-%Y"),
        due_date=due_date.strftime("%d-%b-%Y"),
        transport=transport or "-",
        customer_name=customer_name,
        customer_address=customer_address,
        customer_phone=customer_phone or "-",
        customer_gstin=customer_gstin or "-",
        place_of_supply=place_of_supply,
        intra_state=intra_state,
        line_items=rendered_items,
        total_qty=_amount(total_qty),
        total_amount_before_tax=_amount(total_amount_before_tax),
        tax_total_1=_amount(total_tax_amount / 2 if intra_state else total_tax_amount),
        tax_total_2=_amount(total_tax_amount / 2) if intra_state else None,
        total_tax_amount=_amount(total_tax_amount),
        total_amount_after_tax=_amount(total_amount_after_tax),
        grand_total_money=_money(total_amount_after_tax),
        amount_in_words=rupees_to_words(total_amount_after_tax),
        bank_details=[
            ("Name", personal.get("bank_name", "")),
            ("Branch", personal.get("bank_branch", "")),
            ("Acc. Name", personal.get("bank_account_name", "")),
            ("Acc. Number", personal.get("bank_account_no", "")),
            ("IFSC", personal.get("bank_ifsc", "")),
        ],
        qr_data_uri=qr_data_uri,
        tnc_lines=[line.strip() for line in personal.get("invoice_tnc", "").splitlines() if line.strip()],
        signature_data_uri=signature_data_uri,
    )

    return await render_html_to_pdf(
        html_content,
        footer_template=_FOOTER_TEMPLATE,
        margin=_PAGE_MARGIN,
        layout_width_mm=_CONTENT_WIDTH_MM,
    )
