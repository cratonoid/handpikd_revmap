# Schema for the #leads collection — the admin Database page's "Leads" tab.
# Admin-entered only: unlike the marketing site's "Get Started" contact form
# (which posts straight to a Google Sheets webhook, see lib/lead-form.ts),
# rows here are added directly by an admin and never touch that form.
from beanie import Document


class Lead(Document):
    id: int
    name: str
    phone: str
    institute_name: str

    class Settings:
        name = "leads"