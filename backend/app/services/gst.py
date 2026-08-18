# Indian GST helpers: deciding IGST vs CGST+SGST and resolving a party's
# state code/name for the "Place of Supply" line.
#
# The state a party belongs to is stored explicitly on the party itself
# (CustomerDetails.state_code / VendorDetails.state_code, and the
# "state_code" attribute of the personal_details profile for our own
# company). It's auto-filled from the first two digits of their GSTIN when
# they have one — see resolve_state_code — but stays a field in its own
# right, because a party without a GSTIN still sits in a state and a
# same-state supply to an unregistered party is CGST+SGST, not IGST.
#
# Used by routes/invoices.py and services/purchase_invoices.py to freeze a
# document's tax split at the moment it's raised, and by
# services/invoice_pdf.py to render it, so the three never disagree.
from dataclasses import dataclass
from enum import Enum

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


class TaxKind(str, Enum):
    """Which GST heads a document is taxed under.

    Stored on InvoiceDetails/PurchaseInvoiceDetails so a document keeps the
    split it was raised with even if a party's state is corrected later.
    """

    igst = "igst"  # Inter-state: IGST alone.
    cgst_sgst = "cgst_sgst"  # Intra-state: CGST + SGST, half the rate each.


def normalise_state_code(value: str | None) -> str | None:
    """Returns a real two-digit GST state code, or None.

    Tolerates the shapes a form or an imported record can produce — "8",
    " 08 ", or a full GSTIN pasted into the state field — and rejects
    anything that isn't an assigned code, so a typo never silently decides a
    document's tax heads.
    """
    if not value:
        return None

    code = str(value).strip()
    if not code:
        return None
    if code.isdigit() and len(code) == 1:
        code = f"0{code}"
    code = code[:2]
    return code if code in GST_STATE_CODES else None


def state_code_from_gstin(gstin: str | None) -> str | None:
    if not gstin:
        return None
    return normalise_state_code(gstin.strip()[:2])


def state_name_for_code(state_code: str | None) -> str | None:
    code = normalise_state_code(state_code)
    return GST_STATE_CODES.get(code) if code else None


def resolve_state_code(state_code: str | None, gstin: str | None = None) -> str | None:
    """The state a party belongs to: their stored state, else their GSTIN's.

    The stored value wins so an admin can correct a party whose GSTIN is
    wrong or missing; the GSTIN is the fallback that keeps every record
    created before the state field existed working unchanged.
    """
    return normalise_state_code(state_code) or state_code_from_gstin(gstin)


def resolve_party_state(state_code: str | None, gstin: str | None) -> tuple[str, str]:
    """The (code, name) pair to store on a client or vendor record.

    An explicitly chosen state wins; a blank one falls back to the GSTIN, so
    the common case on the add/edit forms is "paste the GSTIN and the state
    fills itself in". The name is always re-derived from the code so the two
    can never drift — only the code is ever read by the tax split.

    Raises ValueError if a state was supplied but isn't an assigned GST
    state code; the routes turn that into a 400.
    """
    if state_code and state_code.strip():
        # Validated before the GSTIN fallback is even considered: falling
        # back would quietly accept a typo and store a state the admin
        # never chose.
        resolved = normalise_state_code(state_code)
        if resolved is None:
            raise ValueError(f"unknown GST state code: {state_code}")
    else:
        resolved = state_code_from_gstin(gstin)

    return resolved or "", state_name_for_code(resolved) or ""


def is_intra_state(buyer_state_code: str | None, seller_state_code: str | None) -> bool:
    """True when both parties sit in the same state (-> CGST + SGST).

    A party whose state can't be established at all is treated as
    inter-state (IGST), the safer default: it's the rate the recipient can
    always claim, and it's what every record created before state codes
    existed already rendered.
    """
    buyer = normalise_state_code(buyer_state_code)
    seller = normalise_state_code(seller_state_code)
    return buyer is not None and buyer == seller


def tax_kind_for(buyer_state_code: str | None, seller_state_code: str | None) -> TaxKind:
    return TaxKind.cgst_sgst if is_intra_state(buyer_state_code, seller_state_code) else TaxKind.igst


@dataclass
class TaxSplit:
    kind: TaxKind
    igst_perc: float = 0.0
    igst_amount: float = 0.0
    cgst_perc: float = 0.0
    cgst_amount: float = 0.0
    sgst_perc: float = 0.0
    sgst_amount: float = 0.0


def split_tax(tax_perc: float, tax_amount: float, kind: TaxKind) -> TaxSplit:
    """Splits one line's (or one document's) tax into the heads `kind` names."""
    if kind == TaxKind.cgst_sgst:
        return TaxSplit(
            kind=TaxKind.cgst_sgst,
            cgst_perc=tax_perc / 2,
            cgst_amount=tax_amount / 2,
            sgst_perc=tax_perc / 2,
            sgst_amount=tax_amount / 2,
        )

    return TaxSplit(kind=TaxKind.igst, igst_perc=tax_perc, igst_amount=tax_amount)


def place_of_supply_text(state_code: str | None) -> str:
    """The invoice's "Place of Supply" line, e.g. "Rajasthan ( 08 )"."""
    code = normalise_state_code(state_code)
    name = state_name_for_code(code)
    return f"{name} ( {code} )" if name else "-"


__all__ = [
    "GST_STATE_CODES",
    "TaxKind",
    "TaxSplit",
    "is_intra_state",
    "normalise_state_code",
    "place_of_supply_text",
    "resolve_party_state",
    "resolve_state_code",
    "split_tax",
    "state_code_from_gstin",
    "state_name_for_code",
    "tax_kind_for",
]
