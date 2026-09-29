# Schema for the #email_settings collection. Single document (_id=1) holding
# the Emails module's own settings: the signature appended to every email
# sent from the app (routes/emails.py), and the logo shown under it.
#
# No row at all means "never set up", and the signature then falls back to
# DEFAULT_SIGNATURE_HTML in routes/emails.py; once saved — even saved empty
# — the row is what's used.
from beanie import Document


class EmailSettings(Document):
    id: int
    signature_html: str = ""
    # The logo is embedded in each email (not linked), so it shows without
    # the recipient having to allow remote images. With no logo_data of its
    # own, the bundled Handpikd logo (app/assets/email_signature_logo.png)
    # is used.
    show_logo: bool = True
    logo_data: bytes | None = None
    logo_content_type: str | None = None
    # logo_data's natural size in pixels, read on upload; the email shows it
    # scaled down to fit (see fit_logo in services/email_render.py).
    logo_width: int | None = None
    logo_height: int | None = None

    class Settings:
        name = "email_settings"
