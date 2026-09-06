FROM python:3.11-slim

WORKDIR /app

# opencv-python-headless needs these shared libs at runtime even without GUI support
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Chromium + its OS-level dependencies, for rendering the quotation PDF's
# HTML template by driving a real browser (see app/services/pdf_renderer.py)
# instead of a from-scratch CSS engine — `--with-deps` apt-installs whatever
# that Chromium build needs (fonts, X11/GTK libs, etc.) automatically.
RUN playwright install --with-deps chromium

COPY app ./app

# The one-off data migrations and the runner that applies them
# (scripts/run_migrations.py). These are not imported by the running app, but
# they have to be *in* the image: the deploy step that applies pending
# migrations is `docker compose run --rm backend python
# scripts/run_migrations.py --apply` (see docs/stack-and-deployment.md), and
# with only `COPY app ./app` there was no way to run a migration on the VPS
# at all. That gap is why the catalogue category_ids migration never ran in
# production and 500'd /brand-catalogues.
COPY scripts ./scripts

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
