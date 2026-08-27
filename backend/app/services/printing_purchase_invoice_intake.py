# Turns an uploaded printing-vendor invoice PDF into the values a printing
# purchase order form needs, or refuses it outright.
#
# The printing counterpart of services/purchase_invoice_intake.py, and much
# shorter than it for one reason: there is no product matching. A printing
# vendor bills a service they described themselves ("Customized Print
# Service", "Sticker Printing A3 UV"), which has no product behind it and
# isn't meant to have one, so every line is taken exactly as printed and no
# line can come back "unresolved". What's left is the checks that can still
# refuse an upload:
#   - the vendor on the invoice isn't one of ours (matched on GSTIN)
#   - that vendor isn't a PRINTING vendor, so this bill belongs on the
#     material side instead
#   - this invoice has already been recorded
#   - the PDF couldn't be read in full (raised by extract_invoice itself)
#
# A total that doesn't tie out is reported alongside the parsed values
# (total_mismatch) rather than refused, same as on the material side —
# printing bills carry the same freight, labour and round-off lines that no
# line item accounts for.
from dataclasses import dataclass
from datetime import datetime

from app.models import PrintingPurchaseInvoiceDetails, PrintingPurchaseOrders, VendorDetails
from app.models.vendor_details import VendorType
from app.services.gst import TaxKind, resolve_state_code, tax_kind_for
from app.services.invoice_extraction import ExtractedInvoice, InvoiceExtractionError, extract_invoice
from app.services.personal_details import get_personal_details
from app.services.purchase_invoice_intake import (
    DuplicateInvoiceError,
    InvoiceIntakeError,
    VendorNotFoundError,
    match_vendor,
)

# How far the line items' computed total may drift from the invoice's own
# printed total before the admin is told about it. Same rupee of slack the
# material side allows, for the same round-off line.
_TOTAL_TOLERANCE = 1.0


class WrongVendorTypeError(InvoiceIntakeError):
    """The invoice's vendor isn't a printing vendor."""


@dataclass(frozen=True)
class PrintingLineItem:
    # The service as the vendor printed it. This IS the line item — nothing
    # is resolved against our records, so unlike MatchedLineItem there is no
    # product and no unresolved_reason.
    description: str
    hsn_code: str
    quantity: int
    rate: float
    gst_perc: float


@dataclass(frozen=True)
class PrintingPurchaseInvoiceIntake:
    vendor_id: int
    vendor_name: str
    vendor_gstin: str
    invoice_no: str
    invoice_date: datetime
    line_items: tuple[PrintingLineItem, ...]
    # Which heads this purchase falls under. Decided from the two parties'
    # states, so it holds whether or not the lines share a rate.
    tax_kind: TaxKind
    # The single rate every line is taxed at, filed under the heads above —
    # all three None on an invoice whose lines are taxed at different rates.
    sgst_perc: float | None
    cgst_perc: float | None
    igst_perc: float | None
    total_amount_before_tax: float
    total_amount_after_tax: float
    printed_total: float | None
    total_mismatch: bool
    source: str


def _require_printing_vendor(vendor: VendorDetails) -> None:
    # A vendor with no type at all is a legacy row (see
    # VendorDetails.vendor_type) and is refused here rather than assumed:
    # this side of the app exists precisely because the two kinds of purchase
    # are recorded differently, so guessing which one an untyped vendor is
    # would file the bill in the wrong place — and setting the type on the
    # vendors page is a few seconds' work.
    if vendor.vendor_type == VendorType.printing:
        return

    if vendor.vendor_type == VendorType.material:
        raise WrongVendorTypeError(
            f"{vendor.registered_name} is a material vendor — record this invoice under "
            "Purchase orders / Material instead"
        )

    raise WrongVendorTypeError(
        f"{vendor.registered_name} has no vendor type on file — set it to Printing on the vendors page, "
        "then upload this invoice"
    )


def _single_gst_perc(line_items: tuple[PrintingLineItem, ...]) -> float | None:
    """The one rate every line is taxed at, or None when they differ.

    Only ever used to fill in the order's derived header percentages — the
    rate that actually applies to a line is the line's own. None here is an
    ordinary mixed-rate invoice, not an error.
    """
    rates = {item.gst_perc for item in line_items}
    return rates.pop() if len(rates) == 1 else None


async def _reject_if_already_recorded(vendor_id: int, invoice_no: str) -> None:
    # Voided invoices are deliberately not counted: voiding one is how an
    # admin corrects a bad upload, and it has to leave the invoice
    # re-uploadable.
    existing = await PrintingPurchaseInvoiceDetails.find_one(
        PrintingPurchaseInvoiceDetails.vendor_id == vendor_id,
        PrintingPurchaseInvoiceDetails.vendor_invoice_no == invoice_no,
        PrintingPurchaseInvoiceDetails.is_deleted == False,  # noqa: E712 — Beanie needs the comparison
    )
    if existing is not None:
        raise DuplicateInvoiceError(
            f"invoice {invoice_no} from this vendor has already been recorded as "
            f"printing purchase invoice {existing.printing_purchase_invoice_no}"
        )

    # Second guard, on the order side: uploaded invoices take their own
    # number as the purchase order number, and those are unique within
    # #printing_purchase_orders.
    existing_order = await PrintingPurchaseOrders.find_one(PrintingPurchaseOrders.purchase_order_no == invoice_no)
    if existing_order is not None:
        raise DuplicateInvoiceError(f"a printing purchase order numbered {invoice_no} already exists")


def _line_items(extracted: ExtractedInvoice) -> tuple[PrintingLineItem, ...]:
    return tuple(
        PrintingLineItem(
            description=item.description,
            hsn_code=item.hsn_code,
            quantity=item.quantity,
            rate=item.rate,
            gst_perc=item.gst_perc,
        )
        for item in extracted.line_items
    )


async def read_uploaded_printing_invoice(pdf_bytes: bytes) -> PrintingPurchaseInvoiceIntake:
    """Reads an uploaded printing invoice PDF and resolves its vendor.

    Raises InvoiceExtractionError if the PDF can't be read in full, or an
    InvoiceIntakeError subclass if it can be read but can't be accepted.
    """
    personal = await get_personal_details()
    extracted = await extract_invoice(pdf_bytes, personal.get("gstin", ""))

    vendor = await match_vendor(extracted)
    if not vendor.gst:
        # Same rule the printing purchase order endpoints enforce (see
        # _get_printing_vendor_or_error in routes/printing_orders.py) — reachable
        # here only via match_vendor's registered-name fallback.
        raise VendorNotFoundError(
            f"vendor {vendor.registered_name} has no GST number on file — add one before uploading their invoices"
        )
    _require_printing_vendor(vendor)

    await _reject_if_already_recorded(vendor.id, extracted.invoice_no)

    line_items = _line_items(extracted)

    # An intra-state purchase is taxed as CGST + SGST and an inter-state one
    # as IGST alone — decided from the two parties' states rather than from
    # whichever columns the invoice happened to print, so it agrees with how
    # the rest of the app splits tax (services/gst.py).
    tax_kind = tax_kind_for(
        resolve_state_code(vendor.state_code, vendor.gst),
        resolve_state_code(personal.get("state_code"), personal.get("gstin")),
    )
    intra_state = tax_kind == TaxKind.cgst_sgst

    # Per line, because the lines needn't share a rate. This is the same sum
    # _compute_totals in routes/printing_orders.py does on the values the
    # admin finally submits, so the review screen's totals and the saved
    # order's agree by construction.
    total_before_tax = sum(item.quantity * item.rate for item in line_items)
    total_after_tax = sum(item.quantity * item.rate * (1 + item.gst_perc / 100) for item in line_items)

    gst_perc = _single_gst_perc(line_items)
    half = gst_perc / 2 if gst_perc is not None else None

    return PrintingPurchaseInvoiceIntake(
        vendor_id=vendor.id,
        vendor_name=vendor.registered_name,
        vendor_gstin=vendor.gst,
        invoice_no=extracted.invoice_no,
        invoice_date=extracted.invoice_date,
        line_items=line_items,
        tax_kind=tax_kind,
        sgst_perc=half if intra_state else None,
        cgst_perc=half if intra_state else None,
        igst_perc=None if intra_state else gst_perc,
        total_amount_before_tax=total_before_tax,
        total_amount_after_tax=total_after_tax,
        printed_total=extracted.printed_total,
        total_mismatch=(
            extracted.printed_total is not None
            and abs(extracted.printed_total - total_after_tax) > _TOTAL_TOLERANCE
        ),
        source=extracted.source,
    )


__all__ = [
    "DuplicateInvoiceError",
    "InvoiceExtractionError",
    "InvoiceIntakeError",
    "PrintingLineItem",
    "PrintingPurchaseInvoiceIntake",
    "VendorNotFoundError",
    "WrongVendorTypeError",
    "read_uploaded_printing_invoice",
]
