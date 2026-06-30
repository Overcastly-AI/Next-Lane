#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
npx prisma migrate deploy

# Seed demo data only when AUTO_SEED=true (default is false/unset = no seed).
# The docker-compose.yml sets AUTO_SEED=true for the local/demo stack so the
# out-of-the-box experience is unchanged. Production deployments that omit
# AUTO_SEED (or set it to false) will not auto-seed.
if [ "${AUTO_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Seeding demo data (skips if already present)..."
  AUTO_SEED_GUARD=1 npx tsx prisma/seed.ts || echo "[entrypoint] Seed step skipped/failed (continuing)."
fi

echo "[entrypoint] Starting API..."
exec node dist/main.js
