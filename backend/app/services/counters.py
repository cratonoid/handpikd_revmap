# Atomic auto-increment helper backed by dedicated single-document counter
# collections (same pattern as invoice_no_counter_master / order_no_counter_master).
from typing import Type

from beanie import Document
from pymongo import ReturnDocument

_COUNTER_DOC_ID = 1


async def get_next_id(counter_model: Type[Document], field_name: str, target_model: Type[Document]) -> int:
    collection = counter_model.get_pymongo_collection()
    updated = await collection.find_one_and_update(
        {"_id": _COUNTER_DOC_ID},
        {"$inc": {field_name: 1}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is not None:
        return updated[field_name]

    # First-ever call for this counter: seed it from the current max id in
    # the target collection so we never collide with rows inserted manually
    # or by scripts before this counter existed.
    last = await target_model.find_all().sort(-target_model.id).limit(1).to_list()
    next_id = (last[0].id + 1) if last else 1
    await collection.insert_one({"_id": _COUNTER_DOC_ID, field_name: next_id})
    return next_id


async def get_next_scoped_id(counter_model: Type[Document], field_name: str, scope_id: int) -> int:
    """Next number from a counter that runs an independent series per scope key.

    The scope key is the counter document's _id (the financial year's start
    year, for the standard sales invoice series), so each scope gets its own
    sequence starting at 1 the first time it is used — which is the point of a
    per-year series. There is no auto-seed from a target collection the way
    get_next_id does it: a scope whose numbers predate this counter is seeded
    by a migration, since only the migration knows how to pick the rows
    belonging to that scope.
    """
    collection = counter_model.get_pymongo_collection()
    updated = await collection.find_one_and_update(
        {"_id": scope_id},
        {"$inc": {field_name: 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return updated[field_name]
