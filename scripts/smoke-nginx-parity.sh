#!/usr/bin/env bash
# Assert the two same-origin nginx configs route the same set of paths.
#
# WHY THIS EXISTS
# ───────────────
# Next Lane serves the API on the app's own origin in two independent places:
#
#   1. Docker Compose — `apps/web/docker-entrypoint.sh` generates the proxy
#      block into the image's `apps/web/nginx.conf`.
#   2. Kubernetes — `deploy/helm/next-lane/templates/configmap.yaml` renders a
#      complete nginx config that OVERRIDES the image's, because the Helm pod
#      runs with a read-only root filesystem.
#
# Two hand-maintained implementations of one behaviour drift, and this one had:
# Helm proxied `/api/` and `/socket.io/` but not `= /api` (the Swagger UI),
# `= /api-json` (the OpenAPI document) or `= /health`. Because the SPA fallback
# is `try_files $uri $uri/ /index.html`, those did not 404 — they silently
# returned the app's HTML, so the API reference on Kubernetes served the SPA
# and looked like a rendering bug rather than a missing route. A comment in
# that file even claimed /health was "also proxied for convenience" while no
# such location existed.
#
# This compares the two by the only thing that matters — which paths each one
# actually routes to the API — so a route added to one and forgotten in the
# other fails here instead of in someone's cluster.
#
# Dependencies: bash + grep only. No Docker, no cluster, no helm binary: it
# reads the location directives out of both sources textually, which is enough
# because a location that is not written down cannot be served.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRYPOINT="$ROOT/apps/web/docker-entrypoint.sh"
HELM_CM="$ROOT/deploy/helm/next-lane/templates/configmap.yaml"

fail() { echo "NGINX-PARITY FAIL: $*" >&2; echo "::error::NGINX-PARITY FAIL: $*" >&2; exit 1; }

[ -f "$ENTRYPOINT" ] || fail "missing $ENTRYPOINT"
[ -f "$HELM_CM" ]    || fail "missing $HELM_CM"

# Pull `location <match>` targets, ignoring commented lines. Normalises
# `location = /api {` and `location /api/ {` to `=/api` and `/api/`.
locations_in() {
  grep -oE '^[[:space:]]*location[[:space:]]+(=[[:space:]]*)?[^ {]+' "$1" \
    | sed -E 's/^[[:space:]]*location[[:space:]]+//; s/=[[:space:]]*/=/' \
    | sort -u
}

COMPOSE_LOCS="$(locations_in "$ENTRYPOINT")"
HELM_LOCS="$(locations_in "$HELM_CM")"

echo "==> Compose (entrypoint-generated) proxy locations:"
echo "$COMPOSE_LOCS" | sed 's/^/    /'
echo "==> Helm (ConfigMap) locations:"
echo "$HELM_LOCS" | sed 's/^/    /'

# Everything the Compose path proxies to the API must also be routed by Helm.
# The reverse is not required: Helm additionally owns /config.js, / and
# /assets/, which the image's own nginx.conf provides statically.
MISSING=""
while IFS= read -r loc; do
  [ -n "$loc" ] || continue
  if ! printf '%s\n' "$HELM_LOCS" | grep -qxF "$loc"; then
    MISSING="${MISSING}${loc}"$'\n'
  fi
done <<< "$COMPOSE_LOCS"

if [ -n "$MISSING" ]; then
  echo "The Compose web image proxies these to the API, and the Helm chart does not:" >&2
  printf '%s' "$MISSING" | sed 's/^/    /' >&2
  echo >&2
  echo "Add the matching location block(s) to $HELM_CM." >&2
  echo "NOTE: a missing location does NOT 404 — the SPA fallback answers with" >&2
  echo "index.html, so the symptom is the app's HTML where the API was expected." >&2
  fail "$(printf '%s' "$MISSING" | tr '\n' ' ' | sed 's/ $//') routed in Compose but not in Helm"
fi

# The four the API actually needs, asserted by name so neither file can drop
# them and still pass by matching each other.
for required in "=/api" "/api/" "=/api-json" "/socket.io/"; do
  printf '%s\n' "$COMPOSE_LOCS" | grep -qxF "$required" \
    || fail "the Compose config no longer routes '$required'"
  printf '%s\n' "$HELM_LOCS" | grep -qxF "$required" \
    || fail "the Helm config no longer routes '$required'"
done

# ── Paths outside the API's global prefix ────────────────────────────────────
#
# Matching each other and naming four routes was not enough, and this is the
# hole it left. `main.ts` does:
#
#     app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] })
#
# so those two are real, documented API routes that do NOT live under /api/ —
# they are published in the OpenAPI document, which means Swagger's "Try it
# out" calls them on the app's own origin. Every proxy had `= /health`, an
# EXACT match that cannot match /health/live, and the dev server did not
# forward /health at all. All three answered index.html with a 200: the API
# reference reporting `text/html` for a route that returns JSON.
#
# So the list is read from main.ts rather than written here. Add a route to
# `exclude` and forget to proxy it, and this fails instead of shipping a path
# that silently serves the SPA.
MAIN_TS="$ROOT/apps/api/src/main.ts"
VITE_CFG="$ROOT/apps/web/vite.config.ts"
[ -f "$MAIN_TS" ]  || fail "missing $MAIN_TS"
[ -f "$VITE_CFG" ] || fail "missing $VITE_CFG"

EXCLUDED="$(grep -oE "setGlobalPrefix\('api', \{ exclude: \[[^]]*\]" "$MAIN_TS" \
  | grep -oE "'[^']+'" | tr -d "'" | grep -v '^api$' | sort -u)"

[ -n "$EXCLUDED" ] \
  || fail "could not read the setGlobalPrefix exclude list from $MAIN_TS — if its shape changed, update this parser rather than deleting the check"

echo "==> API routes outside the /api prefix (from main.ts): $(printf '%s' "$EXCLUDED" | tr '\n' ' ')"

# nginx: a `location /health` PREFIX covers /health and every /health/*.
# An exact `= /health` covers only itself, which is the bug — so require the
# prefix form for the top segment of each excluded path.
for ex in $EXCLUDED; do
  top="/${ex%%/*}"
  for pair in "Compose:$COMPOSE_LOCS" "Helm:$HELM_LOCS"; do
    name="${pair%%:*}"; locs="${pair#*:}"
    if printf '%s\n' "$locs" | grep -qxF "$top"; then
      continue                                   # prefix match — covers subpaths
    fi
    if printf '%s\n' "$locs" | grep -qxF "=$top"; then
      fail "the $name config routes '$top' as an EXACT match (= $top), which cannot match subpaths like '/$ex'. Use the prefix form 'location $top' instead — an unmatched path does not 404, the SPA fallback answers it with index.html."
    fi
    fail "the $name config does not route '$top', which the API serves outside its /api prefix"
  done

  # The dev server is the third implementation of this same routing, and it is
  # the one a contributor hits first.
  printf '%s' "$top" | grep -q . && {
    grep -qE "'\\$top'[[:space:]]*:[[:space:]]*\{" "$VITE_CFG" \
      || fail "the Vite dev proxy ($VITE_CFG) does not forward '$top', so 'pnpm dev' answers it with the SPA while production proxies it to the API"
  }
done

echo "==> ALL NGINX-PARITY ASSERTIONS PASSED"
