# One-off script: PriceListDetails.pdf_path was renamed to file_path when
# price lists started accepting Excel workbooks as well as PDFs (see
# backend/app/models/price_list_details.py). The stored key itself doesn't
# change — PDF keys already end in .pdf, which is how the type is read — so
# this is a plain field rename. Safe to re-run: only matches docs that still
# have a pdf_path field.
# Run with: venv/Scripts/python.exe scripts/migrate_price_list_pdf_path_to_file_path.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    collection = db["price_list_details"]

    result = await collection.update_many(
        {"pdf_path": {"$exists": True}},
        {"$rename": {"pdf_path": "file_path"}},
    )
    print(f"renamed pdf_path -> file_path on {result.modified_count} price_list_details doc(s)")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
