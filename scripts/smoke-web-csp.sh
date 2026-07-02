#!/usr/bin/env bash
# Docker artifact smoke test for the Next Lane web image.
#
# Regression guard for the CSP/connect-src bug class: a past production bug
# shipped because `apps/web/docker-entrypoint.sh`'s substitution of the
# `__NL_CONNECT_SRC__` placeholder in `apps/web/nginx.conf` broke, and CI never
# started the built container to catch it. This script DOES start the container
# and asserts the served Content-Security-Policy header (and runtime config.js)
# are correct in BOTH deployment modes:
#
#   1. External API origin  (API_URL=https://api.example.com)
#        connect-src must contain  'self' https://api.example.com wss://api.example.com
#        config.js must contain    apiUrl: "https://api.example.com"
#   2. Same-origin          (API_URL="")
#        connect-src must be       'self'   (only)
#        no leftover __NL_CONNECT_SRC__ placeholder anywhere in headers/HTML
#
# Dependencies: bash + curl + docker only.
#
# Usage:
#   scripts/smoke-web-csp.sh <web-image-ref>
# e.g.
#   scripts/smoke-web-csp.sh ghcr.io/acme/next-lane-web:edge
#   scripts/smoke-web-csp.sh next-lane-web:smoke
set -euo pipefail

IMAGE="${1:?usage: smoke-web-csp.sh <web-image-ref>}"

# Two disjoint host ports so the two containers never collide.
PORT_EXT=8081
PORT_SAME=8082
NAME_EXT="nl-web-smoke-ext"
NAME_SAME="nl-web-smoke-same"
API_ORIGIN="https://api.example.com"

cleanup() {
  docker rm -f "$NAME_EXT" "$NAME_SAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "::error::SMOKE FAIL: $*" >&2
  echo "SMOKE FAIL: $*" >&2
  exit 1
}

# Wait until nginx answers on the given port, dumping container logs on timeout.
wait_ready() {
  local port="$1" name="$2"
  if ! curl --retry 10 --retry-delay 1 --retry-connrefused -sf "http://localhost:${port}/" >/dev/null; then
    echo "----- docker logs ${name} -----" >&2
    docker logs "$name" >&2 2>&1 || true
    fail "nginx never became ready on port ${port} (container ${name})"
  fi
}

echo "==> Smoke test image: ${IMAGE}"

# ───────────────────────── Mode 1: external API origin ──────────────────────
echo "==> [mode 1] external API origin (API_URL=${API_ORIGIN})"
docker run -d --name "$NAME_EXT" -e "API_URL=${API_ORIGIN}" -p "${PORT_EXT}:80" "$IMAGE" >/dev/null
wait_ready "$PORT_EXT" "$NAME_EXT"

HEADERS_EXT="$(curl -sI "http://localhost:${PORT_EXT}/")"
CONFIG_EXT="$(curl -sf "http://localhost:${PORT_EXT}/config.js")"

echo "--- response headers (mode 1) ---"
echo "$HEADERS_EXT"
echo "--- config.js (mode 1) ---"
echo "$CONFIG_EXT"

# The placeholder must be gone (this is the exact bug class we guard against).
if printf '%s' "$HEADERS_EXT" | grep -q '__NL_CONNECT_SRC__'; then
  fail "[mode 1] unreplaced __NL_CONNECT_SRC__ placeholder present in response headers"
fi

# A Content-Security-Policy header must actually be present.
CSP_EXT="$(printf '%s' "$HEADERS_EXT" | grep -i '^Content-Security-Policy:' || true)"
[ -n "$CSP_EXT" ] || fail "[mode 1] no Content-Security-Policy response header found"

# connect-src must allow the HTTPS API origin AND its wss:// websocket origin.
printf '%s' "$CSP_EXT" | grep -q "connect-src[^;]*${API_ORIGIN}" \
  || fail "[mode 1] CSP connect-src missing API origin ${API_ORIGIN}; got: ${CSP_EXT}"
printf '%s' "$CSP_EXT" | grep -q "connect-src[^;]*wss://api.example.com" \
  || fail "[mode 1] CSP connect-src missing wss://api.example.com; got: ${CSP_EXT}"

# Runtime config.js must reflect the API URL.
printf '%s' "$CONFIG_EXT" | grep -q 'apiUrl: "https://api.example.com"' \
  || fail "[mode 1] config.js missing apiUrl: \"https://api.example.com\"; got: ${CONFIG_EXT}"

echo "==> [mode 1] PASS"

# ───────────────────────── Mode 2: same-origin ──────────────────────────────
echo "==> [mode 2] same-origin (API_URL= empty)"
docker run -d --name "$NAME_SAME" -e "API_URL=" -p "${PORT_SAME}:80" "$IMAGE" >/dev/null
wait_ready "$PORT_SAME" "$NAME_SAME"

HEADERS_SAME="$(curl -sI "http://localhost:${PORT_SAME}/")"
HTML_SAME="$(curl -sf "http://localhost:${PORT_SAME}/")"

echo "--- response headers (mode 2) ---"
echo "$HEADERS_SAME"

# No leftover placeholder anywhere in the served headers OR the served HTML.
if printf '%s' "$HEADERS_SAME" | grep -q '__NL_CONNECT_SRC__'; then
  fail "[mode 2] unreplaced __NL_CONNECT_SRC__ placeholder present in response headers"
fi
if printf '%s' "$HTML_SAME" | grep -q '__NL_CONNECT_SRC__'; then
  fail "[mode 2] unreplaced __NL_CONNECT_SRC__ placeholder present in served HTML"
fi

CSP_SAME="$(printf '%s' "$HEADERS_SAME" | grep -i '^Content-Security-Policy:' || true)"
[ -n "$CSP_SAME" ] || fail "[mode 2] no Content-Security-Policy response header found"

# connect-src must be exactly 'self' — no API origin, no ws/wss.
# Isolate the connect-src directive value (between "connect-src" and the next ";").
CONNECT_SAME="$(printf '%s' "$CSP_SAME" \
  | sed -nE "s/.*connect-src([^;]*);.*/\1/p" \
  | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
[ -n "$CONNECT_SAME" ] || fail "[mode 2] could not parse connect-src from CSP: ${CSP_SAME}"
[ "$CONNECT_SAME" = "'self'" ] \
  || fail "[mode 2] connect-src expected to be exactly 'self', got: [${CONNECT_SAME}]"

echo "==> [mode 2] PASS"

# ───────────────── Mode 3: script-src vs. inline-<script> guard ─────────────
# Regression guard for a SEPARATE bug class than connect-src: `index.html`
# shipping a synchronous inline <script> (e.g. a dark-mode/no-FOUC bootstrap)
# while `script-src` has no `'unsafe-inline'`/nonce/hash is silently and
# deterministically blocked by CSP in the real served artifact, even though
# it may pass fine against a harness (e.g. `vite preview`) that serves no CSP
# header at all. We fetch the ACTUAL served `index.html` and the ACTUAL served
# CSP header (both already captured above from mode 2 — same-origin config is
# representative; the directive under test, script-src, does not vary between
# modes) and cross-check them against each other, rather than statically
# parsing nginx.conf, so this always reflects the real, post-entrypoint
# artifact behavior.
echo "==> [mode 3] script-src vs. inline <script> in served index.html"

SCRIPT_SRC_SAME="$(printf '%s' "$CSP_SAME" \
  | sed -nE "s/.*script-src([^;]*);.*/\1/p" \
  | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
[ -n "$SCRIPT_SRC_SAME" ] || fail "[mode 3] could not parse script-src from CSP: ${CSP_SAME}"
echo "    script-src: ${SCRIPT_SRC_SAME}"

SCRIPT_SRC_ALLOWS_INLINE=0
if printf '%s' "$SCRIPT_SRC_SAME" | grep -qE "'unsafe-inline'|'nonce-|'sha256-|'sha384-|'sha512-"; then
  SCRIPT_SRC_ALLOWS_INLINE=1
fi

# Find every <script ...> opening tag in the served HTML and flag any that has
# no `src=` attribute — that's an inline script block, which CSP's `script-src`
# governs via 'unsafe-inline'/nonce/hash (an external `src="..."` script,
# self-hosted, is always allowed by plain `'self'` and is NOT what this check
# is for).
INLINE_SCRIPT_FOUND=0
SCRIPT_TAGS="$(printf '%s' "$HTML_SAME" | grep -oE '<script[^>]*>' || true)"
while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  if ! printf '%s' "$tag" | grep -q ' src='; then
    INLINE_SCRIPT_FOUND=1
    echo "    inline <script> tag found: ${tag}"
  fi
done <<< "$SCRIPT_TAGS"

if [ "$INLINE_SCRIPT_FOUND" = "1" ] && [ "$SCRIPT_SRC_ALLOWS_INLINE" = "0" ]; then
  fail "[mode 3] served index.html contains an inline <script> with no src= attribute, but script-src (${SCRIPT_SRC_SAME}) has no 'unsafe-inline'/nonce/hash — this script will be SILENTLY BLOCKED by the browser in production. Move it to a self-hosted static file loaded via <script src=\"...\"> instead."
fi

echo "==> [mode 3] PASS (no inline <script> defeated by script-src, or script-src explicitly allows it)"

echo "==> ALL SMOKE ASSERTIONS PASSED"
