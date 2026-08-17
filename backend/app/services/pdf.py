# Renders pages of a PDF into raster images — used by the catalogues module to
# turn an admin-uploaded catalogue PDF into individual page images (see
# app/api/routes/catalogues.py). PyMuPDF is used rather than a poppler-backed
# library (e.g. pdf2image) because it ships as a self-contained wheel with no
# system binary to install in the deploy image.
#
# Rendering is deliberately one page per call, off a PDF already on disk,
# rather than a whole document at once in memory: real catalogues run to 100+
# pages and several hundred megabytes of rendered image data, far too much to
# hold in memory or hand back in a single response. The admin UI pulls pages
# one at a time from a staged upload instead — see
# services/catalogue_pdf_staging.py.
from pathlib import Path

import pymupdf as fitz

# 150 DPI keeps page images legible (a typical A4 page renders ~1240x1754px)
# without producing oversized files — plenty for a catalogue viewed on screen.
_RENDER_DPI = 150

# JPEG rather than PNG: catalogue pages are photographic, the one case where
# PNG's lossless encoding is all cost and no benefit. Measured on a real
# catalogue page at this DPI: 3.6MB as PNG vs 335KB as quality-80 JPEG, with
# no difference visible on screen.
_JPEG_QUALITY = 80

# What render_pdf_page returns, for callers that need to label it: the page
# route sets the media type as its response Content-Type, and
# add_catalogue_image uses the extension to name a stored page whose upload
# didn't carry a filename of its own.
PAGE_IMAGE_MEDIA_TYPE = "image/jpeg"
PAGE_IMAGE_EXTENSION = "jpg"


class PageIndexError(IndexError):
    """Raised by render_pdf_page for a page number the document doesn't have.

    Distinguished from a corrupt/unreadable PDF so the route can answer 404
    rather than 400.
    """


def pdf_page_count(pdf_path: Path) -> int:
    with fitz.open(pdf_path) as document:
        return document.page_count


def render_pdf_page(pdf_path: Path, page_index: int) -> bytes:
    """Renders a single 0-indexed page of the PDF at pdf_path to JPEG bytes."""
    with fitz.open(pdf_path) as document:
        if not 0 <= page_index < document.page_count:
            raise PageIndexError(f"page {page_index} is out of range for a {document.page_count}-page document")

        zoom = _RENDER_DPI / 72
        pixmap = document.load_page(page_index).get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        return pixmap.tobytes("jpeg", jpg_quality=_JPEG_QUALITY)
