#!/usr/bin/env bash
# deploy.sh: the only way to ship to production (see CLAUDE.md).
#
# This script does not build or restart anything itself. The real deploy is
# .github/workflows/deploy.yml: on a push to main it builds the images on
# GitHub's runners, migrates, and swaps the containers on the VPS. This
# script is the gate in front of that push:
#
#   clean tree + lock -> ff-pull main -> install -> test + lint + typecheck
#   -> push main -> wait for the CI deploy -> health-check the live site
#
# A failure before the push leaves production untouched. A failure after the
# push (CI failed, or the site is unhealthy) rolls main back to the
# previously deployed tree with a new "rollback" commit (never a force-push)
# and waits for CI to redeploy it. DB migrations are NOT undone by a rollback.
#
# Usage: ./deploy.sh        Env: GITHUB_TOKEN (optional, raises API rate limit)
set -Eeuo pipefail

REPO_SLUG="cratonoid/handpikd_revmap"
SITE="https://handpikd.co"
CI_TIMEOUT="${CI_TIMEOUT:-1800}"   # seconds to wait for one CI deploy
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"

STAGE="start"; PREV=""; NEW=""; PUSHED=0
LOG="$ROOT/.git/deploy-last.log"
: > "$LOG"

say()  { printf '%s\n' "$*"; }
step() { STAGE="$1"; say "→ $1"; }
# Run quietly; show the tail of the output only if it fails.
quiet() { if ! "$@" >>"$LOG" 2>&1; then tail -n 25 "$LOG"; return 1; fi; }
in_dir() { local d="$1"; shift; (cd "$d" && "$@"); }

summary_fail() {
  say "❌ deploy FAILED at: $STAGE"
  [ -n "$NEW" ] && say "   commit: ${NEW:0:7} $(git log -1 --format=%s "$NEW" 2>/dev/null || true)"
  say "   log: $LOG"
}

# ---------- CI + health helpers ----------
gh_api() {
  local auth=()
  [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsS "${auth[@]}" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO_SLUG/$1"
}

# Prints "<status> <conclusion>" of the newest Deploy run for a sha, or "none".
ci_state() {
  gh_api "actions/workflows/deploy.yml/runs?head_sha=$1&per_page=1" 2>/dev/null | python3 -c '
import json, sys
try:
    runs = json.load(sys.stdin).get("workflow_runs", [])
except Exception:
    runs = []
r = runs[0] if runs else None
print(f"{r['status']} {r['conclusion']}" if r else "none")'
}

live_commit() {
  curl -fsS --max-time 10 "$SITE/api/v1/health" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("commit",""))' 2>/dev/null || true
}

homepage_up() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/" || true)" = "200" ]
}

healthy() {  # healthy <sha>: homepage 200 and backend reports that sha
  homepage_up && [ "$(live_commit)" = "$1" ]
}

# Wait for CI to deploy <sha>; returns 0 once the live site serves it healthy.
# wait_for_deploy <sha> lenient: also accept "CI succeeded + homepage up" when
# the backend has no /health yet (a rollback to code older than it).
wait_for_deploy() {
  local sha="$1" lenient="${2:-}" start now state="" last_ci=0 ci_ok=0
  start="$(date +%s)"
  while :; do
    now="$(date +%s)"
    if healthy "$sha"; then return 0; fi
    # The API allows 60 unauthenticated calls/hour, so poll CI only once a minute.
    if (( !ci_ok && now - last_ci >= 60 )); then
      last_ci=$now
      state="$(ci_state "$sha")"
      case "$state" in
        "completed success") ci_ok=$now ;;
        completed*) say "   CI: $state"; return 1 ;;
      esac
    fi
    if (( ci_ok )); then
      if [ -n "$lenient" ] && homepage_up && [ -z "$(live_commit)" ]; then return 0; fi
      # CI finished the swap; containers get 3 minutes to come up healthy.
      if (( now - ci_ok > 180 )); then
        say "   CI succeeded but site unhealthy (live commit: $(live_commit || true))"; return 1
      fi
    fi
    if (( now - start > CI_TIMEOUT )); then say "   timed out after ${CI_TIMEOUT}s (CI: ${state:-?})"; return 1; fi
    sleep 15
  done
}

rollback() {
  say "↩ rolling back to ${PREV:0:7}"
  # Restore PREV's exact tree (handles added/deleted files and merges) as a
  # new commit, so history is preserved and no force-push is needed.
  git restore --source="$PREV" --staged --worktree -- :/
  git commit -q -m "Rollback: failed deploy of ${NEW:0:7}, restore ${PREV:0:7}" \
                -m "Automatic rollback by deploy.sh (failed at: $STAGE)."
  local rb; rb="$(git rev-parse HEAD)"
  git push -q origin HEAD:main
  if wait_for_deploy "$rb" lenient; then
    say "↩ rollback live: ${rb:0:7} (tree of ${PREV:0:7})"
  else
    say "🚨 ROLLBACK ALSO FAILED; production needs a human. Check GitHub Actions."
  fi
}

on_error() {
  trap - ERR
  summary_fail
  if (( PUSHED )); then rollback || say "🚨 rollback errored; check the site and GitHub Actions now."; fi
  exit 1
}
trap on_error ERR

# ---------- 1. preconditions ----------
step "lock"
exec 9>"$ROOT/.git/deploy.lock"
flock -n 9 || { say "❌ another deploy is already running"; exit 1; }

step "clean tree"
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { say "❌ not on main"; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  say "❌ working tree is dirty; commit or stash first:"; git status --short | head -n 15; exit 1
fi

# ---------- 2. sync ----------
step "pull main (ff-only)"
quiet git fetch origin main
PREV="$(git rev-parse origin/main)"   # what production runs now
if ! quiet git merge --ff-only origin/main; then
  say "   local main and origin/main diverged: rebase onto origin/main first"; false
fi
NEW="$(git rev-parse HEAD)"

# ---------- 3. install ----------
step "install backend deps"
REQ_HASH="$(sha256sum backend/requirements.txt | cut -c1-16)"
if [ ! -x backend/venv/bin/python ] || [ "$(cat backend/venv/.req-hash 2>/dev/null)" != "$REQ_HASH" ]; then
  [ -x backend/venv/bin/python ] || quiet uv venv --python 3.11 backend/venv
  quiet uv pip install --python backend/venv/bin/python -r backend/requirements.txt
  echo "$REQ_HASH" > backend/venv/.req-hash
fi

step "install frontend deps"
LOCK_HASH="$(sha256sum frontend/package-lock.json | cut -c1-16)"
if [ ! -d frontend/node_modules ] || [ "$(cat frontend/node_modules/.lock-hash 2>/dev/null)" != "$LOCK_HASH" ]; then
  quiet in_dir frontend npm ci --no-audit --no-fund
  echo "$LOCK_HASH" > frontend/node_modules/.lock-hash
fi

# ---------- 4. test + build checks ----------
step "backend tests"
# Settings() requires these two; this clone has (and must have) no .env. The
# tests never touch a real DB or sign real tokens, so placeholders are enough.
quiet in_dir backend env MONGODB_URI="mongodb://127.0.0.1:1/test-unused" \
  JWT_SECRET_KEY="test-only-not-a-secret" venv/bin/python -m pytest -q -x

step "frontend lint"
quiet in_dir frontend npm run lint

# The production `next build` runs in CI (docker build), not here: building on
# this VPS took 10+ minutes of CPU and slowed the live site. A type-check
# catches most of what would break that build, in seconds.
step "frontend typecheck"
quiet in_dir frontend npx tsc --noEmit

# ---------- 5. ship ----------
if [ "$NEW" = "$PREV" ] && [ "$(live_commit)" = "$NEW" ]; then
  say "✅ nothing new: ${NEW:0:7} is already live"; exit 0
fi

if [ "$NEW" != "$PREV" ]; then
  step "push main"
  quiet git push origin HEAD:main
  PUSHED=1
fi

step "CI build + deploy (GitHub Actions)"
wait_for_deploy "$NEW"

step "health check"
healthy "$NEW"

trap - ERR
say "✅ deployed ${NEW:0:7}: $(git log -1 --format=%s "$NEW")"
say "   $SITE is up, backend reports ${NEW:0:7}"
