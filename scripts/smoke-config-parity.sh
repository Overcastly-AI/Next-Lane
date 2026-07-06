#!/usr/bin/env bash
# Config-parity smoke test: docker-compose.yml vs .env.example
#
# Regression guard for the env-passthrough bug CLASS (audit pass 13, finding
# 1 / 2026-07-06 fix, commit 3c22f21): .env.example documented SMTP_*/
# CORS_ORIGINS/etc. as things an operator could configure, but
# docker-compose.yml's api.environment block never forwarded them into the
# container -- so setting them in a stock self-hosted .env silently did
# nothing. That INSTANCE is fixed. This script closes the CLASS: it proves,
# every CI run, that every variable .env.example tells an operator they can
# set actually reaches the api service's rendered environment, and -- the
# opposite direction -- that every variable the api service actually reads
# from ${...} in docker-compose.yml is documented in .env.example so an
# operator can discover it in the first place.
#
# Method: render `docker compose config` with a distinct SENTINEL value
# assigned to every documented variable (not just "is the key present" -- a
# key can be present with a hardcoded/default value while the actual
# passthrough is broken, which is exactly how the original bug shipped) and
# assert the rendered api service environment echoes that exact sentinel back
# for every variable that is supposed to be a real 1:1 passthrough.
#
# A small, explicit, reviewed ignore-list (with a one-line reason each, see
# below) covers documented variables that are legitimately NOT a 1:1 api
# passthrough -- composed into another value, consumed by a different
# service, a build arg, or an intentionally container-internal default. Every
# entry was verified against docker-compose.yml + the reading code before
# being added; this list is meant to stay short and to be re-reviewed
# whenever it grows.
#
# Dependencies: bash + docker (with the compose plugin) + jq. No build, no
# running containers -- `docker compose config` only parses + interpolates.
#
# Usage:
#   scripts/smoke-config-parity.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_EXAMPLE="${REPO_ROOT}/.env.example"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"

fail() {
  echo "::error::CONFIG-PARITY FAIL: $*" >&2
  echo "CONFIG-PARITY FAIL: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is required on PATH"
docker compose version >/dev/null 2>&1 || fail "docker compose (v2 plugin) is required"
command -v jq >/dev/null 2>&1 || fail "jq is required on PATH"
[ -f "$ENV_EXAMPLE" ] || fail ".env.example not found at ${ENV_EXAMPLE}"
[ -f "$COMPOSE_FILE" ] || fail "docker-compose.yml not found at ${COMPOSE_FILE}"

STDERR_FILE="$(mktemp)"
cleanup() { rm -f "$STDERR_FILE"; }
trap cleanup EXIT

# ────────────────────────────── ignore lists ────────────────────────────────
#
# 1) Documented in .env.example but NOT expected to be a 1:1 passthrough into
#    the api service's rendered environment. Reviewed against
#    docker-compose.yml + the reading code -- not assumed.
declare -A IGNORE_NOT_FORWARDED=(
  [DATABASE_URL]="composed inline in docker-compose.yml from POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB + a fixed db:5432 host; the file never reads a top-level \${DATABASE_URL} at all"
  [REDIS_URL]="hardcoded to redis://redis:6379 in docker-compose.yml (multi-replica/BullMQ wiring); the file never reads \${REDIS_URL}"
  [API_PORT]="only controls the HOST port mapping (\${API_PORT:-4000}:4000 under ports:); the container's internal API_PORT env is a fixed literal (4000) regardless of this var"
  [POSTGRES_USER]="consumed directly by the db service's own environment and composed into the api's DATABASE_URL string; not forwarded to api as its own key"
  [POSTGRES_PASSWORD]="same as POSTGRES_USER -- db service env + composed into DATABASE_URL"
  [POSTGRES_DB]="same as POSTGRES_USER -- db service env + composed into DATABASE_URL"
  [POSTGRES_PORT]="db service's host port mapping only (ports: \${POSTGRES_PORT:-5432}:5432); irrelevant to the api container"
  [REDIS_PORT]="redis service's host port mapping only; irrelevant to the api container"
  [WEB_PORT]="web service's host port mapping only; irrelevant to the api container"
  [VITE_API_URL]="web service Dockerfile build ARG (baked at image build time), not an api runtime environment variable"
  [UPLOADS_DIR]="intentionally container-internal: docker-compose.yml mounts the uploads named volume at the fixed in-container path /app/uploads, which already matches the code's own default (./uploads resolved against the container's /app working directory) -- nothing to forward"
  [RESET_BASE_URL]="legacy fallback superseded by WEB_BASE_URL -- verified both call sites (oidc.controller.ts, notifications.service.ts, password-reset.service.ts) check WEB_BASE_URL first, and WEB_BASE_URL always has a default forwarded in docker-compose.yml, so RESET_BASE_URL's fallback branch is unreachable in this deployment path; kept for .env backward-compat only"
  [OTEL_SERVICE_NAME]="documented future/stub OpenTelemetry var (.env.example: 'CURRENT STATUS: OTLP export is a documented stub'); apps/api reads none of the OTEL_* vars today (SDK not installed) so there is nothing to forward until it ships"
  [OTEL_EXPORTER_OTLP_ENDPOINT]="see OTEL_SERVICE_NAME"
  [OTEL_TRACES_SAMPLER]="see OTEL_SERVICE_NAME"
  [OTEL_TRACES_SAMPLER_ARG]="see OTEL_SERVICE_NAME"
)

# 2) Forwarded into the api service's environment (referenced as ${VAR...} in
#    the api service's docker-compose.yml stanza) but NOT required to be
#    documented in .env.example. Empty today -- every ${VAR} the api service
#    reads from the environment has a .env.example entry. Add a reviewed
#    entry here (with a reason) only for a genuinely internal wiring variable
#    that should never be operator-facing; do not use this to silence a real
#    documentation gap -- fix .env.example instead.
declare -A IGNORE_UNDOCUMENTED=()

# NODE_ENV is intentionally excluded from both checks: docker-compose.yml
# hardcodes it to the literal "production" (not a ${NODE_ENV} interpolation),
# so it is neither an operator-configurable var to document nor a passthrough
# to verify.

# ───────────────────── 1. parse documented vars from .env.example ───────────
#
# Matches BOTH active ("VAR=value") and commented-optional ("# VAR=value" /
# "#   VAR=value") declaration lines. Anchored at the START of the line (after
# optional leading whitespace and an optional single "#") so a prose mention
# of a var name elsewhere in a comment -- e.g. "OIDC_ISSUER_URL    -- the
# provider's issuer URL...", "${OIDC_ISSUER_URL}/.well-known/..." -- is never
# mistaken for a declaration: neither is followed immediately by "=" at that
# position. This is deliberate, not a blanket "grep for ALL_CAPS=" scrape.
mapfile -t DOCUMENTED_VARS < <(
  grep -oE '^[[:space:]]*#?[[:space:]]*[A-Z][A-Z0-9_]*=' "$ENV_EXAMPLE" \
    | sed -E 's/^[[:space:]]*#?[[:space:]]*//; s/=$//' \
    | sort -u
)
[ "${#DOCUMENTED_VARS[@]}" -gt 0 ] \
  || fail "parsed zero variables from ${ENV_EXAMPLE} -- the parser regex probably broke"

echo "==> Parsed ${#DOCUMENTED_VARS[@]} documented variable(s) from .env.example"

# ─────────────── 2. render docker compose config with sentinel env ──────────
#
# Every documented var gets its OWN distinct sentinel value (not just "any
# truthy value") so passthrough is provable: a key merely being PRESENT in the
# rendered environment (e.g. with a hardcoded or ${VAR:-default} value) is not
# enough -- the exact sentinel must round-trip, or the passthrough is broken
# or absent, which is exactly the bug class this guards against.
#
# Exception: a handful of documented vars (POSTGRES_PORT/REDIS_PORT/API_PORT/
# WEB_PORT) are used as HOST PORT NUMBERS in `ports:` mappings (anywhere in
# the compose file, not just the api service), where docker compose validates
# the value as an actual port -- an alnum sentinel string there makes the
# whole render fail with "invalid hostPort", not just that one assertion. All
# of those are on the IGNORE_NOT_FORWARDED list anyway (host port mappings,
# not api passthroughs), so they get a distinct valid port number instead;
# every other var still gets a real alnum sentinel.
mapfile -t PORT_VARS < <(
  grep -oE '\$\{[A-Z_][A-Z0-9_]*:-[0-9]+\}:[0-9]+' "$COMPOSE_FILE" \
    | grep -oE '^\$\{[A-Z_][A-Z0-9_]*' \
    | sed -E 's/^\$\{//' \
    | sort -u
)
declare -A PORT_VAR_SET=()
for v in "${PORT_VARS[@]}"; do PORT_VAR_SET["$v"]=1; done

RUN_TAG="$(date +%s)-$$"
PORT_COUNTER=19000
declare -A SENTINEL
for var in "${DOCUMENTED_VARS[@]}"; do
  if [ -n "${PORT_VAR_SET[$var]+x}" ]; then
    value="$PORT_COUNTER"
    PORT_COUNTER=$((PORT_COUNTER + 1))
  else
    value="NLSENTINEL_${var}_${RUN_TAG}"
  fi
  SENTINEL["$var"]="$value"
  export "${var}=${value}"
done

echo "==> Rendering: docker compose config (sentinel env, ${#DOCUMENTED_VARS[@]} vars)"
if ! RENDERED_JSON="$(docker compose -f "$COMPOSE_FILE" config --format json 2>"$STDERR_FILE")"; then
  cat "$STDERR_FILE" >&2
  fail "docker compose config failed to render -- see error above"
fi

API_ENV_JSON="$(jq -c '.services.api.environment // empty' <<<"$RENDERED_JSON")"
[ -n "$API_ENV_JSON" ] || fail "rendered config has no .services.api.environment map -- did the api service get renamed?"

# ───────────────────────── 3. forward-direction check ────────────────────────
# Every documented var (minus the reviewed ignore-list) must appear in the
# rendered api environment with EXACTLY its sentinel value.
MISSING_SENTINEL="__NL_KEY_ABSENT__"
FORWARD_FAILURES=0
for var in "${DOCUMENTED_VARS[@]}"; do
  if [ -n "${IGNORE_NOT_FORWARDED[$var]+x}" ]; then
    continue
  fi
  rendered_value="$(jq -r --arg k "$var" --arg missing "$MISSING_SENTINEL" '.[$k] // $missing' <<<"$API_ENV_JSON")"
  expected="${SENTINEL[$var]}"
  if [ "$rendered_value" = "$MISSING_SENTINEL" ]; then
    echo "MISSING: .env.example documents \"${var}\" but it does not appear at all in the rendered api service environment." >&2
    FORWARD_FAILURES=$((FORWARD_FAILURES + 1))
  elif [ "$rendered_value" != "$expected" ]; then
    echo "NOT PASSED THROUGH: \"${var}\" is present but its rendered value (\"${rendered_value}\") does not match the sentinel (\"${expected}\") -- it is not a real \${${var}} passthrough (hardcoded / composed / stale default?)." >&2
    FORWARD_FAILURES=$((FORWARD_FAILURES + 1))
  fi
done

if [ "$FORWARD_FAILURES" -gt 0 ]; then
  fail "${FORWARD_FAILURES} documented .env.example variable(s) do not reach the api container -- see above. If this is intentional, add a reviewed entry (with a reason) to IGNORE_NOT_FORWARDED in scripts/smoke-config-parity.sh; otherwise fix docker-compose.yml's api.environment block."
fi
CHECKED_FORWARD=$(( ${#DOCUMENTED_VARS[@]} - ${#IGNORE_NOT_FORWARDED[@]} ))
echo "==> [forward] PASS -- all ${CHECKED_FORWARD} non-ignored documented variable(s) round-tripped through docker compose config"

# ───────────────────────── 4. reverse-direction check ────────────────────────
# Every ${VAR...} referenced anywhere in the api service's own
# docker-compose.yml stanza must be documented in .env.example (minus the
# reviewed IGNORE_UNDOCUMENTED list) -- otherwise an operator has no way to
# discover a variable the container actually reads.
API_BLOCK="$(awk '
  /^  api:$/ { flag=1 }
  flag && /^  [a-zA-Z_][a-zA-Z0-9_]*:$/ && !/^  api:$/ { exit }
  flag { print }
' "$COMPOSE_FILE")"
[ -n "$API_BLOCK" ] || fail "could not isolate the \"  api:\" service block in ${COMPOSE_FILE} -- did the service get renamed or re-indented?"

mapfile -t FORWARDED_VARS < <(
  printf '%s\n' "$API_BLOCK" \
    | grep -oE '\$\{[A-Z_][A-Z0-9_]*' \
    | sed -E 's/^\$\{//' \
    | sort -u
)

declare -A DOCUMENTED_SET=()
for var in "${DOCUMENTED_VARS[@]}"; do DOCUMENTED_SET["$var"]=1; done

REVERSE_FAILURES=0
for var in "${FORWARDED_VARS[@]}"; do
  if [ -n "${DOCUMENTED_SET[$var]+x}" ]; then
    continue
  fi
  if [ -n "${IGNORE_UNDOCUMENTED[$var]+x}" ]; then
    continue
  fi
  echo "UNDOCUMENTED: docker-compose.yml's api service reads \${${var}} but .env.example never documents \"${var}\" -- an operator has no way to discover it." >&2
  REVERSE_FAILURES=$((REVERSE_FAILURES + 1))
done

if [ "$REVERSE_FAILURES" -gt 0 ]; then
  fail "${REVERSE_FAILURES} variable(s) forwarded to the api container are not documented in .env.example -- see above. Document them (preferred) or add a reviewed entry (with a reason) to IGNORE_UNDOCUMENTED in scripts/smoke-config-parity.sh."
fi
echo "==> [reverse] PASS -- all ${#FORWARDED_VARS[@]} \${VAR}-referenced variable(s) in the api service are documented in .env.example"

echo "==> ALL CONFIG-PARITY ASSERTIONS PASSED"
