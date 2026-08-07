#!/usr/bin/env bash
# Starts the backend (FastAPI) and frontend (Next.js) dev servers together.
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

PIDS=()

cleanup() {
  echo ""
  echo "Stopping services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting backend (FastAPI)..."
(
  cd "$BACKEND_DIR"
  if [ -f "venv/Scripts/activate" ]; then
    source venv/Scripts/activate
  elif [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
  fi
  exec uvicorn app.main:app --reload
) &
PIDS+=($!)

echo "Starting frontend (Next.js)..."
(
  cd "$FRONTEND_DIR"
  exec npm run dev
) &
PIDS+=($!)

echo "Backend PID: ${PIDS[0]} | Frontend PID: ${PIDS[1]}"
echo "Press Ctrl+C to stop both."

wait
