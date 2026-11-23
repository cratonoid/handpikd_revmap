# Raises the purchase invoice that every purchase order gets.
#
# A purchase invoice is no longer something an admin creates on its own: one
# is issued automatically as part of creating the purchase order it belongs
# to (see create_new_purchase_order in routes/orders.py), whether that order
# was keyed in by hand or read off an uploaded vendor PDF. That's why this
# lives here rather than in routes/purchase_invoices.py — the creating call
# site is the orders module, and what's left in the purchase invoices module
# is viewing, editing, voiding and PDFs.
#
# Amounts are copied from the purchase order rather than recomputed. They used
# to be copied once, at create time, so an invoice kept stating what its order
# said when it was raised even after the order was edited. Since the invoice
# is raised automatically and is one-to-one with its order, that only left
# the two disagreeing, so editing an order now re-copies them as well (see
# sync_purchase_invoice_with_order). The invoice's own number, date, vendor
# invoice number and attached PDF are never touched by that.
from app.models import (
    PurchaseInvoiceDetails,
    PurchaseInvoiceIdCounter,
    PurchaseInvoiceNoCounterMaster,
    PurchaseOrders,
    VendorDetails,
)
from app.services.counters import get_next_id
from app.services.gst import TaxKind, resolve_state_code, split_tax, state_name_for_code, tax_kind_for
from app.services.personal_details import get_personal_details


async def create_purchase_invoice_for_order(
    purchase_order: PurchaseOrders, vendor_invoice_no: str | None = None
) -> PurchaseInvoiceDetails:
    """Raises a purchase invoice against a just-created purchase order.

    vendor_invoice_no is the number printed on the vendor's own PDF, set only
    for orders created by uploading one — it's what makes a re-upload of the
    same invoice a conflict (see services/purchase_invoice_intake.py).
    """
    purchase_invoice_no = await get_next_id(
        PurchaseInvoiceNoCounterMaster, "next_purchase_invoice_no", PurchaseInvoiceDetails
    )
    purchase_invoice_id = await get_next_id(
        PurchaseInvoiceIdCounter, "next_purchase_invoice_id", PurchaseInvoiceDetails
    )

    # uploaded_pdf_path starts unset even for the upload flow: the PDF is
    # attached in a follow-up request once this row exists (see
    # attach_purchase_invoice_pdf in routes/purchase_invoices.py), the same
    # two-phase pattern catalogues and products use to keep a file out of a
    # JSON create request.
    purchase_invoice = PurchaseInvoiceDetails(
        id=purchase_invoice_id,
        purchase_invoice_no=purchase_invoice_no,
        date=purchase_order.date,
        po_id=purchase_order.id,
        vendor_invoice_no=vendor_invoice_no,
        uploaded_pdf_path=None,
        **await order_figures_for_invoice(purchase_order),
    )
    await purchase_invoice.insert()
    return purchase_invoice


async def order_figures_for_invoice(purchase_order: PurchaseOrders) -> dict:
    """The fields a purchase invoice copies from its order: vendor, totals and GST heads."""
    total_tax = purchase_order.total_amount_after_tax - purchase_order.total_amount_before_tax
    tax_kind, place_of_supply_code, place_of_supply_name = await _tax_context_for_order(purchase_order)
    split = split_tax(0.0, total_tax, tax_kind)
    return {
        "vendor_id": purchase_order.vendor_id,
        "total_amount_before_tax": purchase_order.total_amount_before_tax,
        "total_tax_amount": total_tax,
        "total_amount_after_tax": purchase_order.total_amount_after_tax,
        "tax_kind": tax_kind,
        "place_of_supply_code": place_of_supply_code,
        "place_of_supply_name": place_of_supply_name,
        "total_igst_amount": split.igst_amount,
        "total_cgst_amount": split.cgst_amount,
        "total_sgst_amount": split.sgst_amount,
    }


async def sync_purchase_invoice_with_order(purchase_order: PurchaseOrders) -> None:
    """Re-copies an edited order's figures onto its live purchase invoice(s)."""
    figures = await order_figures_for_invoice(purchase_order)
    invoices = await PurchaseInvoiceDetails.find(
        PurchaseInvoiceDetails.po_id == purchase_order.id,
        PurchaseInvoiceDetails.is_deleted == False,  # noqa: E712 — Beanie needs the comparison
    ).to_list()
    for invoice in invoices:
        for field, value in figures.items():
            setattr(invoice, field, value)
        await invoice.save()


async def _tax_context_for_order(purchase_order: PurchaseOrders) -> tuple[TaxKind, str, str]:
    """The GST heads and place of supply to snapshot onto the invoice.

    The heads come from the order itself, not from a fresh comparison of the
    two states: the order form already made that call (defaulting from the
    states, with the admin free to override), and an invoice that
    contradicted the order it was raised against would be worse than one that
    follows a deliberate override. A vendor's state still supplies the
    place-of-supply line, and is the fallback when the order says nothing.

    tax_kind is the order's own answer and is read first. The percentages
    below are the older, implicit way of saying the same thing — still the
    only answer on orders raised before tax_kind existed, and now also None
    on any order whose lines are taxed at different rates, which is exactly
    why the heads can no longer be inferred from them alone.
    """
    vendor = await VendorDetails.get(purchase_order.vendor_id)
    vendor_state = resolve_state_code(vendor.state_code, vendor.gst) if vendor else None

    if purchase_order.tax_kind is not None:
        tax_kind = purchase_order.tax_kind
    elif purchase_order.igst_perc:
        tax_kind = TaxKind.igst
    elif purchase_order.sgst_perc or purchase_order.cgst_perc:
        tax_kind = TaxKind.cgst_sgst
    else:
        # A zero-rated or tax-free order: no head to read off the
        # percentages, so fall back to what the states say. Every amount
        # this decides is 0 either way; it only affects which columns the
        # PDF prints.
        personal = await get_personal_details()
        tax_kind = tax_kind_for(vendor_state, resolve_state_code(personal.get("state_code"), personal.get("gstin")))

    return tax_kind, vendor_state or "", state_name_for_code(vendor_state) or ""
