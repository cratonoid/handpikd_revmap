# One-off script: inserts an admin user with an auto-incremented id.
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.db import close_mongo_connection, connect_to_mongo
from app.core.security import hash_password
from app.models import User, UserRole

ADMIN_MAIL = "admin@gmail.com"
ADMIN_PASSWORD = "password"


async def main() -> None:
    await connect_to_mongo()

    existing = await User.find_one(User.mail == ADMIN_MAIL)
    if existing is not None:
        print(f"already exists: id={existing.id} mail={existing.mail} role={existing.role}")
    else:
        last_user = await User.find_all().sort(-User.id).first_or_none()
        next_id = (last_user.id + 1) if last_user else 1

        user = User(id=next_id, mail=ADMIN_MAIL, password=hash_password(ADMIN_PASSWORD), role=UserRole.admin)
        await user.insert()
        print(f"created: id={next_id} mail={ADMIN_MAIL} role=admin")

    await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())
