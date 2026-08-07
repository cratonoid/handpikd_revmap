# Page & API Architecture

Concrete inventory of frontend pages and backend API endpoints as they exist today. Update this file whenever a page or route is added, renamed, or removed.

## Frontend pages (`frontend/src/app/`)

Next.js App Router: each row is a folder under `src/app/` with a `page.tsx`.

| Route | File | Description |
|---|---|---|
| `/` | `src/app/page.tsx` | Home page (default scaffold content) |

No other routes exist yet. To add a page, create `src/app/<route>/page.tsx`; nested folders become nested URL segments.

## Backend API (`backend/app/api/`)

All routes are mounted under the API prefix configured in `Settings.api_v1_prefix` (`/api/v1`), aggregated in `api/router.py`.

Base URL (local dev): `http://localhost:8000/api/v1`

| Method | Path | Router file | Description |
|---|---|---|---|
| GET | `/api/v1/test/` | `api/routes/test.py` | Health check — confirms the API is up |
| GET | `/api/v1/test/ping` | `api/routes/test.py` | Simple ping/pong liveness check |
| GET | `/api/v1/test/db-ping` | `api/routes/test.py` | Pings MongoDB via the Motor client to confirm DB connectivity |

Outside the versioned prefix:

| Method | Path | File | Description |
|---|---|---|---|
| GET | `/` | `app/main.py` | Root endpoint, returns app name + running status |
| — | `/docs` | (FastAPI auto-generated) | Interactive Swagger UI |
| — | `/redoc` | (FastAPI auto-generated) | ReDoc API reference |

### Adding a new API route

1. Create a module under `backend/app/api/routes/` (e.g. `users.py`) with an `APIRouter`.
2. Register it in `backend/app/api/router.py` via `api_router.include_router(...)`.
3. Define request/response shapes in `app/schemas/`, business logic in `app/services/`, and data access via `app/core/db.py::get_db()`.
4. Add a row to the table above.

### Adding a new frontend page

1. Create `frontend/src/app/<route>/page.tsx`.
2. If the page needs backend data, call the API under `/api/v1/...` (base URL should come from an env var once one is introduced, rather than being hardcoded).
3. Add a row to the pages table above.

## Related documents

- [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) — how frontend, backend, and DB relate
- [APPLICATION_ARCHITECTURE.md](APPLICATION_ARCHITECTURE.md) — internal code structure/conventions
