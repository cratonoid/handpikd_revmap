# Unit tests for the field-cleaning helpers in
# app/api/routes/database_contacts.py (the /admin/database address book).
# Pure, so no Mongo connection is needed.
import pytest
from fastapi import HTTPException

from app.api.routes.database_contacts import _clean_email, _optional, _required


def test_required_strips_and_rejects_blank():
    assert _required("  Acme  ", "name") == "Acme"
    with pytest.raises(HTTPException) as caught:
        _required("   ", "phone number")
    assert caught.value.status_code == 400
    assert caught.value.detail == "phone number is required"


def test_optional_treats_blank_as_missing():
    assert _optional(None) is None
    assert _optional("") is None
    assert _optional("   ") is None
    assert _optional(" Kota ") == "Kota"


def test_email_is_optional():
    assert _clean_email(None) is None
    assert _clean_email("  ") is None
    assert _clean_email(" a@b.co ") == "a@b.co"


@pytest.mark.parametrize("bad", ["not-an-email", "a b@c.co"])
def test_email_rejects_obvious_typos(bad):
    with pytest.raises(HTTPException) as caught:
        _clean_email(bad)
    assert caught.value.status_code == 400
