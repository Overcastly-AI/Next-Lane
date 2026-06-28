# Configuration

All configuration is passed to the API and web services via environment
variables. Copy `.env.example` to `.env` and adjust as needed — the defaults
work for a local Docker Compose install.

---

## Required

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | **Required.** The API refuses to start if this is unset or empty. Generate with `openssl rand -hex 32`. Never use the same value across deployments. |

---

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://nextlane:nextlane@db:5432/nextlane?schema=public` | Full Postgres connection string. Inside Docker Compose the host is `db`; for host-side dev use `localhost`. |
| `POSTGRES_USER` | `nextlane` | Postgres user (Docker Compose only — sets the `db` container env). |
| `POSTGRES_PASSWORD` | `nextlane` | Postgres password. Change this in production. |
| `POSTGRES_DB` | `nextlane` | Postgres database name. |
| `POSTGRES_PORT` | `5432` | Host port the `db` container binds to. |

---

## Auth

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | — | See above. Required. |
| `JWT_EXPIRES_IN` | `7d` | JWT access token lifetime. Supports `ms` duration strings (e.g. `1h`, `7d`). |

---

## Redis

Redis is optional in single-node mode but required for multi-replica HA.

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | unset | Redis connection URL (e.g. `redis://redis:6379`). When unset, Socket.io uses an in-memory adapter and webhooks fan out in-process — correct only for a single API pod. Docker Compose sets this automatically. |
| `REDIS_PORT` | `6379` | Host port the `redis` container binds to (Docker Compose only). |

---

## Web and CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:4000` | URL the browser uses to reach the API. Baked into the web image at build time. In Docker Compose this defaults to `http://localhost:4000`. In Kubernetes same-origin mode, leave it empty — the nginx reverse proxy handles routing. |
| `WEB_PORT` | `3000` | Host port the `web` container binds to. |
| `API_PORT` | `4000` | Port the API listens on inside its container. |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated list of browser origins permitted to call the API with credentials. Set to your production web URL in production. |

### Runtime API URL (`window.__NL_CONFIG__`)

In the production Docker image the web entrypoint writes a small config script
(`/config.js`) before nginx starts. This allows the API URL to be overridden at
container-start time without rebuilding the image:

```js
window.__NL_CONFIG__ = { apiUrl: "https://api.example.com" };
```

Priority order for the API URL in the SPA:

1. `window.__NL_CONFIG__.apiUrl` — injected at container start
2. `import.meta.env.VITE_API_URL` — baked at build time
3. `http://localhost:4000` — hardcoded fallback

---

## SMTP / email

When `SMTP_HOST` is set, the API delivers password reset emails via nodemailer.
When unset, the reset link is printed to the API log (development only; not
logged in production for security reasons).

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | unset | SMTP server hostname. Required to enable email delivery. |
| `SMTP_PORT` | `587` | SMTP port. Use `465` for implicit TLS. |
| `SMTP_SECURE` | unset | Set to `true` for TLS-on-connect (port 465). Omit for STARTTLS. |
| `SMTP_USER` | unset | SMTP auth username. Omit for unauthenticated relays. |
| `SMTP_PASS` | unset | SMTP auth password. Omit for unauthenticated relays. |
| `MAIL_FROM` | `Next Lane <no-reply@example.com>` | From address for outbound mail. |
| `RESET_BASE_URL` | `http://localhost:3000` | Base URL used to construct password-reset links. Set to your production web URL. |

**MailHog (local testing):**

```bash
docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

Then set `SMTP_HOST=localhost` and `SMTP_PORT=1025` (no auth needed).

---

## Rate limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `THROTTLE_TTL` | `60000` | Rate-limit window in milliseconds. |
| `THROTTLE_LIMIT` | `100` | Maximum requests per window (global). |
| `THROTTLE_AUTH_LIMIT` | `10` | Maximum requests per window on auth routes (`/auth/login`, `/auth/register`). |
| `RATE_LIMIT_DISABLED` | unset | Set to `true` to disable rate limiting entirely. Useful when many users share one egress IP (corporate NAT), or when running the e2e test suite. Leave off in internet-facing production. |

---

## Webhooks and SSRF protection

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_ALLOW_PRIVATE` | unset | Set to `true` to allow outbound webhooks to reach private/loopback IP ranges. **Security warning:** only enable on a fully private, trusted deployment. Never enable in multi-tenant or internet-facing production. |

---

## File attachments

| Variable | Default | Description |
|----------|---------|-------------|
| `UPLOADS_DIR` | `./uploads` | Filesystem path where uploaded files are stored. In Kubernetes set this to the PVC mount path (e.g. `/data/uploads`). |
| `MAX_FILE_BYTES` | `10485760` (10 MB) | Maximum allowed upload size in bytes. |

---

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Minimum log level. One of: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Use `debug` locally for verbose request detail; `warn` or `error` in production to reduce volume. |

---

## Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `RELEASE_VERSION` | `package.json` version | Application version shown in `/health` responses. Set to the image tag or git SHA at build time. |

Request correlation IDs are always active — every HTTP request gets an
`X-Request-Id` header echoed in the response and stamped on every log line for
that request. No configuration required.

Health endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Readiness — checks DB connectivity; returns 503 if DB is unreachable |
| `GET /health/live` | Liveness — always 200 if the Node process is alive; no DB dependency |

---

## Kubernetes-specific

When deploying with Helm, most variables are set via Helm values rather than a
`.env` file. Key mappings:

| `.env` variable | Helm value |
|----------------|------------|
| `JWT_SECRET` | `secrets.jwtSecret` (or `secrets.existingSecret`) |
| `DATABASE_URL` | `secrets.databaseUrl` or assembled from `externalDatabase.*` |
| `REDIS_URL` | `secrets.redisUrl` or assembled from `externalRedis.*` |
| `CORS_ORIGINS` | `api.env.corsOrigins` |
| `LOG_LEVEL` | `api.env.LOG_LEVEL` |
| `RATE_LIMIT_DISABLED` | `api.env.rateLimitDisabled` |
| SMTP variables | `api.extraEnv` |

See the full Helm values reference in
[`docs/DEPLOY-KUBERNETES.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/docs/DEPLOY-KUBERNETES.md#helm-values-reference).
