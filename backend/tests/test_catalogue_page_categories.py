# Unit tests for per-page catalogue categories in app/api/routes/catalogues.py.
# Same approach as test_products.py: only the logic that doesn't touch the
# database. What matters is that each category on the storefront gets exactly
# its own pages, in page order, and that a page can't be filed under a
# category its catalogue isn't in (it would never be reachable).
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.routes.catalogues import _image_paths_in_category, _require_page_categories_within


def _page(path: str, category_ids: list[int]) -> SimpleNamespace:
    return SimpleNamespace(image_path=path, category_ids=category_ids)


PAGES = [
    _page("/media/catalogues/1.jpg", [10]),
    _page("/media/catalogues/2.jpg", [10, 20]),
    _page("/media/catalogues/3.jpg", [20]),
    _page("/media/catalogues/4.jpg", []),
]


def test_each_category_gets_only_its_pages_in_order():
    assert _image_paths_in_category(PAGES, 10) == ["/media/catalogues/1.jpg", "/media/catalogues/2.jpg"]
    assert _image_paths_in_category(PAGES, 20) == ["/media/catalogues/2.jpg", "/media/catalogues/3.jpg"]


def test_category_without_pages_is_empty():
    # get_public_catalogues skips the catalogue under such a category.
    assert _image_paths_in_category(PAGES, 30) == []


def test_page_categories_within_catalogue_pass():
    _require_page_categories_within([10, 20], [10, 20, 30])
    _require_page_categories_within([], [10])


def test_page_category_outside_catalogue_is_refused():
    with pytest.raises(HTTPException) as error:
        _require_page_categories_within([10, 99], [10, 20])
    assert error.value.status_code == 400
