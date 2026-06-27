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

# ── CSP connect-src ──────────────────────────────────────────────────────────
# The SPA calls the API on a SEPARATE origin (the standalone image does not
# reverse-proxy /api), so the nginx CSP must allow that origin and its WebSocket
# scheme — otherwise the browser blocks every API/socket.io request. Derive the
# value from RESOLVED_API_URL and substitute the `__NL_CONNECT_SRC__` placeholder
# in the active nginx config at startup.
CONNECT_SRC="'self'"
case "$RESOLVED_API_URL" in
  ""|/*)
    : # empty or relative path → same-origin only; 'self' is enough
    ;;
  *)
    # Extract scheme://host[:port] (strip any path), then derive ws/wss origin.
    API_ORIGIN=$(printf '%s' "$RESOLVED_API_URL" | sed -E 's#^([a-zA-Z][a-zA-Z0-9+.-]*://[^/]+).*#\1#')
    case "$API_ORIGIN" in
      https://*) WS_ORIGIN="wss://${API_ORIGIN#https://}" ;;
      http://*)  WS_ORIGIN="ws://${API_ORIGIN#http://}" ;;
      *)         WS_ORIGIN="" ;;
    esac
    CONNECT_SRC="'self' ${API_ORIGIN} ${WS_ORIGIN}"
    ;;
esac

# Substitute into the active nginx site config (copied here by the Dockerfile).
NGINX_CONF="/etc/nginx/conf.d/default.conf"
if [ -f "$NGINX_CONF" ]; then
  sed -i "s#__NL_CONNECT_SRC__#${CONNECT_SRC}#g" "$NGINX_CONF"
  echo "[next-lane/web] CSP connect-src set to: ${CONNECT_SRC}"
fi

# Start nginx in the foreground (replaces this shell process).
exec nginx -g "daemon off;"
