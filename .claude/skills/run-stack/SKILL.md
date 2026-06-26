---
name: run-stack
description: Bring the Next Lane stack up locally and verify it works end-to-end (Docker Compose or hybrid dev mode), then smoke-test the API and web. Use when asked to run, start, or verify the app.
---

# Run & verify the Next Lane stack

## Option A — full Docker (closest to production)

```bash
cp -n .env.example .env
docker compose up -d --build
docker compose ps          # all services healthy?
docker compose logs -f api # watch migrations + boot
```

Smoke test:
- API health: `curl -s http://localhost:4000/health` (expect 200).
- Swagger: open `http://localhost:4000/api`.
- Web: open `http://localhost:3000`, log in with the seeded `demo@nextlane.dev` / `nextlane`.

## Option B — hybrid dev (hot reload)

```bash
pnpm install
docker compose up -d db redis
pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Verifying a change works
1. Reproduce the user flow the change targets (create issue, move card, etc.).
2. Check the API response and the DB state (`docker compose exec db psql -U nextlane -d nextlane`).
3. Confirm no errors in `docker compose logs api` / browser console.

## Tear down
```bash
docker compose down       # keep data
docker compose down -v    # wipe volumes (fresh DB)
```

## Troubleshooting
- Port in use: change `*_PORT` in `.env`.
- API can't reach DB: ensure `db` is healthy; `DATABASE_URL` host is `db` inside compose, `localhost` on the host.
- Migrations didn't run: the api entrypoint runs `prisma migrate deploy`; check its logs.
