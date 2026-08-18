# Unit tests for the pure part of the products module in
# app/api/routes/products.py. Same approach as test_accounts.py: no Mongo
# connection or TestClient, so only the logic that doesn't touch the database
# is covered here, with the endpoints themselves exercised by the frontend's
# round-trip.
#
# What matters is the message a refused permanent delete carries back. It's
# the only explanation the admin gets for why the product won't go, so it has
# to name every kind of document holding it and read as a sentence — a
# miscounted or mis-pluralised line here sends someone looking through the
# wrong module for a reference that isn't there.
from app.api.routes.products import _phrase_reference_counts


def test_singular_reference_is_not_pluralised():
    assert _phrase_reference_counts([(1, "sales order")]) == ["1 sales order"]


def test_multiple_references_are_pluralised():
    assert _phrase_reference_counts([(3, "quotation")]) == ["3 quotations"]


def test_unreferenced_collections_are_left_out():
    # A product on two purchase orders and nothing else shouldn't produce
    # "0 sales orders, 0 quotations, 2 purchase orders".
    counts = [(0, "sales order"), (0, "quotation"), (0, "proforma invoice"), (2, "purchase order")]
    assert _phrase_reference_counts(counts) == ["2 purchase orders"]


def test_every_referencing_document_type_is_named():
    counts = [(1, "sales order"), (2, "quotation"), (1, "proforma invoice"), (4, "purchase order")]
    assert _phrase_reference_counts(counts) == [
        "1 sales order",
        "2 quotations",
        "1 proforma invoice",
        "4 purchase orders",
    ]


def test_no_references_phrase_is_empty():
    # An empty list is what delete_product_details reads as "nothing holds
    # this product, go ahead and erase it".
    assert _phrase_reference_counts([(0, "sales order"), (0, "quotation")]) == []
