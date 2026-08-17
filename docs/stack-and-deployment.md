# Stack & Deployment — How This App Is Built and Shipped

This doc explains four things, grounded in this repo's actual code: why FastAPI, why
Next.js, why nginx sits in front of both, and how Docker gets it all onto the VPS.

---

## 1. Why FastAPI (backend)

The backend (`backend/`) is a FastAPI app (`backend/app/main.py`) using **Beanie**
(an async MongoDB ODM built on Pydantic) and **uvicorn** as the ASGI server.

**What FastAPI gives us that an older Python framework (Flask, Django) wouldn't:**

- **Async-native.** FastAPI runs on ASGI (uvicorn), so `await`ing MongoDB calls
  (Beanie), the Playwright-driven PDF renderer, and outbound HTTP calls doesn't
  block the worker thread. Flask is WSGI/sync by default; Django only got usable
  async support much later and still has sync ORM code (Django ORM) fighting it.
  Here, `lifespan` in `main.py` starts a single shared headless-Chromium instance
  (`start_browser()`) at startup specifically so every request can `await` a PDF
  render against an already-running browser instead of paying a 1-2s launch cost
  per request — that pattern only works cleanly in an async framework.
- **Pydantic models as the single source of truth.** Request/response schemas
  (`backend/app/schemas/`) are Pydantic models. FastAPI uses them to validate
  incoming JSON, serialize responses, and generate OpenAPI docs automatically —
  no separate serializer layer (compare to Django REST Framework's serializers,
  which duplicate the model definition). Beanie documents are *also* Pydantic
  models, so the same validation vocabulary spans the DB layer and the API layer.
- **Free interactive docs.** Because routes are typed, FastAPI auto-generates
  OpenAPI/Swagger UI (`/docs`) with zero extra code — useful for a small team
  where hand-written API docs would go stale.
- **Dependency injection without magic.** `Depends()` handles auth
  (JWT via `pyjwt`), DB sessions, etc., as plain function parameters — easier to
  read and test than Django's middleware/decorator stack for the same job.
- **Lighter than Django for this shape of app.** This is an API-only backend (no
  server-rendered templates, no Django admin needed — the frontend is a separate
  Next.js app). Django's batteries (ORM, admin, templating, forms) are mostly
  unused weight here; FastAPI + Beanie is a closer fit to "typed JSON API over
  MongoDB."

**Trade-off worth knowing:** FastAPI doesn't include Django's built-in admin,
migrations, or auth system — this repo hand-rolls JWT auth (`pyjwt`, `bcrypt`)
and has no schema migrations because MongoDB is schemaless (Beanie documents
just define shape, not a migrated table).

---

## 2. Why Next.js (frontend)

The frontend (`frontend/`) is Next.js 16 with React 19 and the **App Router**
(`frontend/src/app/`), using Turbopack and Tailwind v4.

**What Next.js gives us over plain React (CRA/Vite) or another framework:**

- **File-based routing that matches the product's shape.** Every route in the
  app — `admin/products`, `admin/invoices`, `customer/orders`, `blogs/[slug]`,
  etc. — is just a folder under `src/app/`. No separate router config to keep in
  sync as pages get added, and `blogs/[slug]/page.tsx` gets dynamic routing for
  free.
- **Server-side rendering + static generation in one framework.** Marketing/SEO
  pages (`blogs`, `catalogue`, `brand-catalogues`) benefit from SSR/SSG for fast
  first paint and crawlability; `robots.ts` and `sitemap.ts` are native Next.js
  conventions for that — a plain SPA would need extra tooling (e.g.
  react-snap, a separate prerender step) to get the same SEO story.
- **Production output built for containers.** `next.config.ts` sets
  `output: "standalone"`, which traces the exact dependency graph the app needs
  and emits a minimal server bundle. `frontend/Dockerfile` copies only
  `.next/standalone`, `.next/static`, and `public/` into the final image —
  no `node_modules` in the runtime image at all. That's a Next.js-specific
  feature; a generic React app would need its own bundling/pruning strategy to
  get an image this small.
- **Built-in image optimization.** `next/image` handles resizing/compression
  (the `images.formats: []` override in `next.config.ts` is a deliberate
  exception — WebP re-encoding was flattening transparent PNG client logos, so
  format conversion is disabled to preserve alpha channels).
- **One framework, two rendering needs.** The same app serves public marketing
  pages (SEO-sensitive) and an authenticated admin/customer dashboard
  (SPA-like, no SEO need) — Next.js's per-route rendering choice handles both
  without needing two separate apps.

**Why this over, say, Remix or SvelteKit:** mostly ecosystem maturity and team
familiarity — React's component/hook model, the size of the library ecosystem
(GSAP for animation is already a dependency), and Vercel's continued investment
in Next.js as the default "batteries-included React framework."

---

## 3. Why nginx, and how it hosts both services

`deploy/nginx.conf` + the `nginx` service in `docker-compose.yml`.

**The core problem nginx solves here:** the backend (FastAPI on port 8000) and
frontend (Next.js on port 3000) are two separate processes/containers, but the
public internet should see one origin: `https://handpikd.co`. nginx is the
single entry point that:

1. **Terminates TLS.** Only nginx holds the Let's Encrypt certs
   (`/etc/letsencrypt/live/handpikd.co/`, managed by the `certbot` service).
   Neither FastAPI nor Next.js need to know about HTTPS at all — they only ever
   speak plain HTTP inside the Docker network.
2. **Path-based routing to two upstreams**, per the comment at the top of
   `nginx.conf`:
   - `location /api/` → `proxy_pass http://backend:8000` (FastAPI)
   - `location /media/` → also proxied to the backend, because product images
     are served through FastAPI's `StaticFiles` mount (`app.mount("/media", ...)`
     in `main.py`) rather than nginx reading the volume directly — this keeps
     dev and prod behaving identically, since in dev there's no nginx in front
     at all.
   - `location /` (everything else) → `proxy_pass http://frontend:3000` (Next.js)
   - The `backend` / `frontend` hostnames resolve via Docker Compose's internal
     DNS — every service in a compose file can reach another by its service
     name.
3. **Makes same-origin work, which kills the CORS problem.** Because
   `/api/` and `/` are both served from `handpikd.co`, the frontend's
   `NEXT_PUBLIC_API_BASE_URL` can just be the relative path `/api/v1`
   (baked in at build time in `frontend/Dockerfile`) instead of an absolute
   cross-origin URL. Browser fetches from the frontend to `/api/v1/...` never
   leave the origin, so there's no preflight/CORS negotiation to get right in
   production. (The backend's `CORSMiddleware` with `allow_origins=["*"]` is
   there mainly for local dev, where frontend:3000 and backend:8000 *are* on
   different origins.)
4. **HTTP → HTTPS redirect + ACME challenge.** The port-80 `server` block only
   does two things: serve `/.well-known/acme-challenge/` (so certbot can prove
   domain ownership to renew the cert) and 301-redirect everything else to
   `https://`.
5. **WebSocket upgrade support.** The `location /` block sets
   `proxy_http_version 1.1` plus `Upgrade`/`Connection` headers — needed for
   Next.js dev/HMR and any websocket-based feature to work through the proxy.

So: **two backend services, one public hostname** — nginx is the thing that
makes that possible, and it's the only container-facing service that's
actually reachable from the public internet (`ports: "80:80"`, `"443:443"`
in compose; backend and frontend only `expose` their ports internally).

---

## 4. How Docker deploys this on the VPS

`docker-compose.yml` defines four services. `docker compose up -d --build` on
the VPS is effectively the whole deploy.

```
Internet
   │  :80 / :443
   ▼
┌─────────┐        ┌──────────┐
│  nginx  │──/api/─▶│ backend  │  (FastAPI, uvicorn, :8000)
│ :80/443 │  /media/│  :8000   │
│         │         └──────────┘
│         │──/──────▶┌──────────┐
│         │          │ frontend │  (Next.js standalone, :3000)
└─────────┘          │  :3000   │
                      └──────────┘
      (certbot: on-demand, shares nginx's webroot/cert volumes)
```

- **`backend` service** — built from `backend/Dockerfile`: a single-stage
  Python 3.11-slim image. Installs system libs `opencv-python-headless` needs
  at runtime (`libglib2.0-0`, `libgomp1`), installs `requirements.txt`, then
  `playwright install --with-deps chromium` (for the quotation-PDF renderer —
  this pulls in fonts/X11/GTK libs Chromium needs, since PDFs are rendered by
  driving a real headless browser rather than a from-scratch CSS engine).
  Runs `uvicorn app.main:app`. Only `expose`s :8000 — reachable from other
  containers on the compose network, not from the host/internet directly.
- **`frontend` service** — built from `frontend/Dockerfile`, a **3-stage
  multi-stage build**:
  1. `deps` — `npm ci` into `node_modules`
  2. `builder` — copies `node_modules` + source, bakes
     `NEXT_PUBLIC_API_BASE_URL=/api/v1` and `NEXT_PUBLIC_MEDIA_BASE_URL=""` as
     build args (these get compiled into the client JS bundle, since
     `NEXT_PUBLIC_*` vars are inlined at build time, not read at runtime), runs
     `next build`
  3. `runner` — copies **only** `public/`, `.next/standalone`, and
     `.next/static` from the builder stage into a fresh `node_modules`-free
     image, runs `node server.js`

  The multi-stage split means the final image doesn't carry `npm`, dev
  dependencies, or the full `node_modules` tree — just the traced production
  bundle. Also only `expose`s :3000 internally.
- **`nginx` service** — off-the-shelf `nginx:1.27-alpine`, no custom image.
  Mounts `deploy/nginx.conf` read-only as `default.conf`, plus two named
  volumes shared with certbot: `certbot-etc` (the live certs) and
  `certbot-webroot` (for ACME HTTP-01 challenge files). This is the only
  service with `ports:` (host-exposed) rather than `expose:` (internal-only) —
  it's the sole entry point from the public internet.
- **`certbot` service** — not a long-running process. It's started on-demand
  (`docker compose run --rm certbot certonly ...`) to issue/renew the TLS
  cert via the webroot nginx shares. If `docker compose up` ever starts it
  accidentally, the image's default command (`certbot --help`) is a harmless
  no-op — deliberately *not* overridden with an entrypoint, since that would
  break the `run --rm certbot certonly ...` on-demand usage too (an entrypoint
  override replaces the whole command, not just the no-args default).

**Persistent data survives redeploys via bind mounts to the host, outside the
git-managed code directory:**
- `/srv/handpikd-media` → `/media` in the backend container (product images —
  public, served via the `/media/` nginx→backend route)
- `/srv/handpikd-purchase-invoices` → `/purchase_invoices` (vendor invoice
  PDFs — contains pricing/GSTIN data, never served publicly, no nginx route
  for it at all)

Keeping these on host paths rather than inside the container/image means a
`git reset --hard` + rebuild deploy (the implied workflow, per the comment in
`docker-compose.yml`) never touches uploaded files — only code changes.

**Why Docker Compose (vs. Kubernetes or bare processes) for this VPS:** it's a
single-VPS deployment with a handful of services — Compose gives you
declarative multi-container orchestration (build, network, volumes, restart
policy) without the operational overhead of a cluster scheduler. `restart:
unless-stopped` on each service is Compose/Docker's own crash-recovery
mechanism substituting for a process supervisor like systemd per-service.

---

## Summary

| Layer | Tech | Core reason (per this codebase) |
|---|---|---|
| API | FastAPI + Beanie + uvicorn | async I/O for Mongo + Playwright PDF rendering; Pydantic gives validation, serialization, and OpenAPI docs from one schema |
| Web | Next.js 16 (App Router) + React 19 | file-based routing across a large page set, mixed SSR/SEO + SPA-like admin needs, `output: standalone` for lean Docker images |
| Edge | nginx | single public origin/TLS termination in front of two internal services, same-origin routing to kill CORS, ACME challenge handling |
| Deploy | Docker Compose on the VPS | 4 declarative services (backend, frontend, nginx, certbot), multi-stage builds for small images, host-mounted volumes so uploads survive redeploys |