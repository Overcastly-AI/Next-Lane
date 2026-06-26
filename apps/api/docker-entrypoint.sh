#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
npx prisma migrate deploy

if [ "${AUTO_SEED:-true}" = "true" ]; then
  echo "[entrypoint] Seeding demo data (skips if already present)..."
  AUTO_SEED_GUARD=1 npx tsx prisma/seed.ts || echo "[entrypoint] Seed step skipped/failed (continuing)."
fi

echo "[entrypoint] Starting API..."
exec node dist/main.js
