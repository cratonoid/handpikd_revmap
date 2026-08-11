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
