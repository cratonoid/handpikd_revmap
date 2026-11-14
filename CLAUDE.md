# handpikd_revmap: rules for Claude

FastAPI + Beanie backend (`backend/`, MongoDB Atlas) and Next.js frontend
(`frontend/`, see frontend/CLAUDE.md). Production runs on Docker Compose at
`/opt/handpikd_revmap` on the VPS. See docs/stack-and-deployment.md.

## Deploying
- **Any push to `main` deploys to production.** GitHub Actions
  (.github/workflows/deploy.yml) builds the images, runs migrations and swaps
  the containers. So never `git push` to main yourself: ship only with
  `./deploy.sh`, which tests first, pushes, waits for CI, health-checks
  https://handpikd.co and rolls back automatically on failure.
- Never deploy when tests, lint or typecheck fail. Fix them first. Never skip,
  delete or weaken a test to get a deploy through.
- Report deploy.sh's ✅/❌ summary line as-is. After a ❌ with rollback, the bad
  commits are still in history, under a "Rollback:" commit. To retry, fix
  forward on top of that commit (e.g. `git revert <rollback-sha>`, then the
  fix), never rewrite history.
- A rollback does not undo data migrations (backend/scripts/migrate_*).

## Ask first, then wait for an explicit yes
- Deleting files.
- Changing the DB schema: Beanie models in backend/app/models, indexes, or
  adding/editing a migration in backend/scripts.
- Editing deploy.sh, deploy/, docker-compose.yml or .github/.

## Secrets
- Never read, print, log or commit secrets: `.env*`, `*.pem`, keys, tokens,
  `.server-credentials.local`, `temp_cred.txt`, Mongo/SMTP credentials. If you
  need a config value, ask for it, or reference the variable name only.

## Commands
- Backend tests: `cd backend && venv/bin/python -m pytest -q`
- Frontend: `cd frontend && npm run lint` and `npx tsc --noEmit`. Don't run
  `npm run build` on the VPS: it starves the live site, and CI builds it.
