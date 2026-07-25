# One-off script: inserts a single test user (bcrypt-hashed password) so
# /auth/login can be verified end-to-end. Safe to delete afterward via
# Compass or another script.
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.db import close_mongo_connection, connect_to_mongo
from app.core.security import hash_password
from app.models import User, UserRole

TEST_MAIL = "test@handpikd.com"
TEST_PASSWORD = "Test1234!"


async def main() -> None:
    await connect_to_mongo()

    existing = await User.find_one(User.mail == TEST_MAIL)
    if existing is not None:
        print(f"already exists: id={existing.id} mail={existing.mail}")
    else:
        user = User(id=1, mail=TEST_MAIL, password=hash_password(TEST_PASSWORD), role=UserRole.admin)
        await user.insert()
        print(f"created: id=1 mail={TEST_MAIL} password={TEST_PASSWORD}")

    await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())
