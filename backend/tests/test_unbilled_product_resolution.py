# Unit tests for how an unbilled purchase line settles on a product
# (_resolve_existing_products in app/api/routes/unbilled_orders.py): any live
# product can be picked or named, catalogue ones included, and a name is only
# acted on when it points at exactly one product.
#
# ProductDetails is stubbed rather than queried: building a real Beanie query
# expression needs init_beanie against a live Mongo, which these tests
# deliberately don't have (same approach as
# test_purchase_order_duplicate_guard.py).
import asyncio

import pytest
from fastapi import HTTPException

from app.api.routes import unbilled_orders


class _Field:
    # Stands in for a Beanie ExpressionField so `Model.field == value` builds
    # something inert instead of raising.
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, other: object) -> tuple:  # type: ignore[override]
        return ("eq", self.name, other)


class _Product:
    def __init__(self, product_id: int, name: str, is_unbilled: bool = False, is_deleted: bool = False) -> None:
        self.id = product_id
        self.product_name = name
        self.is_unbilled = is_unbilled
        self.is_deleted = is_deleted


class _StubProducts:
    id = _Field("id")
    is_deleted = _Field("is_deleted")

    rows: list[_Product] = []

    @classmethod
    def find(cls, *_args):
        return cls

    @classmethod
    async def to_list(cls):
        return cls.rows


@pytest.fixture
def products(monkeypatch):
    monkeypatch.setattr(unbilled_orders, "ProductDetails", _StubProducts)
    monkeypatch.setattr(unbilled_orders, "In", lambda *_args: None)
    _StubProducts.rows = [
        _Product(1, "Jute Pouch"),
        _Product(2, "Tea Tin", is_unbilled=True),
        _Product(3, "Candle"),
        _Product(4, "candle "),
    ]
    return _StubProducts


def _resolve(product_ids, product_names, reject_deleted=True):
    return asyncio.run(unbilled_orders._resolve_existing_products(product_ids, product_names, reject_deleted))


def test_a_picked_catalogue_product_is_accepted(products):
    assert _resolve([1], ["Jute Pouch"]) == [1]


def test_a_typed_name_finds_a_catalogue_product(products):
    assert _resolve([None], ["  jute   pouch "]) == [1]


def test_a_typed_name_finds_an_unbilled_product(products):
    assert _resolve([None], ["tea tin"]) == [2]


def test_an_unknown_name_is_left_to_be_created(products):
    assert _resolve([None], ["Brand New Thing"]) == [None]


def test_a_name_several_products_share_is_refused_rather_than_guessed(products):
    with pytest.raises(HTTPException) as error:
        _resolve([None], ["Candle"])

    assert error.value.status_code == 409


def test_picking_a_product_that_shares_its_name_still_works(products):
    assert _resolve([3], ["Candle"]) == [3]


def test_a_deleted_product_cant_be_picked_on_a_new_order(products):
    products.rows.append(_Product(5, "Old Stock", is_deleted=True))

    with pytest.raises(HTTPException) as error:
        _resolve([5], ["Old Stock"])

    assert error.value.status_code == 409
