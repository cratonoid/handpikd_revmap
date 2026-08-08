# Indian GST helpers for invoice rendering: deciding IGST vs CGST+SGST and
# resolving a GSTIN's state code/name for the "Place of Supply" line. Used by
# both routes/invoices.py's get_invoice_details and services/invoice_pdf.py
# so the two never disagree on how a line item's tax is split.
from dataclasses import dataclass

# Official GST state/UT codes (the first two digits of every GSTIN).
GST_STATE_CODES: dict[str, str] = {
    "01": "Jammu and Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu",
    "27": "Maharashtra",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman and Nicobar Islands",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh",
}


def state_code_from_gstin(gstin: str | None) -> str | None:
    if not gstin or len(gstin) < 2:
        return None
    return gstin[:2]


def state_name_from_gstin(gstin: str | None) -> str | None:
    code = state_code_from_gstin(gstin)
    return GST_STATE_CODES.get(code) if code else None


@dataclass
class TaxSplit:
    kind: str  # "igst" or "cgst_sgst"
    igst_perc: float = 0.0
    igst_amount: float = 0.0
    cgst_perc: float = 0.0
    cgst_amount: float = 0.0
    sgst_perc: float = 0.0
    sgst_amount: float = 0.0


def is_intra_state(buyer_gstin: str | None, seller_gstin: str | None) -> bool:
    # Same state (both GSTINs share a state code) -> intra-state (CGST+SGST).
    # Different state, or the buyer has no GSTIN on file (place of supply
    # can't be confirmed as intra-state) -> inter-state (IGST), matching how
    # the sample invoice treats an inter-state sale.
    buyer_state = state_code_from_gstin(buyer_gstin)
    seller_state = state_code_from_gstin(seller_gstin)
    return buyer_state is not None and buyer_state == seller_state


def split_tax(tax_perc: float, tax_amount: float, buyer_gstin: str | None, seller_gstin: str | None) -> TaxSplit:
    if is_intra_state(buyer_gstin, seller_gstin):
        return TaxSplit(
            kind="cgst_sgst",
            cgst_perc=tax_perc / 2,
            cgst_amount=tax_amount / 2,
            sgst_perc=tax_perc / 2,
            sgst_amount=tax_amount / 2,
        )

    return TaxSplit(kind="igst", igst_perc=tax_perc, igst_amount=tax_amount)
