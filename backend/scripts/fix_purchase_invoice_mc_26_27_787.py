# One-off data correction: purchase order / purchase invoice MC/26-27/787
# (MUTHA COLLECTIONS, 30-Jun-26) was recorded at a rate of 2,080.00 for its
# single line, where the vendor's own invoice prints 1,000.00.
#
# The upload parser is NOT at fault and nothing in the code needs changing:
# running app/services/invoice_extraction.py against that very PDF today
# reads qty 1 @ 1,000.00, 5% IGST, total 1,050.00 — matching the total
# printed on the document — and the same check across the other 41 stored
# invoices with a PDF on file found no other disagreement. The intake path
# stores the invoice's own rate verbatim (rate=item.rate in
# services/purchase_invoice_intake.py) and never substitutes anything, and
# 2,080.00 appears nowhere else in the database — not on the PDF, not as
# product 70's vendor_rate (1,000.00), not on any other order. It was
# entered by hand over the parsed value, and because the parse was
# self-consistent the review screen's total_mismatch warning never fired.
#
# So this corrects the DATA only, to what the vendor actually billed:
#
#   purchase_summary line   rate  2,080.00 -> 1,000.00
#   purchase_orders         before tax 2,080.00 -> 1,000.00
#                           after tax  2,184.00 -> 1,050.00
#   purchase_invoice_details before tax 2,080.00 -> 1,000.00
#                            tax / IGST   104.00 ->    50.00
#                            after tax  2,184.00 -> 1,050.00
#
# Quantity is untouched, so no stock moves: #inventory and
# #inventory_history record quantities only, never a rate. The sales side is
# unaffected too — SalesOrderCosting.net_purchase_rate is defaulted from
# ProductDetails.vendor_rate (already 1,000.00) and stored per order.
#
# The two derived figures are recomputed with the same functions production
# uses rather than typed in, so the corrected row is arithmetically identical
# to one the app would have written itself: _compute_totals from
# api/routes/orders.py for the order, and split_tax from services/gst.py for
# the invoice's GST heads, exactly as create_purchase_invoice_for_order does.
#
# Safe to re-run: it verifies the line still holds the wrong rate before
# touching anything, and reports and exits if the data has already been
# corrected (or looks different from what is described above).
#
# Run with: venv/Scripts/python.exe scripts/fix_purchase_invoice_mc_26_27_787.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.api.routes.orders import _compute_totals
from app.core.config import settings
from app.services.gst import TaxKind, split_tax

PURCHASE_ORDER_NO = "MC/26-27/787"
PRODUCT_ID = 70
WRONG_RATE = 2080.0
# As printed on Sales_MC_26-27_787.pdf.
CORRECT_RATE = 1000.0


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]

    order = await db["purchase_orders"].find_one({"purchase_order_no": PURCHASE_ORDER_NO})
    if order is None:
        print(f"no purchase order {PURCHASE_ORDER_NO} — nothing to do")
        await client.close()
        return

    invoice = await db["purchase_invoice_details"].find_one(
        {"po_id": order["_id"], "is_deleted": False}
    )
    if invoice is None:
        print(f"purchase order {PURCHASE_ORDER_NO} has no live invoice — nothing to do")
        await client.close()
        return

    lines = await db["purchase_summary"].find({"purchase_order_id": order["_id"]}).to_list(None)
    target = [line for line in lines if line["product_id"] == PRODUCT_ID]
    if len(target) != 1:
        print(f"expected exactly one line for product {PRODUCT_ID}, found {len(target)} — leaving alone")
        await client.close()
        return

    line = target[0]
    if line["rate"] != WRONG_RATE:
        print(f"line already reads {line['rate']}, not {WRONG_RATE} — already corrected, nothing to do")
        await client.close()
        return

    print("BEFORE")
    print(f"  line       qty={line['quantity']} rate={line['rate']} gst%={line['gst_perc']}")
    print(f"  order      before {order['total_amount_before_tax']:.2f} after {order['total_amount_after_tax']:.2f}")
    print(
        f"  invoice    before {invoice['total_amount_before_tax']:.2f}"
        f" tax {invoice['total_tax_amount']:.2f}"
        f" after {invoice['total_amount_after_tax']:.2f}"
        f" igst {invoice.get('total_igst_amount', 0.0):.2f}"
    )

    # 1. The line the vendor actually billed.
    await db["purchase_summary"].update_one({"_id": line["_id"]}, {"$set": {"rate": CORRECT_RATE}})
    line["rate"] = CORRECT_RATE

    # 2. The order, re-totalled from EVERY line (not just the corrected one),
    #    taxed line by line at each line's own rate — production's arithmetic.
    before_tax, after_tax = _compute_totals(
        [row["quantity"] for row in lines],
        [row["rate"] for row in lines],
        [row["gst_perc"] for row in lines],
    )
    await db["purchase_orders"].update_one(
        {"_id": order["_id"]},
        {"$set": {"total_amount_before_tax": before_tax, "total_amount_after_tax": after_tax}},
    )

    # 3. The invoice's snapshot of that order, split across the heads the
    #    invoice was raised under — never re-decided from the two states.
    total_tax = after_tax - before_tax
    tax_kind = TaxKind(invoice["tax_kind"]) if invoice.get("tax_kind") else None
    split = split_tax(0.0, total_tax, tax_kind) if tax_kind is not None else None
    updates = {
        "total_amount_before_tax": before_tax,
        "total_tax_amount": total_tax,
        "total_amount_after_tax": after_tax,
    }
    if split is not None:
        updates["total_igst_amount"] = split.igst_amount
        updates["total_cgst_amount"] = split.cgst_amount
        updates["total_sgst_amount"] = split.sgst_amount
    await db["purchase_invoice_details"].update_one({"_id": invoice["_id"]}, {"$set": updates})

    order = await db["purchase_orders"].find_one({"_id": order["_id"]})
    invoice = await db["purchase_invoice_details"].find_one({"_id": invoice["_id"]})
    print("AFTER")
    print(f"  line       qty={line['quantity']} rate={line['rate']} gst%={line['gst_perc']}")
    print(f"  order      before {order['total_amount_before_tax']:.2f} after {order['total_amount_after_tax']:.2f}")
    print(
        f"  invoice    before {invoice['total_amount_before_tax']:.2f}"
        f" tax {invoice['total_tax_amount']:.2f}"
        f" after {invoice['total_amount_after_tax']:.2f}"
        f" igst {invoice.get('total_igst_amount', 0.0):.2f}"
        f" cgst {invoice.get('total_cgst_amount', 0.0):.2f}"
        f" sgst {invoice.get('total_sgst_amount', 0.0):.2f}"
    )

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
