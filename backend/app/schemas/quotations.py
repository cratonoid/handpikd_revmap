# Request/response bodies for the quotations module's endpoints.
from datetime import date

from pydantic import BaseModel, model_validator

from app.models.quotation_details import QuotationStatus


class _QuotationPayloadBase(BaseModel):
    """Fields shared by the create and update request bodies.

    Extracted into a base class (rather than duplicated, as when the create
    body only had the one array-length rule) now that three cross-field rules
    have to hold on both: the buyer either/or, the per-line either/or, and
    the parallel arrays all being the same length.
    """

    # Exactly one of these identifies the buyer — an existing
    # #customer_details row, or a one-off typed straight into this quotation
    # and stored only on it. See QuotationDetails.cust_id.
    cust_id: int | None = None
    customer_name: str = ""
    customer_address: str = ""
    date: date
    valid_till: date
    # Parallel arrays, one entry per line item — same convention as
    # CreateNewSalesOrderRequest's product_ids/quantities/rates/tax_percs.
    # A line is either a catalogue product (product_id set, product_name "")
    # or a one-off (product_id None, product_name set, image_path optional).
    product_ids: list[int | None]
    product_names: list[str] = []
    image_paths: list[str | None] = []
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    description: str = ""

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "_QuotationPayloadBase":
        if (self.cust_id is None) == (not self.customer_name.strip()):
            raise ValueError("provide either cust_id or customer_name, not both")

        line_item_count = len(self.product_ids)
        if line_item_count == 0:
            raise ValueError("at least one line item is required")

        # product_names/image_paths are the only two arrays with a default:
        # a body that omits them entirely is a catalogue-only quotation, so
        # they're padded out rather than rejected for being the wrong length.
        if not self.product_names:
            self.product_names = [""] * line_item_count
        if not self.image_paths:
            self.image_paths = [None] * line_item_count

        lengths = {
            line_item_count,
            len(self.product_names),
            len(self.image_paths),
            len(self.quantities),
            len(self.rates),
            len(self.tax_percs),
        }
        if len(lengths) != 1:
            raise ValueError(
                "product_ids, product_names, image_paths, quantities, rates, and tax_percs "
                "must have the same number of entries"
            )

        for index, (product_id, product_name) in enumerate(zip(self.product_ids, self.product_names)):
            if (product_id is None) == (not product_name.strip()):
                raise ValueError(
                    f"line item {index + 1} must have either a product_id or a product_name, not both"
                )

        return self


class CreateNewQuotationRequest(_QuotationPayloadBase):
    pass


class CreateNewQuotationResponse(BaseModel):
    message: str
    id: int
    quotation_no: int


class QuotationDetailItem(BaseModel):
    id: int
    quotation_no: int
    date: date
    valid_till: date
    cust_id: int | None
    customer_name: str
    customer_address: str
    status: QuotationStatus
    product_ids: list[int | None]
    product_names: list[str]
    image_paths: list[str | None]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    description: str
    is_deleted: bool


class UpdateQuotationDetailsRequest(_QuotationPayloadBase):
    id: int
    # status and is_deleted are only ever submitted on update — a new
    # quotation is always created as "draft" and not deleted, same
    # convention as UpdateSalesOrderDetailsRequest's order_status_id.
    status: QuotationStatus
    is_deleted: bool = False


class UpdateQuotationDetailsResponse(BaseModel):
    message: str
