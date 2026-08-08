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

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
