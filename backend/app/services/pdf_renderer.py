# Shared Chromium browser lifecycle + HTML->PDF render helper, backing
# quotation_pdf.py's HTML-template pipeline. A single headless browser is
# launched once at app startup (start_browser, wired into app/main.py's
# lifespan) and reused for every render — each render only opens/closes a
# lightweight page against that already-running browser, rather than paying
# Chromium's ~1-2s startup cost on every request.
#
# Chosen over WeasyPrint (which has its own from-scratch CSS engine, backed
# by Pango/Cairo) so that what renders in an actual browser is exactly what
# ends up in the PDF — no separate rendering engine with its own CSS gaps to
# account for, and no native-library install step needed outside Docker
# (`playwright install chromium` works identically on Windows/Mac/Linux).
from __future__ import annotations

from playwright.async_api import Browser, Playwright, async_playwright

_playwright: Playwright | None = None
_browser: Browser | None = None


async def start_browser() -> None:
    global _playwright, _browser
    _playwright = await async_playwright().start()
    _browser = await _playwright.chromium.launch()


async def stop_browser() -> None:
    global _playwright, _browser
    if _browser is not None:
        await _browser.close()
        _browser = None
    if _playwright is not None:
        await _playwright.stop()
        _playwright = None


_DEFAULT_MARGIN = {"top": "16mm", "right": "16mm", "bottom": "18mm", "left": "16mm"}


async def render_html_to_pdf(
    html: str,
    *,
    footer_template: str | None = None,
    margin: dict[str, str] | None = None,
    layout_width_mm: float | None = None,
) -> bytes:
    if _browser is None:
        raise RuntimeError("PDF renderer browser is not started — did app startup call start_browser()?")

    page = await _browser.new_page()
    try:
        if layout_width_mm is not None:
            # Templates that measure their own layout (invoice.html sizes its
            # grid to the remaining page height) need the on-screen box they
            # measure to match the one Chromium paginates, so lay the document
            # out at the printable width rather than the default viewport's.
            await page.set_viewport_size(
                {"width": round(layout_width_mm * 96 / 25.4), "height": 1123}
            )
        # No external resources to wait on — quotation_pdf.py bakes the logo
        # and product photos in as base64 data URIs and only uses system
        # fonts, so "load" is reached deterministically without a network
        # round trip.
        await page.set_content(html, wait_until="load")
        return await page.pdf(
            format="A4",
            # The page box comes entirely from these margins (not the
            # template's CSS — Chromium's print-to-PDF only reads CSS @page
            # rules when prefer_css_page_size is set, which then fights with
            # margin/displayHeaderFooter in ways that are finicky to get
            # right). Bottom is taller than the others to leave room for the
            # footer_template's page-number line. Callers whose layout needs
            # more of the sheet (invoice_pdf.py's full-width ruled grid) pass
            # their own margin.
            margin=margin or _DEFAULT_MARGIN,
            print_background=True,  # Chromium omits background colors/images by default when printing
            display_header_footer=footer_template is not None,
            header_template="<div></div>",
            footer_template=footer_template or "",
        )
    finally:
        await page.close()
