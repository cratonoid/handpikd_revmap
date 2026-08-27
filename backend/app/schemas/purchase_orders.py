# Request/response bodies for the orders module's endpoints.
from datetime import datetime

from pydantic import BaseModel, model_validator

from app.services.gst import TaxKind


def _check_line_item_arrays(
    product_ids: list[int], quantities: list[int], rates: list[float], gst_percs: list[float] | None
) -> None:
    lengths = {len(product_ids), len(quantities), len(rates)}
    if gst_percs is not None:
        lengths.add(len(gst_percs))
    if len(lengths) > 1:
        raise ValueError("product_ids, quantities, rates and gst_percs must have the same number of entries")
    if len(product_ids) == 0:
        raise ValueError("at least one line item is required")


def _check_gst_combo(sgst_perc: float | None, cgst_perc: float | None, igst_perc: float | None) -> None:
    # Indian GST: a purchase is taxed as EITHER sgst+cgst (intra-state) OR
    # igst alone (inter-state) — never both at once.
    if (sgst_perc or cgst_perc) and igst_perc:
        raise ValueError("use either SGST + CGST or IGST, not both")


class CreateNewPurchaseOrderRequest(BaseModel):
    purchase_order_no: str
    vendor_id: int
    date: datetime
    # Parallel arrays, one entry per line item (mirrors AddVendorDetailsRequest's
    # contact_name/contact_phone pairing). product_ids must all belong to
    # vendor_id — a purchase order is placed with a single vendor.
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    # One GST rate per line item, parallel to the arrays above — the rate that
    # actually applies to each line, and what the totals are computed from
    # (see _compute_totals in routes/orders.py). Per line because a vendor
    # invoice routinely mixes rates, e.g. paper board at 5% billed alongside
    # toiletries at 18%.
    #
    # Optional so that a caller which still sends only the header percentages
    # keeps working: they are then taken to be the rate on every line. New
    # callers should send this.
    gst_percs: list[float] | None = None
    # Which heads the rates fall under. Sent explicitly because a mixed-rate
    # order has no single header percentage to infer it from; when it's
    # omitted the endpoint falls back to reading it off the percentages
    # below, then off the two parties' states.
    tax_kind: TaxKind | None = None
    # The order's single GST rate under its heads, or all None when the lines
    # are taxed at different rates. Stored on PurchaseOrders for the screens
    # that read it, never used to compute a total.
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    description: str
    # The vendor's own invoice number, set only when this order came from an
    # uploaded vendor PDF (see parse_purchase_invoice_pdf in
    # routes/orders.py). Carried onto the purchase invoice this order raises,
    # where it's what makes a re-upload of the same document a conflict.
    vendor_invoice_no: str | None = None

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "CreateNewPurchaseOrderRequest":
        _check_line_item_arrays(self.product_ids, self.quantities, self.rates, self.gst_percs)
        return self

    @model_validator(mode="after")
    def _check_gst_combo(self) -> "CreateNewPurchaseOrderRequest":
        _check_gst_combo(self.sgst_perc, self.cgst_perc, self.igst_perc)
        return self


class CreateNewPurchaseOrderResponse(BaseModel):
    message: str
    # Every purchase order raises a purchase invoice as it's created (see
    # services/purchase_invoices.py). Its id comes back so the caller can
    # attach the vendor's PDF to it in a follow-up request — the only reason
    # this response carries an id at all.
    purchase_invoice_id: int


class PurchaseOrderDetailItem(BaseModel):
    id: int
    purchase_order_no: str
    vendor_id: int
    date: datetime
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    # One per line item, parallel to the arrays above. The edit form fills
    # its per-line GST column from these; sgst_perc/cgst_perc/igst_perc below
    # are the derived single-rate summary and are all None when these differ.
    gst_percs: list[float]
    total_amount_before_tax: float
    # Which heads the order is taxed under. The edit form needs it in its own
    # right: on a mixed-rate order the three percentages below are all None,
    # so they no longer say whether an admin deliberately overrode the heads
    # the two states call for.
    tax_kind: TaxKind | None = None
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    total_amount_after_tax: float
    description: str


class UpdatePurchaseOrderDetailsRequest(BaseModel):
    id: int
    purchase_order_no: str
    vendor_id: int
    date: datetime
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    # One GST rate per line item, parallel to the arrays above — the rate that
    # actually applies to each line, and what the totals are computed from
    # (see _compute_totals in routes/orders.py). Per line because a vendor
    # invoice routinely mixes rates, e.g. paper board at 5% billed alongside
    # toiletries at 18%.
    #
    # Optional so that a caller which still sends only the header percentages
    # keeps working: they are then taken to be the rate on every line. New
    # callers should send this.
    gst_percs: list[float] | None = None
    tax_kind: TaxKind | None = None
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    description: str

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "UpdatePurchaseOrderDetailsRequest":
        _check_line_item_arrays(self.product_ids, self.quantities, self.rates, self.gst_percs)
        return self

    @model_validator(mode="after")
    def _check_gst_combo(self) -> "UpdatePurchaseOrderDetailsRequest":
        _check_gst_combo(self.sgst_perc, self.cgst_perc, self.igst_perc)
        return self


class UpdatePurchaseOrderDetailsResponse(BaseModel):
    message: str


class PurchaseOrderListItem(BaseModel):
    # Lightweight id+PO no.+vendor name shape for the sales order form's
    # "related purchase orders" multiselect — see get_purchase_order_list in
    # routes/orders.py. PurchaseOrders has no is_deleted, so unlike
    # VendorListItem/CustomerListItem this always covers every order.
    id: int
    purchase_order_no: str
    vendor_name: str


class ParsedPurchaseInvoiceLineItem(BaseModel):
    # product_id is one of ours, resolved from description (the text printed
    # on the invoice) — see _match_product in
    # services/purchase_invoice_intake.py. Both are returned so the review
    # screen can show what was matched to what.
    #
    # Both are None when the description didn't resolve to exactly one of the
    # vendor's products, and unresolved_reason then says why in words meant
    # for the admin. That isn't an error: the review screen asks them to
    # point the line at an existing product or create one, and the order
    # can't be saved until every line has a product. hsn_code and description
    # come off the invoice either way, and pre-fill the new product's form.
    product_id: int | None = None
    product_name: str | None = None
    description: str
    hsn_code: str = ""
    quantity: int
    rate: float
    gst_perc: float
    unresolved_reason: str | None = None


class ParsePurchaseInvoicePdfResponse(BaseModel):
    # Everything read off an uploaded vendor invoice, in the shape the
    # purchase order form fills itself from. Nothing is written to the
    # database by the parse call itself — the admin reviews these values and
    # submits them through create_new_purchase_order like any other order.
    vendor_id: int
    vendor_name: str
    vendor_gstin: str
    vendor_invoice_no: str
    date: datetime
    # Parallel arrays in the shape create_new_purchase_order takes. A null in
    # product_ids marks a line the admin still has to resolve, so these can
    # only be submitted as-is once none are left — see
    # ParsedPurchaseInvoiceLineItem.
    product_ids: list[int | None]
    quantities: list[int]
    rates: list[float]
    gst_percs: list[float]
    line_items: list[ParsedPurchaseInvoiceLineItem]
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
    # a warning, not a rejection — vendors add freight, labour and round-off
    # lines that no line item accounts for.
    printed_total: float | None = None
    total_mismatch: bool = False
    # "text" if the deterministic parser read this invoice, "claude" if it
    # took the fallback — shown on the review screen so the admin knows how
    # much to trust the values.
    source: str
