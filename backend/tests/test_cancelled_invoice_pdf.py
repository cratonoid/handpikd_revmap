# Unit tests for the CANCELLED stamp on invoice PDFs: on a cancelled invoice,
# and never on a live one or on any other document these generators print.
#
# The templates really are rendered here; only the Chromium step is stubbed,
# since the HTML it would be handed is what decides whether the stamp is there.
import asyncio
from datetime import datetime

import pytest

from app.services import invoice_pdf, proforma_invoice_pdf

_DATE = datetime(2026, 11, 7)


@pytest.fixture(autouse=True)
def html_of_last_render(monkeypatch):
    rendered: dict[str, str] = {}

    async def _render(html, **_kwargs):
        rendered["html"] = html
        return b"%PDF"

    monkeypatch.setattr(invoice_pdf, "render_html_to_pdf", _render)
    monkeypatch.setattr(proforma_invoice_pdf, "render_html_to_pdf", _render)
    return rendered


def _render_standard(**kwargs):
    asyncio.run(
        invoice_pdf.generate_invoice_pdf(
            invoice_no="H/26-27/12",
            invoice_date=_DATE,
            due_date=_DATE,
            transport="",
            line_items=[],
            total_amount_before_tax=100.0,
            total_tax_amount=18.0,
            total_amount_after_tax=118.0,
            customer_name="A Client",
            customer_address="An address",
            customer_phone="",
            customer_gstin="",
            personal={},
            **kwargs,
        )
    )


def _render_proforma(**kwargs):
    asyncio.run(
        proforma_invoice_pdf.generate_proforma_invoice_pdf(
            invoice_no_display="PI-0012",
            invoice_date=_DATE,
            due_date=_DATE,
            line_items=[],
            total_amount_after_tax=118.0,
            description="",
            customer_name="A Client",
            customer_address="An address",
            customer_phone="",
            customer_gstin="",
            personal={},
            **kwargs,
        )
    )


@pytest.mark.parametrize("render", [_render_standard, _render_proforma])
def test_a_cancelled_invoice_is_stamped(render, html_of_last_render):
    render(cancelled=True)

    assert "CANCELLED" in html_of_last_render["html"]


@pytest.mark.parametrize("render", [_render_standard, _render_proforma])
def test_a_live_invoice_is_not_stamped(render, html_of_last_render):
    render()

    assert "CANCELLED" not in html_of_last_render["html"]
