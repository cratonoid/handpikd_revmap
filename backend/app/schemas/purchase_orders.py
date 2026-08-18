# Request/response bodies for the orders module's endpoints.
from datetime import datetime

from pydantic import BaseModel, model_validator


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
    # Percentages applied to the line items' subtotal — see _compute_totals
    # in routes/orders.py.
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
        if len(self.product_ids) != len(self.quantities) or len(self.product_ids) != len(self.rates):
            raise ValueError("product_ids, quantities, and rates must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
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
    total_amount_before_tax: float
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
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    description: str

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "UpdatePurchaseOrderDetailsRequest":
        if len(self.product_ids) != len(self.quantities) or len(self.product_ids) != len(self.rates):
            raise ValueError("product_ids, quantities, and rates must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
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
    product_id: int
    product_name: str
    description: str
    quantity: int
    rate: float
    gst_perc: float


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
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    line_items: list[ParsedPurchaseInvoiceLineItem]
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
