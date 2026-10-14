# Reads an uploaded Excel price list into plain text cells, so the admin can
# view it in the browser instead of downloading it (see get_price_list_sheets
# in routes/price_lists.py). .xlsx goes through openpyxl, legacy .xls through
# xlrd — neither format is something a browser can display on its own.
#
# What comes back is each visible worksheet as a grid of display strings:
# the values Excel last calculated (formulas are not re-evaluated), with
# numbers, dates and percentages written out the way a reader expects.
# Styling, merged cells, images and charts are not carried over — this is
# for reading prices, and the original file is still a download away.
#
# Bounded on purpose: a sheet stops at MAX_ROWS x MAX_COLS and says so, since
# a stray formatted cell far down a sheet, or a genuinely huge export, would
# otherwise produce a response no browser table can usefully render.
import io
import math
from dataclasses import dataclass, field
from datetime import date, datetime, time

MAX_ROWS = 5000
MAX_COLS = 60


@dataclass
class SheetPreview:
    name: str
    rows: list[list[str]] = field(default_factory=list)
    # True when the sheet had content past MAX_ROWS / MAX_COLS.
    truncated: bool = False


def _format_number(value: float, number_format: str = "") -> str:
    if math.isnan(value) or math.isinf(value):
        return ""
    if "%" in number_format:
        value *= 100
        suffix = "%"
    else:
        suffix = ""
    if float(value).is_integer():
        return f"{int(value)}{suffix}"
    # Up to six decimals, without float noise (0.1 + 0.2) or exponent form.
    return f"{round(value, 6):f}".rstrip("0").rstrip(".") + suffix


def format_cell(value: object, number_format: str = "") -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, datetime):
        if value.time() == time(0, 0):
            return value.strftime("%d/%m/%Y")
        return value.strftime("%d/%m/%Y %H:%M")
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, (int, float)):
        return _format_number(float(value), number_format)
    return str(value).strip()


def _trim(rows: list[list[str]]) -> list[list[str]]:
    """Drops trailing empty rows and trailing empty columns."""
    while rows and not any(rows[-1]):
        rows.pop()
    width = max((max((i + 1 for i, cell in enumerate(row) if cell), default=0) for row in rows), default=0)
    return [row[:width] + [""] * (width - len(row[:width])) for row in rows]


def _read_xlsx(file_bytes: bytes) -> list[SheetPreview]:
    from openpyxl import load_workbook

    # read_only streams rows rather than building the whole workbook in
    # memory; data_only returns each formula's last calculated value.
    workbook = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    try:
        sheets: list[SheetPreview] = []
        for worksheet in workbook.worksheets:
            if worksheet.sheet_state != "visible":
                continue
            preview = SheetPreview(name=worksheet.title)
            for index, row in enumerate(worksheet.iter_rows()):
                cells = [format_cell(cell.value, getattr(cell, "number_format", "") or "") for cell in row]
                if index >= MAX_ROWS:
                    if any(cells):
                        preview.truncated = True
                        break
                    continue
                if any(cells[MAX_COLS:]):
                    preview.truncated = True
                preview.rows.append(cells[:MAX_COLS])
            preview.rows = _trim(preview.rows)
            sheets.append(preview)
        return sheets
    finally:
        workbook.close()


def _read_xls(file_bytes: bytes) -> list[SheetPreview]:
    import xlrd

    book = xlrd.open_workbook(file_contents=file_bytes, on_demand=True)
    try:
        sheets: list[SheetPreview] = []
        for sheet_index in range(book.nsheets):
            sheet = book.sheet_by_index(sheet_index)
            if sheet.visibility != 0:
                continue
            preview = SheetPreview(name=sheet.name, truncated=sheet.nrows > MAX_ROWS or sheet.ncols > MAX_COLS)
            for row_index in range(min(sheet.nrows, MAX_ROWS)):
                cells: list[str] = []
                for col_index in range(min(sheet.ncols, MAX_COLS)):
                    cell = sheet.cell(row_index, col_index)
                    if cell.ctype == xlrd.XL_CELL_DATE:
                        cells.append(format_cell(xlrd.xldate_as_datetime(cell.value, book.datemode)))
                    elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                        cells.append(format_cell(bool(cell.value)))
                    elif cell.ctype == xlrd.XL_CELL_ERROR:
                        cells.append(xlrd.error_text_from_code.get(cell.value, "#ERROR"))
                    else:
                        cells.append(format_cell(cell.value))
                preview.rows.append(cells)
            preview.rows = _trim(preview.rows)
            sheets.append(preview)
            book.unload_sheet(sheet_index)
        return sheets
    finally:
        book.release_resources()


def read_workbook_preview(file_bytes: bytes, file_type: str) -> list[SheetPreview]:
    """Every visible worksheet as text cells. file_type is "xlsx" or "xls"."""
    if file_type == "xlsx":
        return _read_xlsx(file_bytes)
    if file_type == "xls":
        return _read_xls(file_bytes)
    raise ValueError(f"not a workbook type: {file_type}")
