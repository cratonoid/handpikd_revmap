# Unit tests for the deterministic half of reading an uploaded vendor
# invoice (app/services/invoice_extraction.py). The fixtures below rebuild
# the table layouts of four real vendor invoices — one where every column
# including CGST/SGST/IGST % sits in the item row, one that stacks the
# invoice number under its label and ships a duplicate copy as a second page,
# one that states GST only in the HSN-wise summary at the foot, and one whose
# every row is set at several baselines at once — since those differences are
# exactly what the parser has to survive.
#
# Text is placed by coordinate rather than written as lines: page_lines
# regroups words by position (invoices are tables), so a fixture that
# inserted whole rows as single strings would test something the parser never
# sees.
#
# Nothing here touches the database or the network — the Claude fallback
# (services/claude_invoice_extraction.py) is a separate stage, only reached
# when these functions return None.
import pymupdf
import pytest

from app.services.invoice_extraction import extract_invoice_from_text

OUR_GSTIN = "08DINPA7100K1ZA"


def _pdf(pages: list[list[tuple[float, list[tuple[float, str]]]]]) -> bytes:
    """Builds a PDF from pages of (y, [(x, cell_text), ...]) rows."""
    document = pymupdf.open()
    try:
        for rows in pages:
            page = document.new_page(width=1200, height=800)
            for y, cells in rows:
                for x, text in cells:
                    page.insert_text((x, y), text, fontsize=7)
        return document.tobytes()
    finally:
        document.close()


# Every column in the item row, with CGST %, SGST % and IGST % printed
# separately — the line's rate is their sum.
KRAFT_LAYOUT = [
    [
        (40, [(60, "KRAFT ARTEFACTO HAUS"), (600, "GSTIN : 07AKXPA3658B1Z5")]),
        (60, [(60, "TAX INVOICE")]),
        (80, [(60, "Invoice No. :"), (200, "KAH/2026-27/00001")]),
        (95, [(60, "Invoice Date:"), (200, "16-05-2026")]),
        (110, [(60, "Details of Receiver (Billed to)")]),
        (125, [(60, "Name:"), (200, "Handpikd")]),
        (140, [(60, "GSTIN Number:"), (200, OUR_GSTIN)]),
        (160, [(40, "S.No"), (90, "Item Code"), (160, "Description"), (500, "HSN"), (560, "Qty")]),
        (
            185,
            [
                (40, "1"),
                (90, "3 mm"),
                (160, "Frigde Magnet 100 pcs with UV print (58 x 58 mm)"),
                (500, "44111200"),
                (560, "100"),
                (600, "sqft"),
                (640, "35.00"),
                (700, "0.00"),
                (760, "3500.00"),
                (820, "0%"),
                (860, "0.00"),
                (900, "0%"),
                (940, "0.00"),
                (980, "18%"),
                (1020, "630.00"),
                (1090, "4130.00"),
            ],
        ),
        (210, [(40, "Total"), (560, "100.00"), (640, "35.00"), (760, "3500.00"), (1090, "4130.00")]),
        (240, [(900, "Grand Total"), (1090, "4,130.00")]),
    ]
]

# Invoice number stacked under its label, a tax-inclusive rate column beside
# the taxable one, and the same invoice repeated as a "duplicate for
# transporter" second page.
_SHAH_PAGE = [
    (40, [(60, "Shah Clock Agencies")]),
    (55, [(60, "GSTIN/UIN: 29ABJPN9424H1Z7")]),
    (75, [(60, "Buyer (Bill to) Handpikd")]),
    (90, [(60, "GSTIN/UIN"), (200, ": " + OUR_GSTIN)]),
    (110, [(700, "Invoice No."), (900, "Dated")]),
    (125, [(700, "Sca/26-27/1147"), (900, "22-Apr-26")]),
    (150, [(40, "Sl"), (100, "Description of Goods"), (400, "HSN/SAC"), (470, "GST Rate")]),
    (
        180,
        [
            (40, "1"),
            (100, "Ab80 Gym Shaker Bottle"),
            (400, "39249090"),
            (470, "18 %"),
            (540, "20 pcs"),
            (620, "100.30"),
            (700, "85.00"),
            (760, "pcs"),
            (860, "1,700.00"),
        ],
    ),
    (210, [(100, "Integrated IGST Output Tax"), (860, "306.00")]),
    (240, [(40, "Total"), (540, "20 pcs"), (860, "2,006.00")]),
]
SHAH_LAYOUT = [_SHAH_PAGE, _SHAH_PAGE]

# No GST % anywhere in the item rows — it's only in the HSN-wise tax summary
# at the foot, and it differs between the rows.
HELLO_PEN_LAYOUT = [
    [
        (40, [(60, "Hello Pen Mart")]),
        (55, [(60, "GSTIN/UIN: 29AFBPP6505R1ZS")]),
        (75, [(60, "Buyer (Bill to) Handpikd")]),
        (90, [(60, "GSTIN/UIN"), (200, ": " + OUR_GSTIN)]),
        (110, [(700, "Invoice No."), (900, "Dated")]),
        (125, [(700, "HPM/26-27/1621"), (900, "19-May-26")]),
        (150, [(40, "Sl"), (100, "Description of Goods"), (400, "HSN/SAC"), (500, "Quantity")]),
        (180, [(40, "1"), (100, "FOGG ( COMBO SET )"), (400, "33072000"), (500, "2 nos"), (600, "660.00"), (680, "nos"), (800, "1,320.00")]),
        (200, [(40, "2"), (100, "FOGG ( COMBO SET )"), (400, "33072000"), (500, "2 nos"), (600, "555.00"), (680, "nos"), (800, "1,110.00")]),
        (220, [(40, "3"), (100, "PAPER BOARD"), (400, "481920"), (500, "1 nos"), (600, "65.00"), (680, "nos"), (800, "65.00")]),
        (250, [(600, "IGST"), (800, "440.65")]),
        (270, [(40, "Total"), (500, "5 nos"), (800, "2,936.00")]),
        (310, [(40, "HSN/SAC"), (400, "Taxable Value"), (500, "Rate"), (600, "Amount")]),
        (330, [(40, "33072000"), (400, "2,430.00"), (500, "18%"), (600, "437.40")]),
        (350, [(40, "481920"), (400, "65.00"), (500, "5%"), (600, "3.25")]),
    ]
]

# A Tally invoice, where the cells of one row are each set in their own font
# and so land on baselines up to two points apart, and where the row under
# the "Invoice No." label spans the page — carrying the letterhead's own
# address on the left, well before the number itself.
TALLY_LAYOUT = [
    [
        (14, [(225, "Tax Invoice")]),
        (31, [(34, "Hello Pen Mart"), (260, "Invoice No."), (370, "Dated")]),
        (40, [(260, "HPM/26-27/257"), (370, "9-Apr-26")]),
        (42, [(34, "BRANCH OFFICE")]),
        (53, [(34, "#186/1 1ST FLOOR KS GARDEN"), (260, "Delivery Note")]),
        (97, [(34, "GSTIN/UIN: 29AFBPP6505R1ZS")]),
        (253, [(34, "GSTIN/UIN : " + OUR_GSTIN)]),
        (284, [(34, "Sl"), (79, "Description of Goods"), (208, "HSN/SAC"), (261, "Quantity")]),
        # One item row across three baselines: the description and amount,
        # the serial number, and the HSN code with the rate.
        (313, [(44, "BALL PEN"), (270, "80 nos"), (440, "2,000.00")]),
        (314, [(34, "1")]),
        (315, [(205, "960810"), (330, "25.00"), (359, "nos")]),
        (347, [(172, "IGST"), (449, "360.00")]),
        (636, [(177, "Total"), (270, "80 nos"), (433, "2,360.00")]),
        (702, [(34, "960810"), (300, "2,000.00"), (350, "18%"), (396, "360.00")]),
    ]
]


def test_reads_an_invoice_with_every_column_in_the_item_row():
    extracted = extract_invoice_from_text(_pdf(KRAFT_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    assert extracted.invoice_no == "KAH/2026-27/00001"
    assert extracted.invoice_date.date().isoformat() == "2026-05-16"
    # The vendor's GSTIN, not ours — both are on the page.
    assert extracted.vendor_gstin == "07AKXPA3658B1Z5"
    assert extracted.source == "text"

    (item,) = extracted.line_items
    assert item.quantity == 100
    assert item.rate == 35.0
    # CGST 0% + SGST 0% + IGST 18%, the same blended rate a purchase order
    # holds.
    assert item.gst_perc == 18.0
    assert "Frigde Magnet" in item.description
    # The leading serial number is the row's position in the table, not part
    # of the product.
    assert not item.description.startswith("1 ")


def test_reads_a_stacked_invoice_number_and_the_taxable_rate():
    extracted = extract_invoice_from_text(_pdf(SHAH_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    # The number sits in the cell below its label, and the cell below the
    # "Dated" label next to it must not be mistaken for it.
    assert extracted.invoice_no == "Sca/26-27/1147"
    assert extracted.invoice_date.date().isoformat() == "2026-04-22"
    assert extracted.vendor_gstin == "29ABJPN9424H1Z7"

    (item,) = extracted.line_items
    assert item.quantity == 20
    # 85.00 is the taxable rate; 100.30 in the column beside it is the same
    # rate with tax in it, and 20 x 100.30 is not the row's amount.
    assert item.rate == 85.0
    assert item.gst_perc == 18.0
    assert item.description == "Ab80 Gym Shaker Bottle"


def test_a_duplicate_copy_page_does_not_double_the_line_items():
    # This vendor ships "original for recipient" and "duplicate for
    # transporter" copies of one invoice in a single PDF. Reading both would
    # order twice the stock that was actually bought.
    extracted = extract_invoice_from_text(_pdf(SHAH_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    assert len(extracted.line_items) == 1


def test_reads_gst_percentages_from_the_hsn_summary_when_rows_omit_them():
    extracted = extract_invoice_from_text(_pdf(HELLO_PEN_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    assert extracted.invoice_no == "HPM/26-27/1621"
    assert extracted.vendor_gstin == "29AFBPP6505R1ZS"

    assert [(item.quantity, item.rate, item.gst_perc) for item in extracted.line_items] == [
        (2, 660.0, 18.0),
        (2, 555.0, 18.0),
        # Falls to 5% off the summary row for its own HSN code, not the 18%
        # the rows above it carry.
        (1, 65.0, 5.0),
    ]


def test_summary_and_total_rows_are_not_read_as_line_items():
    extracted = extract_invoice_from_text(_pdf(HELLO_PEN_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    # Three products, despite the tax summary rows below them carrying an
    # HSN code and a column of numbers each.
    assert len(extracted.line_items) == 3


def test_an_item_row_split_across_several_baselines_still_reads_as_one():
    # This vendor sets each cell of a row in its own font, so the row's parts
    # sit at baselines a point or two apart. Grouped on the exact coordinate
    # they fragment into a description with no HSN code and an HSN code with
    # no description, and the invoice reads as having no line items at all.
    extracted = extract_invoice_from_text(_pdf(TALLY_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    (item,) = extracted.line_items
    assert item.description == "BALL PEN"
    assert (item.quantity, item.rate, item.gst_perc) == (80, 25.0, 18.0)


def test_the_invoice_number_is_read_from_the_label_s_own_column():
    # The row below the "Invoice No." label runs the width of the page, and
    # opens with the letterhead's "BRANCH OFFICE" — which is a well-formed
    # invoice number as far as shape goes. Only its column tells the two
    # apart, and the "Dated" column beside it must not win either.
    extracted = extract_invoice_from_text(_pdf(TALLY_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    assert extracted.invoice_no == "HPM/26-27/257"
    assert extracted.invoice_date.date().isoformat() == "2026-04-09"


def test_an_unreadable_layout_returns_none_for_the_claude_fallback():
    # A PDF with no item table at all: the deterministic pass has to say so
    # rather than return a header-only invoice, since that's what hands the
    # document to Claude instead (see extract_invoice).
    pdf = _pdf([[(40, [(60, "Delivery challan"), (400, "GSTIN: 29ABJPN9424H1Z7")])]])

    assert extract_invoice_from_text(pdf, OUR_GSTIN) is None


@pytest.mark.parametrize("layout", [KRAFT_LAYOUT, SHAH_LAYOUT, HELLO_PEN_LAYOUT, TALLY_LAYOUT])
def test_every_line_item_carries_a_usable_quantity_and_rate(layout):
    extracted = extract_invoice_from_text(_pdf(layout), OUR_GSTIN)

    assert extracted is not None
    for item in extracted.line_items:
        assert item.quantity > 0
        assert item.rate > 0
        assert item.description
