# Unit tests for the Emails module's pure parts: placeholder checking and
# filling (app/services/email_render.py), the plain-text alternative, the
# IMAP Sent-folder lookup and message building (app/services/email_sender.py).
# No SMTP, IMAP or Mongo needed.
from app.models.email_template import EmailAudience
from app.services.email_render import (
    build_html_document,
    fit_logo,
    fill_body,
    fill_subject,
    html_to_text,
    placeholder_values,
    unknown_placeholders,
)
from app.services.email_sender import OutgoingAttachment, build_message, sent_folder_from_list_line


def test_contact_person_is_lead_only():
    assert unknown_placeholders(EmailAudience.lead, "Hi {{contact_person}}", "{{ name }}") == []
    assert unknown_placeholders(EmailAudience.client, "Hi {{contact_person}}", "{{name}}") == ["contact_person"]


def test_unknown_placeholders_listed_once_in_order():
    assert unknown_placeholders(EmailAudience.lead, "{{foo}} {{bar}}", "{{foo}}") == ["foo", "bar"]


def test_contact_person_falls_back_to_name():
    assert placeholder_values("Acme", None) == {"name": "Acme", "contact_person": "Acme"}
    assert placeholder_values("Acme", "Riya")["contact_person"] == "Riya"


def test_body_values_are_escaped_and_subject_is_one_line():
    values = placeholder_values("Smith & Sons <Kota>", None)
    assert fill_body("<p>Hi {{name}}</p>", values) == "<p>Hi Smith &amp; Sons &lt;Kota&gt;</p>"
    assert fill_subject("Hello\n{{name}}", {"name": "Acme"}) == "Hello Acme"


def test_signature_only_added_when_present():
    assert "margin-top:24px" not in build_html_document("<p>x</p>", "  ")
    assert "<b>Alvis</b>" in build_html_document("<p>x</p>", "<b>Alvis</b>")


def test_html_to_text_keeps_structure():
    text = html_to_text(
        '<p>Hi <b>Riya</b>,</p><p>See <a href="https://handpikd.co">our site</a></p>'
        "<ul><li>One</li><li>Two</li></ul><ol><li>A</li><li>B</li></ol>line<br>break"
    )
    assert text == "Hi Riya,\n\nSee our site (https://handpikd.co)\n\n- One\n- Two\n\n1. A\n2. B\n\nline\nbreak"


def test_sent_folder_detection():
    assert sent_folder_from_list_line(r'(\HasNoChildren \Sent) "/" "Sent Items"') == "Sent Items"
    assert sent_folder_from_list_line(r'(\Sent) "." Sent') == "Sent"
    assert sent_folder_from_list_line(r'(\HasNoChildren) "/" "INBOX"') is None
    assert sent_folder_from_list_line(r'(\HasNoChildren \Sentinel) "/" "X"') is None


def test_build_message_has_text_html_and_attachment():
    message = build_message(
        to_name="Riya",
        to_email="riya@example.com",
        subject="Hello",
        html_document=build_html_document("<p>Hi</p>"),
        attachments=[OutgoingAttachment("catalogue.pdf", "application/pdf", b"%PDF-1.4")],
    )
    assert message["To"] == "Riya <riya@example.com>"
    kinds = [part.get_content_type() for part in message.walk()]
    assert "text/plain" in kinds and "text/html" in kinds and "application/pdf" in kinds
    assert [part.get_filename() for part in message.iter_attachments()] == ["catalogue.pdf"]


def test_logo_keeps_its_shape_inside_the_box():
    assert fit_logo(192, 192) == (96, 96)
    assert fit_logo(600, 200) == (180, 60)
    assert fit_logo(100, 400) == (24, 96)
