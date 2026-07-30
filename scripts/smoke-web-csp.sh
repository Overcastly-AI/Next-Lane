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

# Wait until nginx answers on the given port, dumping diagnostics on timeout.
#
# Two things the previous implementation got wrong, both of which surface as
# the SAME misleading "nginx never became ready" message even when nginx is
# demonstrably up (2026-07-26 CI failure: the container logged "start worker
# process" and was then declared not ready):
#
#   1. It probed `localhost`. `docker run -p` publishes on 0.0.0.0 (IPv4) by
#      default, while `localhost` on the GitHub runners can resolve to ::1
#      first. We probe 127.0.0.1 explicitly — there is no CORS or Origin
#      semantics here (plain curl, not a browser), so the literal IP is safe.
#      (The Playwright suite must keep using `localhost` — the API's CORS
#      allowlist is origin-sensitive. That constraint does not apply here.)
#
#   2. It used `curl -f` with `--retry`. `--retry` does NOT retry HTTP error
#      responses — only transient/connection failures — so a `/` that answered
#      404 or 403 failed instantly and was reported as a readiness timeout.
#      Connectivity and HTTP status are now checked separately, and the actual
#      status code is printed.
wait_ready() {
  local port="$1" name="$2"
  local i code=000
  for i in $(seq 1 30); do
    # -o /dev/null + %{http_code}: never fails on HTTP status, so a reachable
    # server that answers 4xx/5xx is distinguishable from an unreachable one.
    #
    # NO `|| echo 000` here. curl ALREADY prints 000 when it cannot connect,
    # and it also exits non-zero — so the fallback appended a second 000 and
    # produced the literal string "000000". That matched neither `2??` nor
    # `000`, fell through to the catch-all, and hard-failed a container that
    # was simply still starting ("Up Less than a second"). Use `|| true` so a
    # non-zero exit doesn't kill the script under `set -e`, and let curl's
    # own output stand.
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
      "http://127.0.0.1:${port}/" 2>/dev/null || true)"
    case "$code" in
      2[0-9][0-9]) return 0 ;;
      # Only a well-formed 3-digit non-2xx is a genuine HTTP error worth
      # failing on immediately. Empty, 000, or anything malformed means "not
      # reachable yet" — keep waiting rather than inventing a diagnosis.
      [1-9][0-9][0-9])
           echo "----- docker ps -----" >&2; docker ps -a --filter "name=${name}" >&2 || true
           echo "----- docker logs ${name} -----" >&2; docker logs "$name" >&2 2>&1 || true
           fail "nginx answered HTTP ${code} (not 2xx) on port ${port} (container ${name})" ;;
      *)   : ;;  # ''/000/unexpected — still coming up
    esac
    sleep 1
  done
  echo "----- docker ps -----" >&2
  docker ps -a --filter "name=${name}" >&2 || true
  echo "----- docker port ${name} -----" >&2
  docker port "$name" >&2 2>&1 || true
  echo "----- docker logs ${name} -----" >&2
  docker logs "$name" >&2 2>&1 || true
  fail "nginx unreachable on 127.0.0.1:${port} after 30s (last curl code=${code}, container ${name})"
}

echo "==> Smoke test image: ${IMAGE}"

# ───────────────────────── Mode 1: external API origin ──────────────────────
echo "==> [mode 1] external API origin (API_URL=${API_ORIGIN})"
docker run -d --name "$NAME_EXT" -e "API_URL=${API_ORIGIN}" -p "${PORT_EXT}:80" "$IMAGE" >/dev/null
wait_ready "$PORT_EXT" "$NAME_EXT"

HEADERS_EXT="$(curl -sI "http://127.0.0.1:${PORT_EXT}/")"
CONFIG_EXT="$(curl -sf "http://127.0.0.1:${PORT_EXT}/config.js")"

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

HEADERS_SAME="$(curl -sI "http://127.0.0.1:${PORT_SAME}/")"
HTML_SAME="$(curl -sf "http://127.0.0.1:${PORT_SAME}/")"

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
#
# HTML COMMENTS MUST BE STRIPPED FIRST. Text inside `<!-- ... -->` is not
# parsed as markup by any browser, so a `<script>` written there is inert and
# CSP has nothing to say about it. Scanning the raw HTML made this check fire
# on prose — and, with perfect irony, the prose it fired on was index.html's
# own comment explaining that the theme bootstrap is "NOT an inline <script>".
# That false positive failed every `Publish images` run and sent a fix at the
# wrong target (Vite's modulePreload polyfill) before anyone read the built
# HTML. Verified against the real built artifact: after stripping comments
# there are zero inline scripts, and the only <script> tags are the three
# src= ones (config.js, theme-init.js, the module entry).
HTML_SAME_NOCOMMENTS="$(printf '%s' "$HTML_SAME" | perl -0777 -pe 's/<!--.*?-->//gs')"

INLINE_SCRIPT_FOUND=0
SCRIPT_TAGS="$(printf '%s' "$HTML_SAME_NOCOMMENTS" | grep -oE '<script[^>]*>' || true)"
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
