# Schema for the #quotation_summary collection.
from beanie import Document


class QuotationSummary(Document):
    id: int
    quotation_id: int  # FK -> QuotationDetails.id
    # Same either/or as QuotationDetails' buyer: a line either points at a
    # catalogue product or is a one-off carrying its own typed-in name and
    # (optional) image, which live only on this line and never become a
    # #product_details row. Exactly one of product_id / product_name is set.
    # A catalogue line leaves product_name/image_path empty and joins to
    # ProductDetails/ProductImageDetails at PDF time, so a renamed or
    # re-photographed product still renders current on a re-download.
    product_id: int | None = None  # FK -> ProductDetails.id
    product_name: str = ""
    # Only ever set on a one-off line. Either a "/media/..." path, a data URI
    # (what upload_product_image hands back), or an external URL — see
    # _product_image_data_uri in services/quotation_pdf.py, which resolves
    # all three.
    image_path: str | None = None
    quantity: int
    rate: float
    tax_perc: float
    tax_amount: float
    total: float

    class Settings:
        name = "quotation_summary"
