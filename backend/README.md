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
