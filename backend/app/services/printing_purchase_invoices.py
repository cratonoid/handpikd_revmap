# Raises the printing purchase invoice that every printing purchase order
# gets.
#
# The printing counterpart of services/purchase_invoices.py, and it keeps
# that module's rule: a printing purchase invoice is never created on its
# own, only as part of creating the printing purchase order it belongs to
# (see create_new_printing_purchase_order in routes/printing_orders.py).
# Amounts are snapshotted from the order rather than recomputed, so the
# invoice always states what the order said at the moment it was raised.
from app.models import (
    PrintingPurchaseInvoiceDetails,
    PrintingPurchaseInvoiceIdCounter,
    PrintingPurchaseInvoiceNoCounterMaster,
    PrintingPurchaseOrders,
    VendorDetails,
)
from app.services.counters import get_next_id
from app.services.gst import resolve_state_code, split_tax, state_name_for_code


async def create_printing_purchase_invoice_for_order(
    purchase_order: PrintingPurchaseOrders, vendor_invoice_no: str | None = None
) -> PrintingPurchaseInvoiceDetails:
    """Raises a printing purchase invoice against a just-created printing order.

    vendor_invoice_no is the number printed on the vendor's own PDF, set only
    for orders created by uploading one — it's what makes a re-upload of the
    same invoice a conflict (see
    services/printing_purchase_invoice_intake.py).
    """
    total_tax = purchase_order.total_amount_after_tax - purchase_order.total_amount_before_tax
    split = split_tax(0.0, total_tax, purchase_order.tax_kind)

    # The vendor's state supplies the place-of-supply line. The HEADS are
    # taken from the order itself rather than re-derived from the two states,
    # for the reason _tax_context_for_order gives on the material side: the
    # order form already made that call, with the admin free to override it,
    # and an invoice that contradicted its own order would be worse than one
    # that follows a deliberate override. Unlike PurchaseOrders, tax_kind is
    # never None here, so there is no fallback path to write.
    vendor = await VendorDetails.get(purchase_order.vendor_id)
    vendor_state = resolve_state_code(vendor.state_code, vendor.gst) if vendor else None

    printing_purchase_invoice_no = await get_next_id(
        PrintingPurchaseInvoiceNoCounterMaster,
        "next_printing_purchase_invoice_no",
        PrintingPurchaseInvoiceDetails,
    )
    printing_purchase_invoice_id = await get_next_id(
        PrintingPurchaseInvoiceIdCounter,
        "next_printing_purchase_invoice_id",
        PrintingPurchaseInvoiceDetails,
    )

    # uploaded_pdf_path starts unset even for the upload flow: the PDF is
    # attached in a follow-up request once this row exists (see
    # attach_printing_purchase_invoice_pdf in
    # routes/printing_purchase_invoices.py), the same two-phase pattern the
    # material side and catalogues use to keep a file out of a JSON request.
    printing_purchase_invoice = PrintingPurchaseInvoiceDetails(
        id=printing_purchase_invoice_id,
        printing_purchase_invoice_no=printing_purchase_invoice_no,
        date=purchase_order.date,
        vendor_id=purchase_order.vendor_id,
        po_id=purchase_order.id,
        vendor_invoice_no=vendor_invoice_no,
        uploaded_pdf_path=None,
        total_amount_before_tax=purchase_order.total_amount_before_tax,
        total_tax_amount=total_tax,
        total_amount_after_tax=purchase_order.total_amount_after_tax,
        tax_kind=purchase_order.tax_kind,
        place_of_supply_code=vendor_state or "",
        place_of_supply_name=state_name_for_code(vendor_state) or "",
        total_igst_amount=split.igst_amount,
        total_cgst_amount=split.cgst_amount,
        total_sgst_amount=split.sgst_amount,
    )
    await printing_purchase_invoice.insert()
    return printing_purchase_invoice
