# Renders an InvoiceDetails row (plus its joined sales order/line items/
# customer/seller data) into a PDF matching the structure of Handpikd's
# existing invoice template: letterhead, customer detail box, GST line-item
# table, totals, amount in words, bank details, terms & conditions. Pure
# rendering only — routes/invoices.py does all the DB lookups and joins
# (SalesOrders, SalesSummary, ProductDetails, CustomerDetails,
# CustomerPocDetails, personal_details) and passes plain data in.
from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime

import qrcode
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.gst import is_intra_state, split_tax, state_name_from_gstin
from app.services.number_to_words import rupees_to_words

_GRID = colors.HexColor("#7f9db9")
_HEADER_BG = colors.HexColor("#dbe7f2")


@dataclass
class InvoiceLineItem:
    product_name: str
    hsn_code: str
    quantity: int
    rate: float
    taxable_value: float
    tax_perc: float
    tax_amount: float
    total: float


def _money(value: float) -> str:
    return f"Rs.{value:,.2f}"


def generate_invoice_pdf(
    *,
    invoice_no: int,
    invoice_type: str,
    invoice_date: datetime,
    due_date: datetime,
    transport: str,
    order_no: int,
    line_items: list[InvoiceLineItem],
    total_amount_before_tax: float,
    total_tax_amount: float,
    total_amount_after_tax: float,
    customer_name: str,
    customer_address: str,
    customer_phone: str,
    customer_gstin: str,
    personal: dict[str, str],
) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
    )

    styles = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8, leading=10)
    small_right = ParagraphStyle("small_right", parent=small, alignment=TA_RIGHT)
    label = ParagraphStyle("label", parent=small, fontName="Helvetica-Bold")
    title_style = ParagraphStyle(
        "title", parent=styles["Normal"], fontSize=16, fontName="Helvetica-Bold", textColor=colors.HexColor("#1f4e79")
    )
    company_name_style = ParagraphStyle(
        "company_name", parent=styles["Normal"], fontSize=15, fontName="Helvetica-Bold", spaceAfter=3
    )
    centered_bold = ParagraphStyle("centered_bold", parent=small, alignment=TA_CENTER, fontName="Helvetica-Bold")

    elements = []

    # --- Letterhead: seller block (left) / seller contact block (right) ---
    seller_block = [
        Paragraph(personal.get("name") or "Handpikd", company_name_style),
        Paragraph(personal.get("address", ""), small),
    ]
    contact_block = [
        Paragraph(f"<b>Name</b> : {personal.get('name', '')}", small_right),
        Paragraph(f"<b>Phone</b> : {personal.get('phone', '')}", small_right),
        Paragraph(f"<b>Email</b> : {personal.get('email', '')}", small_right),
        Paragraph(f"<b>Website</b> : {personal.get('website', '')}", small_right),
    ]
    header_table = Table([[seller_block, contact_block]], colWidths=[110 * mm, 68 * mm])
    header_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(header_table)
    elements.append(Spacer(1, 4 * mm))

    intra_state = is_intra_state(customer_gstin, personal.get("gstin"))
    is_recipient_note = "ORIGINAL FOR RECIPIENT"
    gst_title_table = Table(
        [
            [
                Paragraph(f"<b>GSTIN</b> : {personal.get('gstin', '')}", small),
                Paragraph("TAX INVOICE", title_style),
                Paragraph(is_recipient_note, small_right),
            ]
        ],
        colWidths=[60 * mm, 58 * mm, 60 * mm],
    )
    gst_title_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    elements.append(gst_title_table)
    elements.append(Spacer(1, 3 * mm))

    # --- Customer detail box (left) / invoice meta box (right) ---
    place_of_supply = state_name_from_gstin(customer_gstin)
    place_of_supply_code = customer_gstin[:2] if customer_gstin else ""
    place_of_supply_text = f"{place_of_supply} ({place_of_supply_code})" if place_of_supply else "-"

    customer_rows = [
        [Paragraph("<b>Customer Detail</b>", label), ""],
        [Paragraph("M/S", small), Paragraph(customer_name, small)],
        [Paragraph("Address", small), Paragraph(customer_address, small)],
        [Paragraph("Phone", small), Paragraph(customer_phone or "-", small)],
        [Paragraph("GSTIN", small), Paragraph(customer_gstin or "-", small)],
        [Paragraph("Place of Supply", small), Paragraph(place_of_supply_text, small)],
    ]
    customer_table = Table(customer_rows, colWidths=[28 * mm, 82 * mm])
    customer_table.setStyle(
        TableStyle(
            [
                ("SPAN", (0, 0), (1, 0)),
                ("BACKGROUND", (0, 0), (1, 0), _HEADER_BG),
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )

    meta_rows = [
        [Paragraph("Invoice No.", small), Paragraph(str(invoice_no), small)],
        [Paragraph("Invoice Type", small), Paragraph(invoice_type.title(), small)],
        [Paragraph("Invoice Date", small), Paragraph(invoice_date.strftime("%d-%b-%Y"), small)],
        [Paragraph("Due Date", small), Paragraph(due_date.strftime("%d-%b-%Y"), small)],
        [Paragraph("Sales Order No.", small), Paragraph(str(order_no), small)],
        [Paragraph("Transport", small), Paragraph(transport or "-", small)],
    ]
    meta_table = Table(meta_rows, colWidths=[30 * mm, 40 * mm])
    meta_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )

    detail_row = Table([[customer_table, meta_table]], colWidths=[112 * mm, 70 * mm])
    detail_row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(detail_row)
    elements.append(Spacer(1, 3 * mm))

    # --- Line items table ---
    if intra_state:
        header = ["Sr.", "Name of Product / Service", "HSN/SAC", "Qty", "Rate", "Taxable\nValue", "CGST\n%", "CGST\nAmt", "SGST\n%", "SGST\nAmt", "Total"]
        col_widths = [8, 34, 16, 10, 16, 20, 10, 14, 10, 14, 20]
    else:
        header = ["Sr.", "Name of Product / Service", "HSN/SAC", "Qty", "Rate", "Taxable\nValue", "IGST\n%", "IGST\nAmt", "Total"]
        col_widths = [8, 42, 18, 10, 18, 22, 12, 18, 24]
    col_widths = [w * mm for w in col_widths]

    header_style = ParagraphStyle("th", parent=small, fontName="Helvetica-Bold", alignment=TA_CENTER)
    cell_style = ParagraphStyle("td", parent=small, alignment=TA_CENTER)

    rows = [[Paragraph(h, header_style) for h in header]]
    for index, item in enumerate(line_items, start=1):
        tax = split_tax(item.tax_perc, item.tax_amount, customer_gstin, personal.get("gstin"))
        base_cells = [
            str(index),
            item.product_name,
            item.hsn_code,
            str(item.quantity),
            f"{item.rate:,.2f}",
            f"{item.taxable_value:,.2f}",
        ]
        if intra_state:
            tax_cells = [
                f"{tax.cgst_perc:.2f}",
                f"{tax.cgst_amount:,.2f}",
                f"{tax.sgst_perc:.2f}",
                f"{tax.sgst_amount:,.2f}",
            ]
        else:
            tax_cells = [f"{tax.igst_perc:.2f}", f"{tax.igst_amount:,.2f}"]
        row_values = base_cells + tax_cells + [f"{item.total:,.2f}"]
        rows.append([Paragraph(value, cell_style) for value in row_values])

    total_qty = sum(item.quantity for item in line_items)
    totals_row = ["", "Total", "", str(total_qty), "", f"{total_amount_before_tax:,.2f}"]
    if intra_state:
        totals_row += ["", f"{total_tax_amount / 2:,.2f}", "", f"{total_tax_amount / 2:,.2f}"]
    else:
        totals_row += ["", f"{total_tax_amount:,.2f}"]
    totals_row += [f"{total_amount_after_tax:,.2f}"]
    rows.append([Paragraph(value, ParagraphStyle("tot", parent=cell_style, fontName="Helvetica-Bold")) for value in totals_row])

    items_table = Table(rows, colWidths=col_widths, repeatRows=1)
    items_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("BACKGROUND", (0, 0), (-1, 0), _HEADER_BG),
                ("BACKGROUND", (0, -1), (-1, -1), _HEADER_BG),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    elements.append(items_table)
    elements.append(Spacer(1, 3 * mm))

    # --- Amount in words + tax summary ---
    words_para = Paragraph(f"<b>Total in words</b><br/>{rupees_to_words(total_amount_after_tax)}", small)
    summary_rows = [
        ["Taxable Amount", _money(total_amount_before_tax)],
        [("CGST + SGST" if intra_state else "Add : IGST"), _money(total_tax_amount)],
        ["Total Tax", _money(total_tax_amount)],
        ["Total Amount After Tax", _money(total_amount_after_tax)],
    ]
    summary_table = Table(
        [[Paragraph(a, small), Paragraph(b, small_right)] for a, b in summary_rows], colWidths=[45 * mm, 40 * mm]
    )
    summary_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("BACKGROUND", (0, -1), (-1, -1), _HEADER_BG),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    words_and_summary = Table([[words_para, summary_table]], colWidths=[97 * mm, 85 * mm])
    words_and_summary.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(words_and_summary)
    elements.append(Spacer(1, 3 * mm))

    # --- Bank details / QR (left) + terms & conditions + signature (right) ---
    bank_lines = [
        ("Name", personal.get("bank_name", "")),
        ("Branch", personal.get("bank_branch", "")),
        ("Acc. Name", personal.get("bank_account_name", "")),
        ("Acc. Number", personal.get("bank_account_no", "")),
        ("IFSC", personal.get("bank_ifsc", "")),
    ]
    bank_rows = [[Paragraph("<b>Bank Details</b>", label), ""]]
    bank_rows += [[Paragraph(k, small), Paragraph(v or "-", small)] for k, v in bank_lines]
    bank_table = Table(bank_rows, colWidths=[26 * mm, 45 * mm])
    bank_table.setStyle(
        TableStyle(
            [
                ("SPAN", (0, 0), (1, 0)),
                ("BACKGROUND", (0, 0), (1, 0), _HEADER_BG),
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )

    left_column = [bank_table]
    qr_value = personal.get("qr_value", "")
    if qr_value:
        qr_img = qrcode.make(qr_value)
        qr_buffer = io.BytesIO()
        qr_img.save(qr_buffer, format="PNG")
        qr_buffer.seek(0)
        left_column.append(Spacer(1, 2 * mm))
        left_column.append(Paragraph("Scan to pay", small))
        left_column.append(Image(qr_buffer, width=25 * mm, height=25 * mm))

    tnc_text = personal.get("invoice_tnc", "")
    tnc_lines = [line.strip() for line in tnc_text.splitlines() if line.strip()]
    tnc_flow = [Paragraph("<b>Terms and Conditions</b>", label)]
    if tnc_lines:
        tnc_flow += [Paragraph(f"&bull; {line}", small) for line in tnc_lines]
    else:
        tnc_flow.append(Paragraph("-", small))
    tnc_flow.append(Spacer(1, 8 * mm))
    tnc_flow.append(Paragraph("For " + (personal.get("name") or "Handpikd"), centered_bold))
    tnc_flow.append(Spacer(1, 10 * mm))
    tnc_flow.append(Paragraph("Authorised Signatory", centered_bold))

    footer_row = Table([[left_column, tnc_flow]], colWidths=[75 * mm, 107 * mm])
    footer_row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(footer_row)
    elements.append(Spacer(1, 4 * mm))
    elements.append(
        Paragraph(
            "THIS IS A SYSTEM GENERATED INVOICE AND DOES NOT REQUIRE AN AUTHORISED SIGNATURE",
            ParagraphStyle("footer_note", parent=small, alignment=TA_CENTER, textColor=colors.grey),
        )
    )

    doc.build(elements)
    return buffer.getvalue()
