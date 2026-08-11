# Request/response bodies for the purchase invoices module's endpoints.
from datetime import datetime

from pydantic import BaseModel, model_validator

from app.models.purchase_invoice_details import PurchaseInvoiceSource
from app.services.purchase_invoice_parser import ParsedPurchaseInvoice


class PurchaseInvoiceLineItemInput(BaseModel):
    description: str
    hsn_code: str = ""
    quantity: float
    rate: float
    tax_perc: float = 0


class CreateNewPurchaseInvoiceRequest(BaseModel):
    date: datetime
    vendor_id: int
    source: PurchaseInvoiceSource
    # Required when source == po_dropdown; optional association when
    # source == pdf_upload (admin can still tie an uploaded vendor PDF back
    # to a known PO for reference).
    po_id: int | None = None
    # Required when source == pdf_upload — the key returned by
    # POST /admin/parse_purchase_invoice_pdf.
    uploaded_pdf_path: str | None = None
    # Only used when source == pdf_upload — po_dropdown line items are
    # always derived live from the linked PurchaseOrders/PurchaseSummary
    # instead (see routes/purchase_invoices.py).
    line_items: list[PurchaseInvoiceLineItemInput] = []

    @model_validator(mode="after")
    def _check_source_requirements(self) -> "CreateNewPurchaseInvoiceRequest":
        if self.source == PurchaseInvoiceSource.po_dropdown:
            if self.po_id is None:
                raise ValueError("po_id is required when source is po_dropdown")
        else:
            if self.uploaded_pdf_path is None:
                raise ValueError("uploaded_pdf_path is required when source is pdf_upload")
            if not self.line_items:
                raise ValueError("at least one line item is required when source is pdf_upload")
        return self


class CreateNewPurchaseInvoiceResponse(BaseModel):
    message: str


class PurchaseInvoiceDetailItem(BaseModel):
    id: int
    purchase_invoice_no: int
    purchase_invoice_no_display: str
    date: datetime
    vendor_id: int
    po_id: int | None
    source: PurchaseInvoiceSource
    has_uploaded_pdf: bool
    # Only populated for source == pdf_upload (folded in from
    # PurchaseInvoiceSummary), same convention as get_quotation_details/
    # get_purchase_order_details folding their own line-item tables back
    # in — empty for source == po_dropdown, whose line items live on the
    # linked PurchaseOrders instead.
    line_items: list[PurchaseInvoiceLineItemInput]
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    is_deleted: bool


class UpdatePurchaseInvoiceDetailsRequest(BaseModel):
    id: int
    # source/po_id/uploaded_pdf_path are intentionally not editable — a
    # purchase invoice always stays tied to whatever it was raised against.
    date: datetime
    vendor_id: int
    # Only applied when source == pdf_upload; ignored for po_dropdown, whose
    # line items keep coming from the linked PurchaseOrders instead.
    line_items: list[PurchaseInvoiceLineItemInput] = []
    is_deleted: bool = False


class UpdatePurchaseInvoiceDetailsResponse(BaseModel):
    message: str


class ParsePurchaseInvoicePdfResponse(BaseModel):
    uploaded_pdf_path: str
    parsed: ParsedPurchaseInvoice
