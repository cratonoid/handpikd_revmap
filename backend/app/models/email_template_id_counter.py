# Schema for the #email_template_id_counter collection. Single document (_id=1) that
# tracks the next auto-generated EmailTemplate.id.
from beanie import Document


class EmailTemplateIdCounter(Document):
    id: int
    next_email_template_id: int

    class Settings:
        name = "email_template_id_counter"
