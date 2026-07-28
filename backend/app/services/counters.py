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
