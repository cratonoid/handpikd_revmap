# Backend (FastAPI)

## Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --reload
```

API available at http://localhost:8000, interactive docs at http://localhost:8000/docs.

**On Windows, drop `--reload`.** Uvicorn's reload supervisor forces
`asyncio.SelectorEventLoop` there (`use_subprocess=True` in
`uvicorn/loops/asyncio.py`, deliberately — the reload/multi-worker
supervisor doesn't get `ProactorEventLoop`), which cannot spawn
subprocesses. `services/pdf_renderer.py` launches headless Chromium via
Playwright as a subprocess on app startup, so the app crashes immediately
with `NotImplementedError` under `--reload` on Windows. Run
`uvicorn app.main:app` (no `--reload`) instead, and restart manually after
backend changes. This only affects Windows dev machines — Linux (prod, see
docker-compose.yml) doesn't have this split and `--reload` is fine there.

## Reading vendor invoice PDFs

Uploading a vendor's invoice on the Purchase orders tab reads it in two
stages (`app/services/invoice_extraction.py`): a deterministic pass over the
PDF's text layer first, then Claude for any layout that pass can't decode.
The second stage needs a key in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
# optional — defaults to claude-opus-5
INVOICE_EXTRACTION_MODEL=claude-opus-5
```

Leaving the key unset is a supported configuration: invoices the
deterministic pass can read still upload, and the rest are refused with a
message telling the admin to enter the purchase order by hand.

## Sending email (Titan)

The Emails module (`app/api/routes/emails.py`) sends through the company's
Titan mailbox over SMTP and files a copy of each message into its Sent
folder over IMAP. Add the mailbox login to `.env` — locally and in the
VPS's `backend/.env`, which deploys never overwrite — then restart the
backend:

```
SMTP_USER=info@handpikd.co
SMTP_PASSWORD=...
# optional — these are the defaults
SMTP_FROM_NAME=Handpikd
EMAIL_BULK_LIMIT=50
EMAIL_SEND_INTERVAL_SECONDS=2
```

GoDaddy's hosts and ports (where handpikd.co's Titan mailbox actually
lives) are built in (`app/core/config.py`). With the login
unset, the compose screen says email isn't set up rather than failing per
recipient. "Test connection" on `/admin/emails` checks both logins without
sending anything.

Emails that Titan accepts but the recipient's server later returns are
caught by `app/services/email_bounces.py`: every 10 minutes (started from
`app/main.py`'s lifespan) it reads the inbox's bounce reports read-only,
matches each to the send by Message-ID, and marks that recipient — and the
contact's address — as bounced.

## Test

```bash
pytest
```

## Structure

```
backend/
  app/
    main.py            # FastAPI app entrypoint
    api/
      router.py         # aggregates route modules
      routes/
        test.py          # sample test endpoints
    core/
      config.py          # app settings
    models/               # DB models
    schemas/              # pydantic request/response schemas
    services/             # business logic
  tests/
    test_main.py
  requirements.txt
```
