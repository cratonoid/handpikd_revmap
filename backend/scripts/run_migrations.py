# Migration runner: applies the pending one-off data migrations in
# scripts/, in order, and records what it applied in a `schema_migrations`
# ledger collection so a migration is never run twice.
#
# WHY THIS EXISTS
# ---------------
# "MongoDB is schemaless so there's nothing to migrate" is only half true
# here, and the half that's false takes the site down. Beanie validates every
# document against its Pydantic model *on read*, so the moment a model gains
# a required field (or changes a field's type), every pre-existing document
# stops parsing — and because a Beanie `.find(...).to_list()` parses the
# whole batch, one stale document 500s the entire endpoint, not just its own
# row.
#
# That is not hypothetical: CatalogueDetails.category_id -> category_ids
# shipped without its migration ever being run against production, so all 32
# catalogue documents failed validation and both /brand-catalogues (public)
# and /admin/catalogues returned 500 until it was run by hand. The migration
# script had existed, correct and idempotent, the whole time. Nothing ran it.
#
# Two things made that possible, and both are fixed alongside this file:
#   1. There was no deploy step that ran migrations at all —
#      .github/workflows/deploy.yml fired on every push to main and ran just
#      `docker compose up -d --build`, so the model change shipped
#      automatically while its migration waited on someone remembering.
#   2. backend/Dockerfile only did `COPY app ./app`, so scripts/ wasn't even
#      present in the production image; there was no way to run a migration
#      on the VPS short of copying the file in.
#
# RUNNING IT
# ----------
#   Local:      venv/Scripts/python.exe scripts/run_migrations.py --status
#               venv/Scripts/python.exe scripts/run_migrations.py --apply
#   Production: docker compose run --rm backend python scripts/run_migrations.py --apply
#
# `--status` is the default and is read-only, so it is always safe to run.
#
# AUTO VS MANUAL
# --------------
# Every migration registered below is declared as one of two kinds:
#
#   AUTO   — idempotent and shape-only: it matches solely on documents still
#            in the old shape, so re-running it is a no-op. `--apply` runs
#            these. This is the class that caused the outage above, and the
#            class a deploy should handle without a human deciding anything.
#
#   MANUAL — destructive, or a judgement call that must not be automated.
#            `--apply` NEVER runs these; it only reports them. The only
#            current one is drop_legacy_proforma_invoices, which deletes
#            *every* proforma invoice row — correct exactly once (right after
#            the hand-raised-proforma change deployed, before anyone raised a
#            real one) and catastrophic at any point after that, since there
#            is no way to distinguish a legacy row from a real one. A runner
#            that "helpfully" applied everything pending would destroy live
#            invoices the first time it ran on a database adopting this
#            ledger. Hence the split, rather than a plain ordered list.
#
# ADOPTING THE LEDGER ON AN EXISTING DATABASE
# -------------------------------------------
# `--baseline` records every registered migration as applied *without running
# any of them*. Use it once, on a database whose migrations were already run
# by hand, so the ledger reflects reality. Without it, the MANUAL entries sit
# in `--status` as permanently pending, which is exactly the kind of standing
# red flag that teaches people to stop reading the output.
#
# ADDING A MIGRATION
# ------------------
# Write the script as the existing ones are written (match on the old shape
# only, so it is safe to re-run), then append it to MIGRATIONS below. The
# registry is explicit rather than a glob over scripts/*.py on purpose: order
# is meaningful, and scripts/ also holds seed/setup scripts (seed_categories,
# create_admin_user, ...) that must never be swept into a deploy step.
import argparse
import asyncio
import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings

AUTO = "auto"
MANUAL = "manual"

# (module name, kind, what it does) — in the order they must be applied.
MIGRATIONS: list[tuple[str, str, str]] = [
    (
        "migrate_purchase_order_no_to_str",
        AUTO,
        "purchase_orders.purchase_order_no: int -> str",
    ),
    (
        "migrate_invoice_no_counters",
        AUTO,
        "seed the split standard/proforma invoice_no counters",
    ),
    (
        "migrate_invoice_sales_id_to_sales_ids",
        AUTO,
        "invoice_details.sales_id -> sales_ids (list)",
    ),
    (
        "migrate_catalogue_category_id_to_category_ids",
        AUTO,
        "catalogue_details.category_id -> category_ids (list)",
    ),
    (
        "drop_legacy_proforma_invoices",
        MANUAL,
        "DESTRUCTIVE: deletes every proforma invoice_details row",
    ),
]

LEDGER_COLLECTION = "schema_migrations"


def _load_migration(name: str):
    """Import a sibling migration script by file path.

    By path rather than a plain `import <name>` so the runner works the same
    whether it's invoked as `python scripts/run_migrations.py` from backend/
    or by absolute path from anywhere else — neither should depend on what
    the current working directory happens to be.
    """
    path = SCRIPTS_DIR / f"{name}.py"
    if not path.is_file():
        raise FileNotFoundError(f"migration script not found: {path}")

    spec = importlib.util.spec_from_file_location(f"_migration_{name}", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not load migration script: {path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _applied_names(db) -> set[str]:
    return {doc["_id"] async for doc in db[LEDGER_COLLECTION].find({}, {"_id": 1})}


async def _record(db, name: str, kind: str, *, baselined: bool) -> None:
    await db[LEDGER_COLLECTION].update_one(
        {"_id": name},
        {
            "$set": {
                "applied_at": datetime.now(timezone.utc),
                "kind": kind,
                # Distinguishes "this runner executed it" from "it was marked
                # applied by --baseline because it had already been run by
                # hand" — worth keeping when auditing what actually touched
                # the data.
                "baselined": baselined,
            }
        },
        upsert=True,
    )


async def show_status(db) -> None:
    applied = await _applied_names(db)

    print(f"database: {settings.mongodb_db_name}")
    print(f"ledger:   {LEDGER_COLLECTION} ({len(applied)} recorded)")
    print()

    pending_auto = 0
    pending_manual = 0
    for name, kind, description in MIGRATIONS:
        if name in applied:
            state = "applied"
        elif kind == MANUAL:
            state = "PENDING (manual)"
            pending_manual += 1
        else:
            state = "PENDING"
            pending_auto += 1
        print(f"  [{state:>16}] {name}")
        print(f"  {'':>18}  {description}")

    print()
    if pending_auto:
        print(f"{pending_auto} automatic migration(s) pending - run with --apply")
    else:
        print("no automatic migrations pending")
    if pending_manual:
        print(
            f"{pending_manual} manual migration(s) not recorded - read the script's own "
            "header and run it by hand only if it genuinely still applies, "
            "or use --baseline if it was already run"
        )


async def apply_pending(db) -> None:
    applied = await _applied_names(db)
    ran = 0

    for name, kind, description in MIGRATIONS:
        if name in applied:
            print(f"skip    {name} (already applied)")
            continue

        if kind == MANUAL:
            print(f"SKIP    {name} - manual only, not run automatically")
            print(f"        {description}")
            continue

        print(f"running {name} ...")
        module = _load_migration(name)
        # Each migration opens and closes its own Mongo client, so they're
        # awaited as-is rather than being handed this runner's connection —
        # keeping them runnable standalone, which is how they're documented
        # in their own headers.
        await module.main()
        await _record(db, name, kind, baselined=False)
        ran += 1
        print(f"done    {name}")

    print()
    print(f"applied {ran} migration(s)" if ran else "nothing to apply")


async def baseline(db) -> None:
    applied = await _applied_names(db)
    newly = [entry for entry in MIGRATIONS if entry[0] not in applied]

    if not newly:
        print("ledger already covers every registered migration — nothing to baseline")
        return

    print("recording as applied WITHOUT running (baseline):")
    for name, kind, _ in newly:
        await _record(db, name, kind, baselined=True)
        print(f"  {name}")

    print()
    print(f"baselined {len(newly)} migration(s)")


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply pending MongoDB data migrations (see this file's header).",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--status",
        action="store_true",
        help="show applied/pending migrations and exit (default, read-only)",
    )
    group.add_argument(
        "--apply",
        action="store_true",
        help="run every pending automatic migration and record it in the ledger",
    )
    group.add_argument(
        "--baseline",
        action="store_true",
        help="mark all registered migrations as applied WITHOUT running them "
        "(for a database whose migrations were already run by hand)",
    )
    args = parser.parse_args()

    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]

    try:
        if args.apply:
            await apply_pending(db)
        elif args.baseline:
            await baseline(db)
        else:
            await show_status(db)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
