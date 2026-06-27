#!/bin/sh
# Container entrypoint: write runtime config then hand off to nginx.
#
# Reads API_URL env var (falls back to VITE_API_URL for backward-compat, then
# a localhost default) and writes /usr/share/nginx/html/config.js so the React
# app can read it as window.__NL_CONFIG__.apiUrl at runtime.
#
# This allows ONE built web image to serve any deployment environment — the API
# URL is injected here, not baked into the JS bundle at build time.

set -e

RESOLVED_API_URL="${API_URL:-${VITE_API_URL:-http://localhost:4000}}"

cat > /usr/share/nginx/html/config.js <<EOF
// Auto-generated at container start — do not edit.
window.__NL_CONFIG__ = { apiUrl: "${RESOLVED_API_URL}" };
EOF

echo "[next-lane/web] runtime config written: apiUrl=${RESOLVED_API_URL}"

# Start nginx in the foreground (replaces this shell process).
exec nginx -g "daemon off;"
