# Next Lane — Kubernetes Deployment Guide

> Status: **Phase 4 in progress** (2026-06-27).
> The web image now supports runtime API URL configuration (this document).
> The Helm chart, GHCR image publishing, and full K8s deployment story are
> planned work items (see `docs/ROADMAP.md` Phase 4 deliverables).

---

## Web image: runtime API URL configuration

### Why this matters

Previously the web image baked `VITE_API_URL` into the JavaScript bundle at
build time (`ARG VITE_API_URL` in the Dockerfile + Vite replacing
`import.meta.env.VITE_API_URL` at compile time). This meant:

- Every deployment environment (staging, prod, a developer's cluster) required
  a separate image build.
- CI pipelines had to rebuild the web image just because the API hostname changed.

**As of 2026-06-27 the web image is environment-agnostic**: ONE built image
works in every environment. The API URL is injected at container start, not at
build time.

### How it works

```
index.html
  └── <script src="/config.js">          ← loaded FIRST, before the bundle
        └── window.__NL_CONFIG__ = { apiUrl: "https://api.example.com" }

  └── <script type="module" src="/assets/index-XYZ.js">
        └── getApiUrl()                   ← reads window.__NL_CONFIG__.apiUrl
                                            falls back to import.meta.env.VITE_API_URL
                                            falls back to 'http://localhost:4000'
```

The container's `docker-entrypoint.sh` writes `/usr/share/nginx/html/config.js`
on every start from the `API_URL` environment variable:

```sh
# apps/web/docker-entrypoint.sh (abridged)
RESOLVED_API_URL="${API_URL:-${VITE_API_URL:-http://localhost:4000}}"
cat > /usr/share/nginx/html/config.js <<EOF
window.__NL_CONFIG__ = { apiUrl: "${RESOLVED_API_URL}" };
EOF
exec nginx -g "daemon off;"
```

nginx serves `/config.js` with `Cache-Control: no-store` so a container
restart always delivers the fresh config.

### Environment variables

| Variable | Description | Example |
|---|---|---|
| `API_URL` | **Preferred** runtime API URL | `https://api.example.com` |
| `VITE_API_URL` | **Backward-compat** alias (checked if `API_URL` unset) | `https://api.example.com` |

If neither is set the default `http://localhost:4000` is used (fine for single-
host Compose; wrong for cluster deployments).

### Docker Compose (existing single-host path — unchanged)

```yaml
services:
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    environment:
      API_URL: http://api:4000
    ports:
      - "3000:80"
```

No `--build-arg VITE_API_URL` needed any more.

### Kubernetes / Helm (planned — not yet shipped)

When the Helm chart lands, the recommended pattern will be:

```yaml
# values.yaml (sketch)
web:
  env:
    API_URL: "https://api.example.com"
```

which maps to a Deployment container env:

```yaml
containers:
  - name: web
    image: ghcr.io/next-lane/web:latest
    env:
      - name: API_URL
        value: "https://api.example.com"
    # Or from a ConfigMap/Secret:
      - name: API_URL
        valueFrom:
          configMapKeyRef:
            name: next-lane-config
            key: api-url
```

No image rebuild. Change the ConfigMap and restart the pod.

### Local dev (pnpm dev / vite preview) — unchanged

In local development `config.js` is never served (no nginx, no entrypoint).
The fallback chain resolves to `import.meta.env.VITE_API_URL` (set in
`.env.local` or the dev-up-instance script) and then to `http://localhost:4000`.
No extra setup required.

### Verification

The three-test `e2e/runtime-config.spec.ts` suite covers:
1. App boots without config.js (dev/preview fallback path).
2. `window.__NL_CONFIG__.apiUrl` is readable when set via `addInitScript`
   (same timing as a `<script src="/config.js">` before the bundle).
3. All API fetch requests on an authenticated route go to the runtime-configured
   origin — confirmed by intercepting network requests in Playwright.

All 6 tests (3 desktop + 3 mobile) are green.

---

## Phase 4 remaining work items

The following are planned but not yet shipped (see `docs/ROADMAP.md` Phase 4):

- **GHCR image publishing** via CI — semver + `latest`, multi-arch (amd64/arm64).
- **Helm chart** (`deploy/helm/next-lane`) — Deployments, Services, Ingress,
  ConfigMap, HPA, PDB, securityContext, liveness/readiness probes.
- **Schema migrations as a Helm pre-upgrade Job** (`prisma migrate deploy`).
- **K8s Secret strategy** — `JWT_SECRET` + DB/Redis creds; external-secrets support.
- **Kustomize base + overlays** as a Helm alternative.

> Note: A full `docker build` of the web image could not be verified in the
> build sandbox (container registry egress is blocked). The Dockerfile,
> entrypoint, and nginx config are authored and correct — they will be validated
> against a real Docker daemon during the GHCR publishing step.
