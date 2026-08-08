# Renders an InvoiceDetails row (plus its joined sales order/line items/
# customer/seller data) into a PDF matching the structure of Handpikd's
# real invoice template (letterhead, customer/invoice-meta boxes, two-tier
# GST line-item table, totals, amount in words, bank details, terms &
# conditions, certification/signature block). Pure rendering only —
# routes/invoices.py does all the DB lookups and joins (SalesOrders,
# SalesSummary, ProductDetails, CustomerDetails, CustomerPocDetails,
# personal_details) and passes plain data in.
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
_TITLE_BLUE = colors.HexColor("#1f4e79")


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


def _amount(value: float) -> str:
    return f"{value:,.2f}"


def _money(value: float) -> str:
    # Only the grand-total line carries a currency mark in the sample
    # ("Rs." rather than "₹" — the base-14 PDF fonts this document uses
    # don't include the Indian Rupee glyph, and bundling a Unicode font just
    # for that one character isn't worth the extra dependency).
    return f"Rs.{value:,.2f}"


def generate_invoice_pdf(
    *,
    invoice_no: int,
    invoice_date: datetime,
    due_date: datetime,
    transport: str,
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
        "title", parent=styles["Normal"], fontSize=16, fontName="Helvetica-Bold", textColor=_TITLE_BLUE, alignment=TA_CENTER
    )
    company_name_style = ParagraphStyle(
        "company_name", parent=styles["Normal"], fontSize=20, leading=24, fontName="Helvetica-Bold", spaceAfter=6
    )
    centered_bold = ParagraphStyle("centered_bold", parent=small, alignment=TA_CENTER, fontName="Helvetica-Bold")
    centered = ParagraphStyle("centered", parent=small, alignment=TA_CENTER)
    box_header = ParagraphStyle("box_header", parent=centered_bold, fontSize=8.5)

    company_name = personal.get("company_name") or "Handpikd"
    elements = []

    # --- Letterhead: seller block (left) / seller contact block (right) ---
    seller_block = [
        Paragraph(company_name, company_name_style),
        Paragraph(personal.get("address", ""), small),
    ]
    contact_block = [
        Paragraph(f"<b>Name</b> : {personal.get('name', '')}", small_right),
        Paragraph(f"<b>Phone</b> : {personal.get('phone', '')}", small_right),
        Paragraph(f"<b>Email</b> : {personal.get('email', '')}", small_right),
        Paragraph(f"<b>Website</b> : {personal.get('website', '')}", small_right),
    ]
    header_table = Table([[seller_block, contact_block]], colWidths=[110 * mm, 72 * mm])
    header_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(header_table)
    elements.append(Spacer(1, 3 * mm))

    intra_state = is_intra_state(customer_gstin, personal.get("gstin"))
    gst_title_table = Table(
        [
            [
                Paragraph(f"<b>GSTIN</b> : {personal.get('gstin', '')}", small),
                Paragraph("TAX INVOICE", title_style),
                Paragraph("ORIGINAL FOR RECIPIENT", small_right),
            ]
        ],
        colWidths=[60 * mm, 62 * mm, 60 * mm],
    )
    gst_title_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.black),
                ("LINEAFTER", (0, 0), (0, 0), 0.5, _GRID),
                ("LINEAFTER", (1, 0), (1, 0), 0.5, _GRID),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(gst_title_table)
    elements.append(Spacer(1, 0))

    # --- Customer detail box (left) / invoice meta box (right) ---
    place_of_supply = state_name_from_gstin(customer_gstin)
    place_of_supply_code = customer_gstin[:2] if customer_gstin else ""
    place_of_supply_text = f"{place_of_supply} ( {place_of_supply_code} )" if place_of_supply else "-"

    customer_rows = [
        [Paragraph("<b>Customer Detail</b>", label), ""],
        [Paragraph("M/S", small), Paragraph(customer_name, small)],
        [Paragraph("Address", small), Paragraph(customer_address, small)],
        [Paragraph("Phone", small), Paragraph(customer_phone or "-", small)],
        [Paragraph("GSTIN", small), Paragraph(customer_gstin or "-", small)],
        [Paragraph("Place of\nSupply", small), Paragraph(place_of_supply_text, small)],
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
        [
            Paragraph("Invoice No.", small),
            Paragraph(str(invoice_no), small),
            Paragraph("Invoice Date", small),
            Paragraph(invoice_date.strftime("%d-%b-%Y"), small),
        ],
        [Paragraph("Due Date", small), Paragraph(due_date.strftime("%d-%b-%Y"), small), "", ""],
        [Paragraph("Transport", small), Paragraph(transport or "-", small), "", ""],
    ]
    meta_table = Table(meta_rows, colWidths=[17 * mm, 15 * mm, 20 * mm, 20 * mm])
    meta_table.setStyle(
        TableStyle(
            [
                ("SPAN", (1, 1), (3, 1)),
                ("SPAN", (1, 2), (3, 2)),
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )

    detail_row = Table([[customer_table, meta_table]], colWidths=[110 * mm, 72 * mm])
    detail_row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(detail_row)
    elements.append(Spacer(1, 3 * mm))

    # --- Line items table (two-row header: e.g. "IGST" spanning "%"/"Amount") ---
    header_style = ParagraphStyle("th", parent=small, fontName="Helvetica-Bold", alignment=TA_CENTER)
    cell_style = ParagraphStyle("td", parent=small, alignment=TA_CENTER)

    base_header = ["Sr.\nNo.", "Name of Product / Service", "HSN /\nSAC", "Qty", "Rate", "Taxable\nValue"]
    if intra_state:
        header_row1 = base_header + ["CGST", "", "SGST", "", "Total"]
        header_row2 = [""] * 6 + ["%", "Amount", "%", "Amount", ""]
        col_widths = [10, 45, 16, 13, 16, 20, 9, 13, 9, 13, 18]
        tax_super_spans = [((6, 0), (7, 0)), ((8, 0), (9, 0))]
        vertical_span_cols = [0, 1, 2, 3, 4, 5, 10]
    else:
        header_row1 = base_header + ["IGST", "", "Total"]
        header_row2 = [""] * 6 + ["%", "Amount", ""]
        col_widths = [10, 46, 18, 14, 18, 22, 12, 18, 24]
        tax_super_spans = [((6, 0), (7, 0))]
        vertical_span_cols = [0, 1, 2, 3, 4, 5, 8]
    col_widths = [w * mm for w in col_widths]

    rows = [
        [Paragraph(h, header_style) for h in header_row1],
        [Paragraph(h, header_style) for h in header_row2],
    ]
    for index, item in enumerate(line_items, start=1):
        tax = split_tax(item.tax_perc, item.tax_amount, customer_gstin, personal.get("gstin"))
        base_cells = [
            str(index),
            item.product_name,
            item.hsn_code,
            _amount(item.quantity),
            _amount(item.rate),
            _amount(item.taxable_value),
        ]
        if intra_state:
            tax_cells = [
                f"{tax.cgst_perc:.2f}",
                _amount(tax.cgst_amount),
                f"{tax.sgst_perc:.2f}",
                _amount(tax.sgst_amount),
            ]
        else:
            tax_cells = [f"{tax.igst_perc:.2f}", _amount(tax.igst_amount)]
        row_values = base_cells + tax_cells + [_amount(item.total)]
        rows.append([Paragraph(value, cell_style) for value in row_values])

    total_qty = sum(item.quantity for item in line_items)
    totals_row = ["", "Total", "", _amount(total_qty), "", _amount(total_amount_before_tax)]
    if intra_state:
        totals_row += ["", _amount(total_tax_amount / 2), "", _amount(total_tax_amount / 2)]
    else:
        totals_row += ["", _amount(total_tax_amount)]
    totals_row += [_amount(total_amount_after_tax)]
    rows.append([Paragraph(value, ParagraphStyle("tot", parent=cell_style, fontName="Helvetica-Bold")) for value in totals_row])

    items_table = Table(rows, colWidths=col_widths, repeatRows=2)
    table_style = [
        ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
        ("BACKGROUND", (0, 0), (-1, 1), _HEADER_BG),
        ("BACKGROUND", (0, -1), (-1, -1), _HEADER_BG),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for col in vertical_span_cols:
        table_style.append(("SPAN", (col, 0), (col, 1)))
    for start, end in tax_super_spans:
        table_style.append(("SPAN", start, end))
    items_table.setStyle(TableStyle(table_style))
    elements.append(items_table)
    elements.append(Spacer(1, 3 * mm))

    # --- Amount in words (left) + tax summary (right) ---
    words_table = Table(
        [
            [Paragraph("Total in words", box_header)],
            [Paragraph(rupees_to_words(total_amount_after_tax), centered)],
        ],
        colWidths=[97 * mm],
    )
    words_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), _HEADER_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, _GRID),
                ("LINEBELOW", (0, 0), (0, 0), 0.5, _GRID),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )

    summary_rows = [
        ("Taxable Amount", _amount(total_amount_before_tax), False),
        ("CGST + SGST" if intra_state else "Add : IGST", _amount(total_tax_amount), False),
        ("Total Tax", _amount(total_tax_amount), False),
        ("Total Amount After Tax", _money(total_amount_after_tax), True),
    ]
    summary_table = Table(
        [
            [
                Paragraph(label_text, centered_bold if bold else small),
                Paragraph(value_text, centered_bold if bold else small_right),
            ]
            for label_text, value_text, bold in summary_rows
        ],
        colWidths=[45 * mm, 40 * mm],
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
    words_and_summary = Table([[words_table, summary_table]], colWidths=[97 * mm, 85 * mm])
    words_and_summary.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(words_and_summary)
    elements.append(Spacer(1, 0))

    # --- Left column: bank details + terms & conditions ---
    bank_lines = [
        ("Name", personal.get("bank_name", "")),
        ("Branch", personal.get("bank_branch", "")),
        ("Acc. Name", personal.get("bank_account_name", "")),
        ("Acc. Number", personal.get("bank_account_no", "")),
        ("IFSC", personal.get("bank_ifsc", "")),
    ]
    bank_rows = [[Paragraph("Bank Details", box_header), ""]]
    bank_rows += [[Paragraph(k, small), Paragraph(v or "-", small)] for k, v in bank_lines]
    bank_table = Table(bank_rows, colWidths=[26 * mm, 49 * mm])
    bank_table.setStyle(
        TableStyle(
            [
                ("SPAN", (0, 0), (1, 0)),
                ("BACKGROUND", (0, 0), (1, 0), _HEADER_BG),
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )

    qr_value = personal.get("qr_value", "")
    left_column = [bank_table]
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
    tnc_rows = [[Paragraph("Terms and Conditions", box_header)]]
    if tnc_lines:
        tnc_rows += [[Paragraph(line, small)] for line in tnc_lines]
    else:
        tnc_rows.append([Paragraph("-", small)])
    tnc_table = Table(tnc_rows, colWidths=[75 * mm])
    tnc_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), _HEADER_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, _GRID),
                ("LINEBELOW", (0, 0), (0, 0), 0.5, _GRID),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    left_column.append(Spacer(1, 3 * mm))
    left_column.append(tnc_table)

    # --- Right column: certification / signature block ---
    footer_note_style = ParagraphStyle(
        "footer_note", parent=small, alignment=TA_CENTER, textColor=colors.grey, spaceBefore=28 * mm
    )
    signature_rows = [
        [Paragraph("(E & O.E.)", small_right)],
        [Paragraph("Certified that the particulars given above are true and correct.", centered_bold)],
        [Paragraph("For " + company_name, centered_bold)],
        [
            Paragraph(
                "THIS IS A SYSTEM GENERATED INVOICE AND DOES NOT REQUIRE AN AUTHORISED SIGNATURE",
                footer_note_style,
            )
        ],
        [Paragraph("Authorised Signatory", centered_bold)],
    ]
    signature_table = Table(signature_rows, colWidths=[107 * mm])
    signature_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, _GRID),
                ("LINEABOVE", (0, -1), (-1, -1), 0.5, _GRID),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, -1), (-1, -1), 6),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 14 * mm),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )

    footer_row = Table([[left_column, signature_table]], colWidths=[75 * mm, 107 * mm])
    footer_row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(footer_row)

    doc.build(elements)
    return buffer.getvalue()
