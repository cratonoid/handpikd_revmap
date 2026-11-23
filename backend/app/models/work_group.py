# Schema for the #work_group collection: a team on the Work board
# (routes/work_board.py), e.g. "Marketing". Every story belongs to one group;
# only its members see its stories and can be assigned to them. The
# Administrator manages groups and sees every one.
from datetime import datetime

from beanie import Document


class WorkGroup(Document):
    id: int
    name: str
    member_user_ids: list[int] = []  # FK -> User.id (team accounts)
    created_at: datetime  # naive UTC
    updated_at: datetime  # naive UTC

    class Settings:
        name = "work_group"
