# Application Architecture

Internal structure and conventions of each codebase. See [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) for how the two apps relate to each other and the database.

## Backend (`backend/`)

FastAPI app organized in layers, following a fairly standard FastAPI project shape:

```
backend/
  app/
    main.py              # App entrypoint: creates FastAPI(), CORS, lifespan (Mongo connect/close)
    api/
      router.py          # Aggregates all route modules into one api_router
      routes/
        test.py          # Sample/health routes (ping, db-ping)
    core/
      config.py          # Settings (pydantic-settings), loaded from .env
      db.py               # Motor client lifecycle: connect_to_mongo / close_mongo_connection / get_db
    models/               # DB-layer models (currently empty, reserved)
    schemas/              # Pydantic request/response schemas (currently empty, reserved)
    services/             # Business logic layer (currently empty, reserved)
  tests/
    test_main.py
  requirements.txt
  .env                    # gitignored: DEBUG, MONGODB_URI, MONGODB_DB_NAME
```

### Layering convention

- **routes** (`api/routes/*.py`) — HTTP concerns only: parse request, call a service, return a schema.
- **schemas** (`schemas/`) — Pydantic models that define request/response shapes at the API boundary.
- **models** (`models/`) — data-layer representations of MongoDB documents.
- **services** (`services/`) — business logic that routes call into; keeps routes thin and logic testable.
- **core** (`core/`) — cross-cutting concerns: settings, DB connection lifecycle.

As routes are added, they get their own module under `api/routes/` and are registered in `api/router.py`.

### Database access

MongoDB is connected once at process startup via FastAPI's `lifespan` context manager (`app/main.py` → `app/core/db.py`), using an async Motor client. Handlers fetch the database with `get_db()` rather than opening new connections per-request.

## Frontend (`frontend/`)

Next.js 16 App Router project (TypeScript, Tailwind CSS 4):

```
frontend/
  src/
    app/
      layout.tsx          # Root layout
      page.tsx             # Home page ("/")
      globals.css          # Global styles (Tailwind)
  public/                  # Static assets
  next.config.ts
  tsconfig.json
  package.json
  .env                     # gitignored: frontend-facing config
```

### Conventions

- Routing follows the Next.js **App Router** convention: each route is a folder under `src/app/` containing a `page.tsx`; shared UI (nav, footers) goes in `layout.tsx` files at the appropriate level.
- As the app grows, shared UI belongs in `src/components/`, data-fetching/API-client helpers in `src/lib/`, and types in `src/types/` — none of these exist yet since the app is still at scaffold stage.
- Note: `frontend/AGENTS.md` flags that this Next.js version has breaking changes relative to older conventions — check `node_modules/next/dist/docs/` before assuming standard Next.js behavior.

## Cross-cutting: environment config

Both apps read configuration from their own `.env` file rather than sharing one, since they're deployed and scaled independently. Backend settings are centralized in `app/core/config.py::Settings`; add new backend env vars there rather than reading `os.environ` directly in route/service code.

## Related documents

- [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) — how frontend, backend, and DB relate
- [PAGE_API_ARCHITECTURE.md](PAGE_API_ARCHITECTURE.md) — concrete pages and API endpoints
