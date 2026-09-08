# Unit tests for the deterministic half of reading an uploaded vendor
# invoice (app/services/invoice_extraction.py). The fixtures below rebuild
# the table layouts of five real vendor invoices — one where every column
# including CGST/SGST/IGST % sits in the item row, one that stacks the
# invoice number under its label and ships a duplicate copy as a second page,
# one that states GST only in the HSN-wise summary at the foot, one whose
# every row is set at several baselines at once, one whose product names
# carry a model number that reads as an HSN code, and one that heads its
# table "Invoice No. e-Way Bill No." and states its GST rate only in a
# summary that omits the HSN code — since those differences are exactly what
# the parser has to survive.
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

from app.services.invoice_extraction import _find_printed_total, extract_invoice_from_text

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


# A Tally invoice whose products are named after their model number, so the
# item row carries a 4-digit number that reads as an HSN code well before the
# real 8-digit one. GST % is stated nowhere in the row itself — only on the
# IGST line below it and in the HSN-wise summary — so reading the wrong code
# leaves the row with no rate at all.
MUTHA_LAYOUT = [
    [
        (14, [(225, "Tax Invoice")]),
        (31, [(34, "MUTHA COLLECTIONS"), (260, "Invoice No."), (370, "Dated")]),
        (40, [(260, "MC/26-27/672"), (370, "18-Jun-26")]),
        (97, [(34, "GSTIN/UIN: 29AASPK1333N1Z6")]),
        (253, [(34, "GSTIN/UIN : " + OUR_GSTIN)]),
        (284, [(34, "Sl"), (79, "Description of Goods"), (208, "HSN/SAC"), (261, "Quantity"), (330, "Rate"), (440, "Amount")]),
        (313, [(34, "1"), (44, "Trophy 7013"), (205, "70139900"), (261, "1 pcs"), (330, "1,000.00"), (359, "pcs"), (440, "1,000.00")]),
        (347, [(172, "IGST Tax 18%"), (300, "18"), (320, "%"), (449, "180.00")]),
        (636, [(177, "Total"), (270, "1 pcs"), (433, "1,180.00")]),
        (702, [(34, "70139900"), (300, "1,000.00"), (350, "18%"), (396, "180.00")]),
    ]
]


# The same vendor's next invoice, where the model number in the name is the
# first four digits OF the row's real HSN code ("Trophy 8306" against
# 83062990) and the row prints its own 5% — so nothing about the wrong
# candidate looks wrong: it multiplies out and it resolves a rate.
MUTHA_PREFIX_LAYOUT = [
    [
        (14, [(225, "Tax Invoice")]),
        (31, [(34, "MUTHA COLLECTIONS"), (260, "Invoice No."), (370, "Dated")]),
        (40, [(260, "MC/26-27/787"), (370, "30-Jun-26")]),
        (97, [(34, "GSTIN/UIN: 29AASPK1333N1Z6")]),
        (253, [(34, "GSTIN/UIN : " + OUR_GSTIN)]),
        (284, [(34, "Sl"), (79, "Description of Goods"), (208, "HSN/SAC"), (261, "Quantity"), (330, "Rate"), (440, "Amount")]),
        (313, [(34, "1"), (44, "Trophy 8306 5%"), (205, "83062990"), (261, "1 pcs"), (330, "1,000.00"), (359, "pcs"), (440, "1,000.00")]),
        (347, [(172, "Igst Tax 5%"), (300, "5"), (320, "%"), (449, "50.00")]),
        (636, [(177, "Total"), (270, "1 pcs"), (433, "1,050.00")]),
        (702, [(34, "83062990"), (300, "1,000.00"), (350, "5%"), (396, "50.00")]),
    ]
]


# A Tally invoice for a printing service billed as a lump sum: the Quantity
# and Rate columns of its own table are left empty and only the amount is
# printed, so there is no quantity x rate to check. The service's name also
# wraps onto the row below, and the table's own "Sl / No." heading wraps onto
# the row above it — a fragment that must NOT be read as part of the name.
NEXGEN_LAYOUT = [
    [
        (14, [(225, "Tax Invoice")]),
        (31, [(34, "NEXGEN PRINT SIGNAGE"), (260, "Invoice No."), (350, "e-Way Bill No."), (430, "Dated")]),
        (43, [(34, "#219, 2ND FLOOR"), (260, "584"), (430, "23-Jul-26")]),
        (97, [(34, "GSTIN/UIN: 29HZYPK7338R1ZP")]),
        (253, [(34, "GSTIN/UIN : " + OUR_GSTIN)]),
        (284, [(37, "Sl"), (133, "Description of Goods"), (311, "HSN/SAC"), (366, "Quantity"), (426, "Rate"), (466, "per"), (506, "Amount")]),
        (296, [(37, "No.")]),
        (313, [(42, "1"), (53, "NON Tearable Vinyl"), (308, "49111010"), (518, "1,200.00")]),
        (325, [(64, "Eco Solvent Print")]),
        (347, [(243, "SALES IGST"), (527, "216.00")]),
        (636, [(282, "Total"), (510, "1,416.00")]),
        (702, [(37, "49111010"), (371, "1,200.00"), (423, "18%"), (471, "216.00"), (529, "216.00")]),
        (714, [(326, "Total"), (371, "1,200.00"), (471, "216.00"), (529, "216.00")]),
    ]
]


# An invoice that centres a wrapped item name vertically against its numbers:
# the second line's name sits on the rows both above AND below the row
# carrying its figures, which is left holding nothing but the serial "2".
# The row above it is the first line's own row, so the fragment between them
# is equally adjacent to both items.
DMS_LAYOUT = [
    [
        (14, [(225, "Tax Invoice")]),
        (31, [(34, "DMS PRINT SHOP"), (260, "Invoice No."), (430, "Date")]),
        (43, [(260, "INV/26-27-229"), (430, "22-07-2026")]),
        (97, [(34, "GSTIN: 29IFQPS7827E1ZI")]),
        (253, [(34, "GSTIN : " + OUR_GSTIN)]),
        (272, [(419, "Taxable")]),
        (284, [(36, "#"), (56, "Item name"), (180, "HSN/ SAC"), (250, "Quantity"), (317, "Unit Price/ Unit"), (488, "GST"), (529, "Amount")]),
        (296, [(418, "amount")]),
        (313, [(36, "1"), (56, "20mm Plain Satin SLH"), (180, "83089019"), (274, "40"), (317, "NOS"), (371, "10.00"), (424, "400.00"), (463, "72.00"), (483, "(18%)"), (537, "472.00")]),
        (325, [(56, "Digital ID")]),
        (337, [(36, "2"), (180, "39219096"), (274, "75"), (317, "NOS"), (371, "22.00"), (418, "1,650.00"), (459, "297.00"), (483, "(18%)"), (531, "1,947.00")]),
        (349, [(56, "Card_D/S_Event_85X130")]),
        (636, [(56, "Total"), (270, "115"), (414, "2,050.00"), (477, "369.00"), (527, "2,419.00")]),
        (702, [(70, "39219096"), (178, "1,650.00"), (300, "18%"), (457, "297.00"), (500, "297.00")]),
        (714, [(70, "83089019"), (178, "400.00"), (300, "18%"), (457, "72.00"), (500, "72.00")]),
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


def test_a_model_number_in_the_description_is_not_read_as_the_hsn_code():
    # "Trophy 7013" puts a well-formed 4-digit HSN code in the product's own
    # name, ahead of the row's real 70139900. Taking the first one leaves the
    # row's GST % unresolvable (7013 is in no tax summary) and hands a
    # perfectly readable invoice to the Claude fallback.
    extracted = extract_invoice_from_text(_pdf(MUTHA_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    assert extracted.invoice_no == "MC/26-27/672"
    (item,) = extracted.line_items
    assert item.description == "Trophy 7013"
    assert item.hsn_code == "70139900"
    assert (item.quantity, item.rate, item.gst_perc) == (1, 1000.0, 18.0)


def test_a_model_number_that_prefixes_the_real_hsn_code_is_not_read_as_it():
    # "Trophy 8306" is the harder half of the case above: 8306 is not just a
    # well-formed code, it is the start of this row's actual 83062990, and
    # the row prints a 5% that the wrong candidate happily takes as its own.
    # Read that way the line comes back as a bare "Trophy" — which then
    # matches our unrelated "Trophy 7013" in the intake's product lookup and
    # moves that product's stock.
    extracted = extract_invoice_from_text(_pdf(MUTHA_PREFIX_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    (item,) = extracted.line_items
    assert item.description == "Trophy 8306 5%"
    assert item.hsn_code == "83062990"
    assert (item.quantity, item.rate, item.gst_perc) == (1, 1000.0, 5.0)


def test_reads_a_lump_sum_line_with_no_quantity_or_rate_column():
    # Nexgen leave the Quantity and Rate columns of their own table empty and
    # print only the amount, so there is no triple for _find_quantity_rate to
    # check and the whole invoice used to fall through to Claude. One unit at
    # the printed amount is what the line means.
    extracted = extract_invoice_from_text(_pdf(NEXGEN_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    (item,) = extracted.line_items
    assert item.hsn_code == "49111010"
    assert (item.quantity, item.rate, item.gst_perc) == (1, 1200.00, 18.0)


def test_a_name_wrapped_onto_the_row_below_is_read_as_part_of_it():
    # "Eco Solvent Print" is the tail of the service's name, sitting in the
    # description column on the row below the figures. The "No." on the row
    # above is the other half of the table's own "Sl / No." heading and sits
    # further left than the description column starts, so it stays out.
    extracted = extract_invoice_from_text(_pdf(NEXGEN_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    (item,) = extracted.line_items
    assert item.description == "NON Tearable Vinyl Eco Solvent Print"


def test_a_name_wrapped_above_and_below_its_figures_belongs_to_that_line():
    # DMS centre a wrapped name against its numbers, so "Digital ID" sits
    # directly below line 1's row and directly above line 2's — which is left
    # holding nothing but the serial "2". It belongs to line 2, the line that
    # has no name of its own; line 1 keeps only what's printed on its own row.
    # Read naively, line 2's product was recorded as "2".
    extracted = extract_invoice_from_text(_pdf(DMS_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    first, second = extracted.line_items
    assert first.description == "20mm Plain Satin SLH"
    assert second.description == "Digital ID Card_D/S_Event_85X130"
    assert (second.quantity, second.rate, second.gst_perc) == (75, 22.00, 18.0)


def test_a_wrapped_column_heading_is_not_read_as_a_line_s_name():
    # "Taxable / amount" is a column heading broken over two rows, the second
    # of which is a lone word with nothing else on its row — the same shape as
    # a wrapped product name. It sits above the first line item and is kept
    # out by its position: the heading is over the money columns, far to the
    # right of the description column.
    extracted = extract_invoice_from_text(_pdf(DMS_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    assert "amount" not in extracted.line_items[0].description


def test_the_hsn_summary_rows_are_not_read_as_line_items():
    # The tax summary at the foot is keyed by HSN code alone, so its rows have
    # nothing before the code — not even a serial number. That is what tells
    # them from a line whose name merely wrapped away (DMS's "2"), and both
    # kinds of row are on this invoice.
    extracted = extract_invoice_from_text(_pdf(DMS_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    assert len(extracted.line_items) == 2

def test_an_unreadable_layout_returns_none_for_the_claude_fallback():
    # A PDF with no item table at all: the deterministic pass has to say so
    # rather than return a header-only invoice, since that's what hands the
    # document to Claude instead (see extract_invoice).
    pdf = _pdf([[(40, [(60, "Delivery challan"), (400, "GSTIN: 29ABJPN9424H1Z7")])]])

    assert extract_invoice_from_text(pdf, OUR_GSTIN) is None


@pytest.mark.parametrize(
    "layout",
    [
        KRAFT_LAYOUT,
        SHAH_LAYOUT,
        HELLO_PEN_LAYOUT,
        TALLY_LAYOUT,
        MUTHA_LAYOUT,
        MUTHA_PREFIX_LAYOUT,
        NEXGEN_LAYOUT,
        DMS_LAYOUT,
    ],
)
def test_every_line_item_carries_a_usable_quantity_and_rate(layout):
    extracted = extract_invoice_from_text(_pdf(layout), OUR_GSTIN)

    assert extracted is not None
    for item in extracted.line_items:
        assert item.quantity > 0
        assert item.rate > 0
        assert item.description

# ---------------------------------------------------------------------------
# The invoice's own printed grand total
# ---------------------------------------------------------------------------
# Exercised against line text rather than a rendered fixture: the grand total
# of a Tally invoice is identified by the currency symbol printed beside it,
# and _pdf's base-14 font has no glyph for the rupee sign, so a PDF built
# here could never carry the very thing under test. These strings are the
# rows as page_lines actually returns them from the real documents.

# "Total 5 nos <cur> 2,936.00" — the grand total, followed further down the
# page by the HSN-wise tax summary's own "Total", which is a subtotal of the
# taxable value and must not be taken for the invoice's total.
def _tally_total_lines(currency: str) -> list[str]:
    return [
        "3 PAPER BOARD 481920 1 nos 65.00 nos 65.00",
        "2,495.00",
        "IGST 440.65",
        "Round Off 0.35",
        f"Total 5 nos {currency} 2,936.00",
        "Amount Chargeable (in words) E. & O.E",
        "INR Two Thousand Nine Hundred Thirty Six Only",
        "HSN/SAC Taxable IGST Total",
        "33072000 2,430.00 18% 437.40 437.40",
        "481920 65.00 5% 3.25 3.25",
        "Total 2,495.00 440.65 440.65",
    ]


@pytest.mark.parametrize(
    "currency",
    [
        # As printed.
        "\u20b9",
        # As the rupee sign comes back out of some of these PDFs: Tally's
        # embedded subset font maps the glyph to U+012B, so the same vendor's
        # invoices extract one way or the other depending on the build that
        # wrote them. Both have to read, or the cross-check is dead on half
        # of them.
        "\u012b",
    ],
)
def test_reads_the_grand_total_from_a_bare_total_row_with_a_currency_symbol(currency):
    # Without this the cross-check was dead on every Tally invoice:
    # "Amount Chargeable (in words)" is a label with no number beside it, and
    # nothing else on the page says "grand total" or "total amount", so the
    # invoice's own total came back as None and could never disagree with
    # what the line items add up to.
    assert _find_printed_total(_tally_total_lines(currency)) == 2936.00


def test_the_hsn_summary_subtotal_is_not_mistaken_for_the_grand_total():
    # It is the last row matching "total" on the page and holds a plausible
    # figure, so scanning bottom-up for that word alone would take it — which
    # is why the currency symbol, and not the word, is what identifies the
    # grand total row.
    assert _find_printed_total(_tally_total_lines("\u20b9")) != 2495.00


def test_an_explicit_grand_total_label_still_wins():
    # The labelled pass runs first, so an invoice that names its total
    # properly is unaffected by the looser currency-row rule — even with a
    # currency-marked "Total" row sitting further down the page.
    lines = [
        "Total 100.00 35.00 0.00 0.00 3500.00 0.00 0.00 4130.00",
        "Grand Total 4,130.00",
        "Total Value (In Words) : Rs. 4130/-",
    ]

    assert _find_printed_total(lines) == 4130.00


# The two failures a Hello Pen Mart / Winsome e-invoice brings, both of which
# leave the invoice unreadable on its own:
#   - The item table is headed "Invoice No. e-Way Bill No. Dated", so the
#     text after the "Invoice No." label is the NEXT column's label, and the
#     number itself is stacked in the cell below.
#   - No row states a GST %, and the HSN-wise summary at the foot omits the
#     HSN code — so nothing ties the "18%" to the line it taxes except the
#     arithmetic of the summary row itself.
E_WAY_LAYOUT = [
    [
        (14, [(225, "Tax Invoice")]),
        (31, [(34, "WINSOME INDIA INCORPORATION"), (260, "Invoice No."), (330, "e-Way Bill No."), (430, "Dated")]),
        (40, [(34, "1ST FLOOR, 84/2"), (260, "26-27/0861"), (430, "20-Aug-26")]),
        (97, [(34, "GSTIN/UIN: 29AAEFW2352D1Z9")]),
        (253, [(34, "GSTIN/UIN : " + OUR_GSTIN)]),
        (284, [(34, "Sl"), (79, "Description of Goods"), (208, "HSN/SAC"), (261, "Quantity"), (330, "Rate"), (440, "Amount")]),
        (313, [(34, "1"), (44, "Combo Set"), (205, "73269099"), (261, "4 pcs"), (330, "635.00"), (359, "pcs"), (440, "2,540.00")]),
        (347, [(300, "IGST"), (449, "457.20")]),
        (636, [(177, "Total"), (270, "4 pcs"), (400, "ī"), (433, "2,997.00")]),
        # The tax summary, with no HSN code on it at all — only the taxable
        # value, the rate and the tax it works out to.
        (690, [(180, "Taxable"), (300, "IGST"), (420, "Total")]),
        (702, [(180, "2,540.00"), (300, "18%"), (360, "457.20"), (420, "457.20")]),
    ]
]


def test_the_e_way_bill_column_label_is_not_read_as_the_invoice_number():
    # "Invoice No." is followed on its row by the heading of the column beside
    # it, so the text after the label is "e-Way" — which is a well-formed
    # invoice number to anything checking only its shape. Two of these
    # invoices read that way collide with each other on (vendor, invoice no)
    # and the second is refused as a duplicate of the first.
    extracted = extract_invoice_from_text(_pdf(E_WAY_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    assert extracted.invoice_no == "26-27/0861"
    assert extracted.invoice_date.date().isoformat() == "2026-08-20"


def test_falls_back_to_the_rate_the_whole_invoice_is_raised_at():
    # Neither the item row nor the summary ties a GST % to this line: the row
    # prints none, and the summary states 18% against a taxable value rather
    # than against the HSN code. Without the invoice-wide rate the line is
    # unreadable, and an invoice whose every line reads that way comes back
    # as None — which is what sent these to the Claude fallback, or, when
    # only SOME lines read that way, silently dropped the rest and understated
    # the order's total.
    extracted = extract_invoice_from_text(_pdf(E_WAY_LAYOUT), OUR_GSTIN)

    assert extracted is not None
    (item,) = extracted.line_items
    assert item.description == "Combo Set"
    assert item.hsn_code == "73269099"
    assert (item.quantity, item.rate, item.gst_perc) == (4, 635.0, 18.0)


def test_a_mixed_rate_invoice_gets_no_invoice_wide_fallback():
    # The fallback is all-or-nothing on purpose: this invoice taxes one line
    # at 18% and another at 5%, so there is no single rate that could be
    # applied to a line whose own rate couldn't be read. Guessing one would
    # put the wrong tax on a line; returning nothing hands the document to
    # Claude, which is the right outcome.
    #
    # The 5% line here states its rate only against a taxable value, exactly
    # as in E_WAY_LAYOUT — so it is unreadable, and with it the whole invoice.
    mixed = [
        [
            (14, [(225, "Tax Invoice")]),
            (31, [(34, "MUTHA COLLECTIONS"), (260, "Invoice No."), (370, "Dated")]),
            (40, [(260, "MC/26-27/999"), (370, "18-Jun-26")]),
            (97, [(34, "GSTIN/UIN: 29AASPK1333N1Z6")]),
            (253, [(34, "GSTIN/UIN : " + OUR_GSTIN)]),
            (284, [(34, "Sl"), (79, "Description"), (208, "HSN/SAC"), (261, "Quantity"), (330, "Rate"), (440, "Amount")]),
            (313, [(34, "1"), (44, "Notebook"), (205, "48201090"), (261, "2 pcs"), (330, "100.00"), (440, "200.00")]),
            (690, [(180, "Taxable"), (300, "Rate"), (420, "Amount")]),
            (702, [(180, "200.00"), (300, "18%"), (420, "36.00")]),
            (714, [(180, "500.00"), (300, "5%"), (420, "25.00")]),
        ]
    ]

    assert extract_invoice_from_text(_pdf(mixed), OUR_GSTIN) is None


def test_the_hsn_summary_total_is_not_mistaken_for_the_grand_total_beside_a_currency_symbol():
    # DMS print their summary's own total against a rupee sign, so the bare-
    # "Total"-with-a-currency rule matched it — and being the last such row on
    # the page, it won: a bill for Rs. 2,419 came back as a printed total of
    # Rs. 2,050, and every upload was flagged to the admin as not tying out.
    # The row above it opens with an HSN code, which no grand total's does.
    lines = [
        "Total 115 ₹ 2,050.00 ₹ 369.00 ₹ 2,419.00",
        "Two Thousand Four Hundred Nineteen Rupees only Sub Total ₹ 2,419.00",
        "Payment mode Total ₹ 2,419.00",
        "HSN/ SAC Taxable amount Total Tax Amount",
        "39219096 ₹ 1,650.00 18% ₹ 297.00 ₹ 297.00",
        "83089019 ₹ 400.00 18% ₹ 72.00 ₹ 72.00",
        "Total ₹ 2,050.00 ₹ 369.00 ₹ 369.00",
    ]

    assert _find_printed_total(lines) == 2419.00
