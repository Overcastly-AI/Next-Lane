#!/bin/sh
# Container entrypoint: write runtime config then hand off to nginx.
#
# Reads API_URL env var (falls back to VITE_API_URL for backward-compat, then
# a localhost default) and writes ${NL_RUNTIME_DIR}/config.js so the React app
# can read it as window.__NL_CONFIG__.apiUrl at runtime.
#
# This allows ONE built web image to serve any deployment environment — the API
# URL is injected here, not baked into the JS bundle at build time.
#
# Read-only root filesystem support (Kubernetes hardening):
#   Under `readOnlyRootFilesystem: true` the image's html dir and the baked
#   nginx config are NOT writable. Callers therefore:
#     1. mount a writable volume and set NL_RUNTIME_DIR to it (config.js is
#        written there; nginx serves /config.js from it via `alias`), and
#     2. provide the nginx config via a mounted ConfigMap that already has the
#        correct connect-src (no placeholder), so no in-place sed is needed.
#   This script degrades gracefully in that case instead of crashing.

set -e

# Resolve the API URL. We use ${VAR+set} (not :-) so an EXPLICIT empty value is
# honoured: the same-origin deployment sets API_URL="" on purpose, which makes
# the SPA issue same-origin relative requests (nginx reverse-proxies /api). A
# plain `${API_URL:-...}` would wrongly treat "" as unset and fall through to the
# localhost default.
if [ -n "${API_URL+set}" ]; then
  RESOLVED_API_URL="$API_URL"
elif [ -n "${VITE_API_URL+set}" ]; then
  RESOLVED_API_URL="$VITE_API_URL"
else
  RESOLVED_API_URL="http://localhost:4000"
fi

# Where to write the runtime config. Defaults to the html dir (writable on a
# plain `docker run` / Compose layer); deployments with a read-only root FS set
# this to a writable mounted volume and point nginx at the same path.
RUNTIME_DIR="${NL_RUNTIME_DIR:-/usr/share/nginx/html}"
mkdir -p "$RUNTIME_DIR" 2>/dev/null || true

cat > "$RUNTIME_DIR/config.js" <<EOF
// Auto-generated at container start — do not edit.
window.__NL_CONFIG__ = { apiUrl: "${RESOLVED_API_URL}" };
EOF

echo "[next-lane/web] runtime config written: ${RUNTIME_DIR}/config.js (apiUrl=${RESOLVED_API_URL})"

# ── CSP connect-src ──────────────────────────────────────────────────────────
# The standalone image (separate API origin, e.g. Compose) ships an nginx config
# with a `__NL_CONNECT_SRC__` placeholder that must be expanded to allow the API
# origin + its WebSocket scheme. The same-origin Kubernetes deployment instead
# mounts a ConfigMap whose connect-src is already 'self' (no placeholder) and is
# read-only — so we only substitute when the active config is writable AND still
# contains the placeholder. Otherwise we skip it (nothing to do).
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

NGINX_CONF="/etc/nginx/conf.d/default.conf"
if [ -f "$NGINX_CONF" ] && [ -w "$NGINX_CONF" ] && grep -q "__NL_CONNECT_SRC__" "$NGINX_CONF" 2>/dev/null; then
  sed -i "s#__NL_CONNECT_SRC__#${CONNECT_SRC}#g" "$NGINX_CONF"
  echo "[next-lane/web] CSP connect-src set to: ${CONNECT_SRC}"
else
  echo "[next-lane/web] nginx config is read-only or has no connect-src placeholder — leaving it as provided (expected for the same-origin Kubernetes deployment)."
fi

# ── API reverse proxy ────────────────────────────────────────────────────────
# Serve the API on the SAME ORIGIN as the app when an upstream is configured.
#
# WHY: Compose published the API on its own port and the SPA talked to it
# directly, so everything outside the browser — a Python script, curl, the
# Swagger page itself — needed that second port reachable. On any host that is
# not your laptop that means opening or forwarding another port before you can
# make a single API call. Founder: "I cannot find the swagger docs without port
# forwarding… people need to be able to tap into the APIs outside of the web
# interface." With this, one origin serves the app, the REST API, the reference
# and the WebSocket.
#
# Only emitted when API_PROXY_UPSTREAM is set. Unset = the old behaviour
# exactly, because `proxy_pass` to a literal host is resolved at nginx START and
# an image that cannot resolve `api` would refuse to boot rather than degrade.
if [ -f "$NGINX_CONF" ] && [ -w "$NGINX_CONF" ] && grep -q "__NL_API_PROXY__" "$NGINX_CONF" 2>/dev/null; then
  if [ -n "${API_PROXY_UPSTREAM:-}" ]; then
    PROXY_BLOCK=$(cat <<PROXY
  # Swagger UI lives at exactly /api; the REST routes live under /api/.
  # Two locations because \`= /api\` must not swallow /api/issues.
  location = /api {
    proxy_pass ${API_PROXY_UPSTREAM}/api;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  location /api/ {
    proxy_pass ${API_PROXY_UPSTREAM}/api/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    # Attachments can be large; do not buffer a whole upload into nginx.
    client_max_body_size 25m;
    proxy_request_buffering off;
  }
  # The machine-readable spec, and the health probes, are outside /api.
  location = /api-json {
    proxy_pass ${API_PROXY_UPSTREAM}/api-json;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  # PREFIX, not \`= /health\`. An exact match cannot match /health/live, which
  # main.ts also excludes from the global prefix and the OpenAPI document also
  # publishes — so Swagger's "Try it out" called it here and got index.html
  # back with a 200. Nothing else in the app lives under /health, and a request
  # this forwards that the API does not serve gets an honest 404 from the API
  # rather than a misleading 200 of SPA HTML.
  location /health {
    proxy_pass ${API_PROXY_UPSTREAM}/health;
    proxy_set_header Host \$host;
  }
  # Realtime. Without the upgrade headers socket.io silently falls back to
  # long-polling and the board stops updating live.
  location /socket.io/ {
    proxy_pass ${API_PROXY_UPSTREAM}/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 3600s;
  }
PROXY
)
    # Write via a temp file: the block is multi-line, which `sed s###` cannot do.
    awk -v block="$PROXY_BLOCK" '{ if ($0 ~ /__NL_API_PROXY__/) print block; else print }' \
      "$NGINX_CONF" > "${NGINX_CONF}.tmp" && mv "${NGINX_CONF}.tmp" "$NGINX_CONF"
    echo "[next-lane/web] API reverse-proxied on this origin -> ${API_PROXY_UPSTREAM}"
  else
    sed -i "s#__NL_API_PROXY__##g" "$NGINX_CONF"
    echo "[next-lane/web] no API_PROXY_UPSTREAM set — the SPA will call the API origin directly."
  fi
fi

# Start nginx in the foreground (replaces this shell process).
exec nginx -g "daemon off;"
