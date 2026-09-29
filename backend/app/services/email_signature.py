# The signature appended to emails sent from the app: its text (edited on
# the Signature tab of /admin/emails) and the logo under it.
#
# Until the signature is first saved there is no EmailSettings row, and the
# default below is used — Handpikd's signature as it reads in Titan — so the
# first email sent from the app already signs off the way the mailbox does.
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from app.models import EmailSettings
from app.services.email_render import InlineLogo, fit_logo

SETTINGS_ID = 1

DEFAULT_SIGNATURE_HTML = (
    "<p>Regards,<br><b>Alvis Abreo</b><br>Founder | Handpikd Corporate Gifts</p>"
    '<p>M: +91 8824773308<br>E: <a href="mailto:info@handpikd.co">info@handpikd.co</a><br>'
    'W: <a href="https://www.handpikd.co">www.handpikd.co</a></p>'
)

# 192px square — twice the size it's shown at, so it stays sharp on
# high-density screens.
_DEFAULT_LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "email_signature_logo.png"
LOGO_CID = "signature-logo@handpikd"


@dataclass
class LogoImage:
    data: bytes
    content_type: str
    width: int
    height: int


@dataclass
class Signature:
    html: str
    logo: LogoImage | None

    def inline_logo(self) -> InlineLogo | None:
        if self.logo is None:
            return None
        width, height = fit_logo(self.logo.width, self.logo.height)
        return InlineLogo(cid=LOGO_CID, width=width, height=height)


def image_size(data: bytes) -> tuple[int, int] | None:
    """(width, height) of an image file's bytes, or None if it isn't one."""
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None:
        return None
    return image.shape[1], image.shape[0]


def default_logo() -> LogoImage:
    data = _DEFAULT_LOGO_PATH.read_bytes()
    width, height = image_size(data) or (192, 192)
    return LogoImage(data=data, content_type="image/png", width=width, height=height)


def logo_for(row: EmailSettings | None, ignore_hidden: bool = False) -> LogoImage | None:
    """The logo an email would carry right now, or None when it's switched off.

    ignore_hidden returns the logo that *would* be used even while it's
    switched off — for showing it on the Signature tab.
    """
    if row is not None and not row.show_logo and not ignore_hidden:
        return None
    if row is not None and row.logo_data and row.logo_width and row.logo_height:
        return LogoImage(
            data=row.logo_data,
            content_type=row.logo_content_type or "image/png",
            width=row.logo_width,
            height=row.logo_height,
        )
    return default_logo()


async def get_settings_row() -> EmailSettings | None:
    return await EmailSettings.get(SETTINGS_ID)


async def get_or_create_settings_row() -> EmailSettings:
    row = await get_settings_row()
    if row is None:
        # Created holding the default text, so saving only the logo doesn't
        # silently blank the signature the admin was looking at.
        row = EmailSettings(id=SETTINGS_ID, signature_html=DEFAULT_SIGNATURE_HTML)
        await row.insert()
    return row


def signature_html_for(row: EmailSettings | None) -> str:
    return DEFAULT_SIGNATURE_HTML if row is None else row.signature_html


async def load_signature() -> Signature:
    row = await get_settings_row()
    return Signature(html=signature_html_for(row), logo=logo_for(row))
