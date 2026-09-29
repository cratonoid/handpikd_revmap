# Schema for the #email_settings collection. Single document (_id=1) holding
# the Emails module's own settings — for now just the signature appended to
# every email sent from the app (routes/emails.py).
from beanie import Document


class EmailSettings(Document):
    id: int
    signature_html: str = ""

    class Settings:
        name = "email_settings"
