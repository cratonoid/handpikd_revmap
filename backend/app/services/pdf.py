# Renders each page of a PDF into a raster image — used by the catalogues
# module to turn an admin-uploaded catalogue PDF into individual page images
# (see app/api/routes/catalogues.py's upload_catalogue_pdf). PyMuPDF is used
# rather than a poppler-backed library (e.g. pdf2image) because it ships as a
# self-contained wheel with no system binary to install in the deploy image.
import pymupdf as fitz

# 150 DPI keeps page images legible (a typical A4 page renders ~1240x1754px)
# without producing oversized files — plenty for a catalogue viewed on screen.
_RENDER_DPI = 150


def pdf_to_images(pdf_bytes: bytes) -> list[bytes]:
    images: list[bytes] = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
        zoom = _RENDER_DPI / 72
        matrix = fitz.Matrix(zoom, zoom)
        for page in document:
            pixmap = page.get_pixmap(matrix=matrix)
            images.append(pixmap.tobytes("png"))
    return images
