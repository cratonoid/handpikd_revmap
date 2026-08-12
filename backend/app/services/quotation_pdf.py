# Renders a QuotationDetails row (plus its joined line items/customer/seller
# data) into a PDF. Fills a static Jinja2 HTML template
# (app/templates/quotation.html) and rasterizes it with a headless Chromium
# browser (see app/services/pdf_renderer.py) — the structure/styling
# therefore live in the template, not in this file. Swap the template's
# markup to restyle the document without touching this module. Pure
# rendering only — routes/quotations.py does all the DB lookups and joins
# (QuotationSummary, ProductDetails, ProductImageDetails, CustomerDetails,
# CustomerPocDetails, personal_details) and passes plain data in.
#
# Unlike invoice_pdf.py's tax-invoice layout (CGST/SGST vs IGST split,
# GSTIN/place-of-supply, bank details, signature block), a quotation isn't a
# GST document — it shows a flat "GST %" + amount per line (matching
# Handpikd's actual quotation format, a sample of which this was built
# against) rather than an interstate/intrastate tax split.
from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import settings
from app.services.pdf_renderer import render_html_to_pdf

_APP_DIR = Path(__file__).resolve().parent.parent
_TEMPLATE_DIR = _APP_DIR / "templates"
_env = Environment(loader=FileSystemLoader(_TEMPLATE_DIR), autoescape=select_autoescape(["html"]))

_LOGO_PATH = _APP_DIR / "static" / "quotation_logo.png"


def _file_to_data_uri(path: Path) -> str | None:
    if not path.is_file():
        return None
    mime_type, _ = mimetypes.guess_type(path.name)
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type or 'application/octet-stream'};base64,{encoded}"


# Read once at import time — the logo is a static repo asset, not
# per-request data.
_LOGO_DATA_URI = _file_to_data_uri(_LOGO_PATH)


def _product_image_data_uri(image_path: str | None) -> str | None:
    if not image_path:
        return None
    # image_path is stored as "/media/<file>" (see app/services/storage.py);
    # resolve it back to the on-disk file under media_root rather than
    # making an HTTP round trip to fetch it from the same process.
    filename = image_path.rsplit("/", 1)[-1]
    return _file_to_data_uri(Path(settings.media_root) / filename)


@dataclass
class QuotationLineItem:
    product_name: str
    image_path: str | None  # raw "/media/..." path, resolved to a data URI here
    unit_price: float  # product's listed/MRP price (informational reference)
    rate: float  # the actual per-unit price charged on this quotation line
    quantity: int
    tax_perc: float
    total: float  # (rate + rate * tax_perc / 100) * quantity, from QuotationSummary


def _money(value: float) -> str:
    # Same reasoning as invoice_pdf.py's _money: the rendered PDF's fonts
    # don't reliably carry the ₹ glyph, so "Rs." is used instead.
    return f"Rs.{value:,.2f}"


# Chromium's print-to-PDF has no equivalent of WeasyPrint's CSS `@page
# { @bottom-right { ... } }` paged-media syntax — page numbers are supplied
# as a separate HTML template instead, via pdf_renderer.py's footer_template
# param. "pageNumber"/"totalPages" are magic class names Chromium substitutes
# at render time.
_FOOTER_TEMPLATE = """
<div style="width: 100%; font-family: Helvetica, Arial, sans-serif; font-size: 7.5px; color: #888; text-align: right; padding-right: 16mm;">
  Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>
"""

# Printed edge-to-edge so the template's corner accents can bleed into the
# sheet's actual corners — a Chromium print margin would shrink the document's
# coordinate space and strand them at the margin's inner corner instead. The
# page margins are recreated inside the document by quotation.html's
# .page-frame (its repeating thead/tfoot spacers), which is also what keeps
# _FOOTER_TEMPLATE's page number off the content.
_FULL_BLEED_MARGIN = {"top": "0", "right": "0", "bottom": "0", "left": "0"}


async def generate_quotation_pdf(
    *,
    quotation_no: int,
    quotation_date: datetime,
    valid_till: datetime,
    status: str,
    line_items: list[QuotationLineItem],
    total_amount_after_tax: float,
    description: str,
    customer_name: str,
    customer_address: str,
    customer_phone: str,
    customer_gstin: str,
    personal: dict[str, str],
) -> bytes:
    rendered_items = []
    for index, item in enumerate(line_items, start=1):
        tax_per_unit = item.rate * (item.tax_perc / 100)
        # Informational only — if the line was priced above the product's
        # listed price (or the product has no listed price on file), there's
        # no meaningful "% off" to show rather than a negative/undefined one.
        discount_perc = (
            max(0.0, (item.unit_price - item.rate) / item.unit_price * 100) if item.unit_price > 0 else 0.0
        )
        rendered_items.append(
            {
                "sr_no": index,
                "product_name": item.product_name,
                "image_data_uri": _product_image_data_uri(item.image_path),
                "unit_price": item.unit_price,
                "rate": item.rate,
                "discount_perc": discount_perc,
                "quantity": item.quantity,
                "tax_perc": item.tax_perc,
                "tax_per_unit": tax_per_unit,
                "total": item.total,
            }
        )

    template = _env.get_template("quotation.html")
    html_content = template.render(
        logo_data_uri=_LOGO_DATA_URI,
        company_name=personal.get("company_name") or "Handpikd",
        personal=personal,
        quotation_no=quotation_no,
        quotation_date=quotation_date.strftime("%d %b, %Y"),
        valid_till=valid_till.strftime("%d %b, %Y"),
        status=status.title(),
        description=description,
        customer_name=customer_name,
        customer_address=customer_address,
        customer_phone=customer_phone or "-",
        customer_gstin=customer_gstin,
        line_items=rendered_items,
        total_amount_after_tax=total_amount_after_tax,
        money=_money,
        quotation_tnc=" ".join(line.strip() for line in personal.get("quotation_tnc", "").splitlines() if line.strip()),
        quotation_notes=[line.strip() for line in personal.get("quotation_notes", "").splitlines() if line.strip()],
    )

    return await render_html_to_pdf(
        html_content,
        footer_template=_FOOTER_TEMPLATE,
        margin=_FULL_BLEED_MARGIN,
    )
