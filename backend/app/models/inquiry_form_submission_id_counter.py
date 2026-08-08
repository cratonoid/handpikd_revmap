# Schema for the #inquiry_form_submission_id_counter collection. Single
# document (_id=1) that tracks the next auto-generated InquiryFormSubmission.id.
from beanie import Document


class InquiryFormSubmissionIdCounter(Document):
    id: int
    next_inquiry_form_submission_id: int

    class Settings:
        name = "inquiry_form_submission_id_counter"
