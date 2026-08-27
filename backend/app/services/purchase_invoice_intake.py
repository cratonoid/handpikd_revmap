# Turns an uploaded vendor invoice PDF into the values a purchase order form
# needs, or refuses it outright.
#
# services/invoice_extraction.py reads the document; this module is the half
# that knows about our own records: it resolves the invoice's vendor and
# products to real ids, and enforces every check that can reject an upload.
# These are hard failures rather than warnings, because a purchase order
# created from a misread invoice moves stock (see apply_purchase_order_stock
# in services/inventory.py) and lands in the accounts totals — an admin
# correcting it after the fact is far more work than re-entering it by hand:
#   - the vendor on the invoice isn't one of ours (matched on GSTIN)
#   - this invoice has already been recorded
#   - any required value couldn't be read off the PDF at all
#
# Three things are deliberately not failures:
#   - An invoice that taxes its lines at different rates. Each line carries
#     its own GST % all the way onto its #purchase_summary row, so a bill
#     with paper board at 5% next to toiletries at 18% records exactly as
#     printed. Only the HEADS (CGST + SGST vs IGST) are decided per order,
#     from the two parties' states.
#   - A total that doesn't tie out is reported alongside the parsed values
#     (total_mismatch) for the admin to judge on the review screen, since
#     vendors legitimately add freight, labour and round-off lines that no
#     line item accounts for.
#   - A line whose description doesn't resolve to exactly one of the vendor's
#     products comes back unresolved (product_id None, carrying the reason)
#     instead of refusing the whole upload. Refusing was a dead end: the
#     admin had to abandon the upload, go and add the product, then start
#     over — and the commonest cause isn't a missing product at all but a
#     wording difference (a vendor's "BALL PEN" against our "Ball Pen1"),
#     where the right answer is to point the line at a product that already
#     exists. The review screen settles each one, either against an existing
#     product or by creating it there, and nothing is written until the admin
#     saves the order.
import re
from dataclasses import dataclass
from datetime import datetime

from app.models import ProductDetails, PurchaseInvoiceDetails, PurchaseOrders, VendorDetails
from app.models.vendor_details import VendorType
from app.services.gst import TaxKind, resolve_state_code, tax_kind_for
from app.services.invoice_extraction import ExtractedInvoice, InvoiceExtractionError, extract_invoice
from app.services.personal_details import get_personal_details

# How far the line items' computed total may drift from the invoice's own
# printed total before the admin is told about it. A rupee absorbs the
# round-off line most invoices carry.
_TOTAL_TOLERANCE = 1.0


class InvoiceIntakeError(RuntimeError):
    """Base for every reason an uploaded invoice is refused.

    Messages are written for the admin who uploaded the PDF and are surfaced
    verbatim by the route.
    """


class VendorNotFoundError(InvoiceIntakeError):
    pass


class DuplicateInvoiceError(InvoiceIntakeError):
    pass


class WrongVendorTypeError(InvoiceIntakeError):
    """The invoice is a printing vendor's, so it belongs on the printing side."""


@dataclass(frozen=True)
class MatchedLineItem:
    # Both None when the description didn't resolve to exactly one of this
    # vendor's products — see unresolved_reason. Such a line still carries
    # everything the invoice printed for it, so it's a question for the
    # review screen rather than a hole in the order.
    product_id: int | None
    # Our product's own name, and the description as printed on the invoice —
    # the review screen shows both so the admin can see what was matched to
    # what.
    product_name: str | None
    description: str
    # Read off the invoice, not out of our records: it pre-fills the HSN code
    # of a product created from this line.
    hsn_code: str
    quantity: int
    rate: float
    gst_perc: float
    # Written for the admin, and set only when product_id is None.
    unresolved_reason: str | None = None


@dataclass(frozen=True)
class PurchaseInvoiceIntake:
    vendor_id: int
    vendor_name: str
    vendor_gstin: str
    invoice_no: str
    invoice_date: datetime
    line_items: tuple[MatchedLineItem, ...]
    # Which heads this purchase falls under. Decided from the two parties'
    # states, so it holds whether or not the lines share a rate.
    tax_kind: TaxKind
    # The single rate every line is taxed at, filed under the heads above —
    # all three None on an invoice whose lines are taxed at different rates,
    # where no one percentage is true of the order. The rate that applies to
    # a line is always the line's own gst_perc.
    sgst_perc: float | None
    cgst_perc: float | None
    igst_perc: float | None
    total_amount_before_tax: float
    total_amount_after_tax: float
    printed_total: float | None
    total_mismatch: bool
    source: str


def _normalize(text: str) -> str:
    # Collapses everything that varies between how a vendor prints a product
    # and how we store it — case, punctuation, runs of spaces — so
    # "FOGG ( COMBO SET )" and "Fogg Combo Set" compare equal.
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


async def match_vendor(extracted: ExtractedInvoice) -> VendorDetails:
    """Resolves an extracted invoice to one of our vendors, or raises.

    Public because services/printing_purchase_invoice_intake.py resolves
    its vendor exactly the same way — on GSTIN, falling back to the
    registered name — and two copies of that rule would drift.
    """
    # GSTIN is the match key: it's the one identifier that is exact on both
    # sides, where a vendor's printed name routinely differs from their
    # registered name in our records. The name is only a fallback for
    # vendors whose GSTIN we haven't recorded yet.
    gstin = extracted.vendor_gstin.strip().upper()
    vendors = await VendorDetails.find(VendorDetails.is_deleted == False).to_list()

    for vendor in vendors:
        if vendor.gst.strip().upper() == gstin:
            return vendor

    if extracted.vendor_name:
        normalized_name = _normalize(extracted.vendor_name)
        by_name = [vendor for vendor in vendors if _normalize(vendor.registered_name) == normalized_name]
        if len(by_name) == 1:
            return by_name[0]

    printed_name = f" ({extracted.vendor_name})" if extracted.vendor_name else ""
    raise VendorNotFoundError(
        f"no vendor with GSTIN {gstin}{printed_name} — add the vendor first, then upload this invoice"
    )


def _match_product(
    description: str, products: list[ProductDetails]
) -> tuple[ProductDetails | None, str | None]:
    """Resolves one invoice line to a product, or says why it couldn't.

    Returns (product, None) on a confident match and (None, reason) otherwise.
    Ambiguity is still never guessed at — choosing between two products is a
    guess about whose stock moves — but it's the review screen that settles
    it now, rather than the upload being refused.
    """
    normalized_description = _normalize(description)

    exact = [product for product in products if _normalize(product.product_name) == normalized_description]
    if len(exact) == 1:
        return exact[0], None

    # Vendors pad a line's description with sizes, finishes and pack counts
    # ("3 mm Frigde Magnet 100 pcs with UV print"), and just as often print
    # LESS than we store ("Ab80 Gym Shaker Bottle" against our "Ab80 Gym
    # Shaker Bottle (green)"), so a name and a description that contain one
    # another either way round count as a candidate.
    #
    # Both directions are needed, and the pair of them has to be searched
    # together rather than one after the other. Looking only for our name
    # inside the description made "Ab80 Gym Shaker Bottle" resolve, silently
    # and with no warning, to a vendor's other product plainly named
    # "bottle": that one WAS contained, the product actually meant was not,
    # so exactly one candidate came back and it was the wrong one — and a
    # purchase order moves that product's stock. With both directions in
    # scope the two are seen as the competing candidates they are, and the
    # line goes to the review screen naming both.
    padded_description = f" {normalized_description} "
    contained = [
        product
        for product in products
        if padded_description.find(f" {_normalize(product.product_name)} ") != -1
        or f" {_normalize(product.product_name)} ".find(padded_description) != -1
    ]
    if len(contained) == 1:
        return contained[0], None

    if len(contained) > 1 or len(exact) > 1:
        names = ", ".join(sorted(product.product_name for product in (contained or exact)))
        return None, f"matches more than one of this vendor's products ({names}) — pick the one that was bought"

    return None, "no product in this vendor's catalogue matches this description"


async def _match_line_items(extracted: ExtractedInvoice, vendor_id: int) -> tuple[MatchedLineItem, ...]:
    products = await ProductDetails.find(
        ProductDetails.vendor_id == vendor_id, ProductDetails.is_deleted == False
    ).to_list()

    matched = []
    for item in extracted.line_items:
        product, reason = _match_product(item.description, products)
        matched.append(
            MatchedLineItem(
                product_id=product.id if product is not None else None,
                product_name=product.product_name if product is not None else None,
                description=item.description,
                hsn_code=item.hsn_code,
                quantity=item.quantity,
                rate=item.rate,
                gst_perc=item.gst_perc,
                unresolved_reason=reason,
            )
        )
    return tuple(matched)


def _single_gst_perc(line_items: tuple[MatchedLineItem, ...]) -> float | None:
    """The one rate every line is taxed at, or None when they differ.

    Only ever used to fill in PurchaseOrders' derived header percentages —
    the rate that actually applies to a line is the line's own, which is what
    the totals and the purchase invoice are built from. None here is an
    ordinary mixed-rate invoice, not an error.
    """
    rates = {item.gst_perc for item in line_items}
    return rates.pop() if len(rates) == 1 else None


async def _reject_if_already_recorded(vendor_id: int, invoice_no: str) -> None:
    # Voided purchase invoices are deliberately not counted: voiding one is
    # how an admin corrects a bad upload, and it has to leave the invoice
    # re-uploadable.
    existing = await PurchaseInvoiceDetails.find_one(
        PurchaseInvoiceDetails.vendor_id == vendor_id,
        PurchaseInvoiceDetails.vendor_invoice_no == invoice_no,
        PurchaseInvoiceDetails.is_deleted == False,
    )
    if existing is not None:
        raise DuplicateInvoiceError(
            f"invoice {invoice_no} from this vendor has already been recorded as "
            f"purchase invoice {existing.purchase_invoice_no}"
        )

    # Second guard, on the purchase order side: uploaded invoices take their
    # number as the purchase order number, and purchase order numbers are
    # unique. This also catches invoices recorded before vendor_invoice_no
    # existed on PurchaseInvoiceDetails.
    existing_order = await PurchaseOrders.find_one(PurchaseOrders.purchase_order_no == invoice_no)
    if existing_order is not None:
        raise DuplicateInvoiceError(f"a purchase order numbered {invoice_no} already exists")


async def read_uploaded_invoice(pdf_bytes: bytes) -> PurchaseInvoiceIntake:
    """Reads an uploaded invoice PDF and resolves it against our records.

    Raises InvoiceExtractionError if the PDF can't be read in full, or an
    InvoiceIntakeError subclass if it can be read but can't be accepted.
    """
    personal = await get_personal_details()
    extracted = await extract_invoice(pdf_bytes, personal.get("gstin", ""))

    vendor = await match_vendor(extracted)
    if not vendor.gst:
        # Same rule the purchase order endpoints enforce (see
        # _require_vendor_has_gst in routes/orders.py) — reachable here only
        # via the registered-name fallback above.
        raise VendorNotFoundError(
            f"vendor {vendor.registered_name} has no GST number on file — add one before uploading their invoices"
        )

    # A printing vendor's bill is a service with no product behind it, and
    # recording it here would try to resolve that service against a catalogue
    # it was never in — and then move stock for it. It has its own side of
    # the app (routes/printing_orders.py), so say so rather than letting the
    # upload fail later as an unresolvable line. A vendor with no type at all
    # is left alone: those are legacy rows that have always been recorded
    # here, and every one of them is a material vendor.
    if vendor.vendor_type == VendorType.printing:
        raise WrongVendorTypeError(
            f"{vendor.registered_name} is a printing vendor — record this invoice under "
            "Purchase orders / Printing instead"
        )

    await _reject_if_already_recorded(vendor.id, extracted.invoice_no)

    line_items = await _match_line_items(extracted, vendor.id)

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
    # _compute_totals in routes/orders.py does on the values the admin
    # finally submits, so the review screen's totals and the saved order's
    # agree by construction.
    total_before_tax = sum(item.quantity * item.rate for item in line_items)
    total_after_tax = sum(item.quantity * item.rate * (1 + item.gst_perc / 100) for item in line_items)

    # None on a mixed-rate invoice — see PurchaseInvoiceIntake.sgst_perc.
    gst_perc = _single_gst_perc(line_items)
    half = gst_perc / 2 if gst_perc is not None else None

    return PurchaseInvoiceIntake(
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
    "MatchedLineItem",
    "match_vendor",
    "PurchaseInvoiceIntake",
    "VendorNotFoundError",
    "WrongVendorTypeError",
    "read_uploaded_invoice",
]
