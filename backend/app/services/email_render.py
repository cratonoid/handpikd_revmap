# Turns a composed email (subject + formatted body, placeholders and all)
# into what one recipient actually receives. Pure, so it's unit tested
# without SMTP or Mongo (tests/test_email_render.py).
#
# Placeholders are {{field}}, and each audience has its own fields — a
# client row has no contact person, so {{contact_person}} in a client
# template is an error at save time rather than a blank in someone's inbox.
# The frontend mirrors this list in lib/emails.ts (PLACEHOLDER_FIELDS).
import html
import re
from dataclasses import dataclass
from html.parser import HTMLParser

from app.models.email_template import EmailAudience

PLACEHOLDER_FIELDS: dict[EmailAudience, tuple[str, ...]] = {
    EmailAudience.lead: ("name", "contact_person"),
    EmailAudience.client: ("name",),
}

_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_]+)\s*\}\}")


def unknown_placeholders(audience: EmailAudience, *texts: str) -> list[str]:
    """Placeholders used in `texts` that `audience` has no value for, in order of first use."""
    allowed = set(PLACEHOLDER_FIELDS[audience])
    unknown: list[str] = []
    for text in texts:
        for match in _PLACEHOLDER.finditer(text):
            field = match.group(1)
            if field not in allowed and field not in unknown:
                unknown.append(field)
    return unknown


def placeholder_values(name: str, contact_person: str | None) -> dict[str, str]:
    # A lead with no contact person on file still gets a sensible greeting
    # ("Hi Acme Traders") rather than "Hi ," — the company name is the
    # closest thing to a person we have.
    return {"name": name, "contact_person": contact_person or name}


def fill_subject(subject: str, values: dict[str, str]) -> str:
    filled = _PLACEHOLDER.sub(lambda match: values.get(match.group(1), match.group(0)), subject)
    # A header can't span lines; a pasted newline would otherwise either be
    # rejected by the mail library or split the header.
    return " ".join(filled.split())


def fill_body(body_html: str, values: dict[str, str]) -> str:
    # Values are escaped: a company called "Smith & Sons <Kota>" must read
    # as text, not markup.
    return _PLACEHOLDER.sub(lambda match: html.escape(values.get(match.group(1), match.group(0))), body_html)


@dataclass
class InlineLogo:
    # Content-ID of the image part embedded in the same message (see
    # build_message in services/email_sender.py), and the size to show it
    # at in CSS pixels.
    cid: str
    width: int
    height: int


# The logo is fitted inside this box, keeping its shape.
LOGO_MAX_WIDTH = 180
LOGO_MAX_HEIGHT = 96


def fit_logo(width: int, height: int) -> tuple[int, int]:
    scale = min(LOGO_MAX_WIDTH / width, LOGO_MAX_HEIGHT / height)
    return max(1, round(width * scale)), max(1, round(height * scale))


def build_html_document(body_html: str, signature_html: str = "", logo: InlineLogo | None = None) -> str:
    """Wraps the editor's fragment in a full, inline-styled HTML email.

    Inline styles only: most mail clients drop <style> blocks and every
    external stylesheet. `logo` is the signature logo embedded in the same
    message; None leaves it out.
    """
    signature = f'<div style="margin-top:24px;">{signature_html}</div>' if signature_html.strip() else ""
    if logo is not None:
        # width and height as attributes as well as styles: Outlook ignores
        # the CSS and would otherwise show the image at full size.
        signature += (
            '<div style="margin-top:16px;">'
            f'<img src="cid:{html.escape(logo.cid)}" alt="Handpikd" width="{logo.width}" height="{logo.height}" '
            f'style="display:block;width:{logo.width}px;height:{logo.height}px;border:0;">'
            "</div>"
        )
    return (
        "<!DOCTYPE html>"
        '<html><head><meta charset="utf-8"></head>'
        '<body style="margin:0;padding:0;">'
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222222;">'
        f"{body_html}{signature}"
        "</div></body></html>"
    )


class _TextExtractor(HTMLParser):
    _BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "ul", "ol", "table", "tr", "blockquote"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._links: list[str | None] = []
        self._list_stack: list[list[int]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "br":
            self.parts.append("\n")
        elif tag in self._BLOCK_TAGS:
            self.parts.append("\n\n")
            if tag in ("ul", "ol"):
                # [counter] for ol, [-1] marks a bullet list.
                self._list_stack.append([0] if tag == "ol" else [-1])
        elif tag == "li":
            marker = "- "
            if self._list_stack and self._list_stack[-1][0] >= 0:
                self._list_stack[-1][0] += 1
                marker = f"{self._list_stack[-1][0]}. "
            self.parts.append("\n" + marker)
        elif tag == "a":
            self._links.append(dict(attrs).get("href"))

    def handle_endtag(self, tag: str) -> None:
        if tag in self._BLOCK_TAGS:
            self.parts.append("\n\n")
            if tag in ("ul", "ol") and self._list_stack:
                self._list_stack.pop()
        elif tag == "a" and self._links:
            href = self._links.pop()
            if href and href.startswith(("http://", "https://")):
                self.parts.append(f" ({href})")

    def handle_data(self, data: str) -> None:
        # Source newlines are layout, not content, in HTML.
        self.parts.append(re.sub(r"\s+", " ", data))


def html_to_text(body_html: str) -> str:
    """Plain-text alternative sent alongside the HTML part.

    Some clients show only this, and spam filters look askance at an
    HTML-only message.
    """
    extractor = _TextExtractor()
    extractor.feed(body_html)
    extractor.close()
    text = "".join(extractor.parts)
    lines = [line.strip() for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
