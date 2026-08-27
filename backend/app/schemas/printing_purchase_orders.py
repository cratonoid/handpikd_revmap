# Request/response bodies for the printing orders module's endpoints.
#
# Shaped like schemas/purchase_orders.py on purpose — same parallel-array
# line items, same GST arrangement — with one difference that runs through
# everything: a line item is a `description` the vendor wrote, not a
# product_id of ours. Nothing here can name a product, which is what keeps a
# printing order from ever reaching the inventory code.
from datetime import datetime

from pydantic import BaseModel, model_validator

from app.services.gst import TaxKind


def _check_line_item_arrays(
    descriptions: list[str],
    hsn_codes: list[str] | None,
    quantities: list[int],
    rates: list[float],
    gst_percs: list[float],
) -> None:
    lengths = {len(descriptions), len(quantities), len(rates), len(gst_percs)}
    if hsn_codes is not None:
        lengths.add(len(hsn_codes))
    if len(lengths) > 1:
        raise ValueError(
            "descriptions, hsn_codes, quantities, rates and gst_percs must have the same number of entries"
        )
    if len(descriptions) == 0:
        raise ValueError("at least one line item is required")
    if any(not description.strip() for description in descriptions):
        # The description IS the line item here — an empty one would record a
        # charge against nothing at all, where a material order at least
        # still points at a product.
        raise ValueError("every line item needs a description")


class CreateNewPrintingPurchaseOrderRequest(BaseModel):
    purchase_order_no: str
    vendor_id: int
    date: datetime
    # Parallel arrays, one entry per line item. `descriptions` is the service
    # as the vendor billed it and is required; `hsn_codes` is the SAC/HSN
    # they printed against it and is optional, since plenty of printing bills
    # don't carry one.
    descriptions: list[str]
    hsn_codes: list[str] | None = None
    quantities: list[int]
    rates: list[float]
    # One GST rate per line item — the rate that actually applies to each
    # line, and what the totals are computed from. Per line because a
    # printing bill can mix rates just as a material one can.
    gst_percs: list[float]
    # Which heads the rates fall under. Sent explicitly because a mixed-rate
    # order has no single header percentage to infer it from; the endpoint
    # falls back to the two parties' states when it's omitted.
    tax_kind: TaxKind | None = None
    description: str
    # The vendor's own invoice number, set only when this order came from an
    # uploaded PDF. Carried onto the printing purchase invoice this order
    # raises, where it's what makes a re-upload of the same document a
    # conflict.
    vendor_invoice_no: str | None = None

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "CreateNewPrintingPurchaseOrderRequest":
        _check_line_item_arrays(self.descriptions, self.hsn_codes, self.quantities, self.rates, self.gst_percs)
        return self


class CreateNewPrintingPurchaseOrderResponse(BaseModel):
    message: str
    # Every printing purchase order raises its printing purchase invoice as
    # it's created (see services/printing_purchase_invoices.py). Its id comes
    # back so the caller can attach the vendor's PDF to it in a follow-up
    # request — the only reason this response carries an id at all.
    printing_purchase_invoice_id: int


class PrintingPurchaseOrderDetailItem(BaseModel):
    id: int
    purchase_order_no: str
    vendor_id: int
    date: datetime
    descriptions: list[str]
    hsn_codes: list[str]
    quantities: list[int]
    rates: list[float]
    # One per line item, parallel to the arrays above. The edit form fills
    # its per-line GST column from these; sgst_perc/cgst_perc/igst_perc below
    # are the derived single-rate summary and are all None when these differ.
    gst_percs: list[float]
    total_amount_before_tax: float
    tax_kind: TaxKind
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    total_amount_after_tax: float
    description: str


class UpdatePrintingPurchaseOrderDetailsRequest(BaseModel):
    id: int
    purchase_order_no: str
    vendor_id: int
    date: datetime
    descriptions: list[str]
    hsn_codes: list[str] | None = None
    quantities: list[int]
    rates: list[float]
    gst_percs: list[float]
    tax_kind: TaxKind | None = None
    description: str

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "UpdatePrintingPurchaseOrderDetailsRequest":
        _check_line_item_arrays(self.descriptions, self.hsn_codes, self.quantities, self.rates, self.gst_percs)
        return self


class UpdatePrintingPurchaseOrderDetailsResponse(BaseModel):
    message: str


class ParsedPrintingInvoiceLineItem(BaseModel):
    # Everything the invoice printed for this line, taken as printed. There
    # is no product_id and no unresolved_reason — unlike a material line,
    # this one has nothing to resolve against, which is the whole reason
    # printing has its own intake.
    description: str
    hsn_code: str = ""
    quantity: int
    rate: float
    gst_perc: float


class ParsePrintingPurchaseInvoicePdfResponse(BaseModel):
    # Everything read off an uploaded printing invoice, in the shape the
    # printing purchase order form fills itself from. Nothing is written to
    # the database by the parse call itself — the admin reviews these values
    # and submits them through create_new_printing_purchase_order.
    vendor_id: int
    vendor_name: str
    vendor_gstin: str
    vendor_invoice_no: str
    date: datetime
    line_items: list[ParsedPrintingInvoiceLineItem]
    # The heads this purchase falls under, from our state vs the vendor's.
    # Always present, unlike the percentages below, which are all None when
    # the invoice taxes its lines at different rates.
    tax_kind: TaxKind
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    total_amount_before_tax: float
    total_amount_after_tax: float
    # The invoice's own printed grand total and whether it disagrees with the
    # total derived from the line items. A mismatch is shown to the admin as
    # a warning, not a rejection.
    printed_total: float | None = None
    total_mismatch: bool = False
    # "text" if the deterministic parser read this invoice, "claude" if it
    # took the fallback — shown on the review screen so the admin knows how
    # much to trust the values.
    source: str
