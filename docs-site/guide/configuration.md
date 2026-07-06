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

## SSO / OIDC login

Adds a "Continue with `<label>`" button to the login page, backed by any
standards-compliant OIDC provider (Okta, Auth0, Keycloak, Authentik, Google
Workspace, ...). **OFF by default** — the feature only activates when all
three required variables are set; the zero-config self-host path is
unaffected. Users who sign in via SSO for the first time are just-in-time
provisioned (an account is created automatically on first login, matched by
email on subsequent logins).

| Variable | Default | Description |
|----------|---------|-------------|
| `OIDC_ISSUER_URL` | unset | The provider's issuer URL. The API fetches `${OIDC_ISSUER_URL}/.well-known/openid-configuration` to discover the provider's endpoints. Required to enable SSO. |
| `OIDC_CLIENT_ID` | unset | OAuth2/OIDC client id registered with the provider. Required to enable SSO. |
| `OIDC_CLIENT_SECRET` | unset | Client secret. Never logged. Required to enable SSO. |
| `OIDC_BUTTON_LABEL` | `Single sign-on` | Label on the login button ("Continue with `<label>`"). |
| `OIDC_REDIRECT_URI` | derived from the request | Explicit absolute callback URL to register with the provider (e.g. `https://tracker.example.com/api/auth/oidc/callback`). Recommended in production, especially behind a TLS-terminating reverse proxy. |

Register `${OIDC_REDIRECT_URI or <your-api-origin>}/api/auth/oidc/callback` as
an allowed redirect URI with your identity provider.

Security notes: the authorization-code flow uses PKCE + a signed, short-lived,
httpOnly state cookie (CSRF/nonce protected); emails the provider reports as
unverified (`email_verified: false`) are rejected; `GET /api/auth/providers`
is the public, unauthenticated capability probe the frontend uses to decide
whether to render the button — it never assumes a provider is configured.

**Configuration via admin screen:** in addition to environment variables, SSO/OIDC
provider settings can be configured directly in the app via the in-app admin screen
at `/admin/sso` (restricted to instance-level admin users). Environment variables
take precedence; the screen is useful for updating provider credentials without
restarting the API. The first user on a fresh install (or the oldest user on an
existing install) is automatically marked as instance-admin.

### Multiple providers + SAML

The same `/admin/sso` screen also manages an **additional-providers list** —
any number of extra OIDC and/or SAML providers, layered alongside the single
provider above (which keeps working unchanged; no migration needed). Each
additional provider gets its own login button (`/api/auth/sso/<slug>/login`)
and its own optional just-in-time (JIT) provisioning rule: a default
workspace + role a brand-new SSO identity is auto-joined to on first login
(off by default — the account is created but lands with no workspace
membership until an existing member invites it; when set, defaults to the
least-privileged Viewer role unless a higher one is explicitly chosen).

SAML 2.0 providers use the standard SP-initiated flow: register the
identity provider's SSO URL, its entity ID, and its signing certificate (a
PEM-encoded X.509 cert) from the admin screen — no environment variables
required, everything is configured in-app. SAML assertions are always
required to carry a valid signature (never optional); an assertion signed
for a different application, expired, or replayed is rejected.

There is no environment-variable path for additional providers or SAML —
manage them entirely from `/admin/sso`.

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

## GitHub integration (Phase 9 — Developer Graph, v1)

Per-project two-way link to a GitHub repository: pull requests, commits, and
branches whose title/message/name references an issue key (e.g. `NL-123`)
automatically show up on that issue's "Development" section. Configured
per-project from **Project Settings → GitHub** (ADMIN only) — no environment
variables are required to turn the feature on.

**Setup (self-hosted):**

1. In Next Lane, open a project's **Settings → GitHub** section as an ADMIN
   and enter the repository (`owner/repo`) and a GitHub Personal Access Token
   (classic or fine-grained, read access is sufficient for v1 — no outbound
   GitHub API calls are made yet). Save.
2. Copy the generated **Payload URL** and **Secret** shown in the "Webhook
   setup" panel.
3. In GitHub: **Repo → Settings → Webhooks → Add webhook**. Paste the URL and
   secret, set content type to `application/json`, and subscribe to the
   **Push** and **Pull requests** events (or "Send me everything").
4. Open a PR or push a commit whose title/message/branch name contains the
   issue key (e.g. `git commit -m "Fix crash (NL-42)"`) — the link appears on
   the issue within seconds.

**Security:** every inbound delivery is verified against the
`X-Hub-Signature-256` HMAC header using the per-project secret before any
payload is processed; unsigned or mismatched deliveries are rejected with
`401` and never touch the database. The PAT is encrypted at rest (AES-256-GCM)
and is never returned by any API response after it is saved.

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN_ENCRYPTION_KEY` | derived from `JWT_SECRET` | Key used to encrypt stored GitHub PATs at rest. Optional — the zero-config path derives a key from the already-required `JWT_SECRET` so no extra secret is needed to self-host. Set explicitly if you want GitHub token encryption to survive a `JWT_SECRET` rotation. |
| `GITHUB_WEBHOOK_BASE_URL` | derived from the incoming request | Explicit origin used to build the webhook URL shown in Settings (e.g. `https://tracker.example.com`). Recommended in production behind a reverse proxy; otherwise derived from the browser's request. |

---

## GitLab integration

Per-project two-way link to a GitLab project — the GitLab counterpart of the
GitHub integration above. Merge requests, commits, and branches whose
title/message/name references an issue key (e.g. `NL-123`) show up on that
issue's "Development" section. Configured per-project from
**Project Settings → GitLab** (ADMIN only); works with **gitlab.com or any
self-managed GitLab instance** (set the instance base URL in the form —
defaults to `https://gitlab.com`).

**Setup (self-hosted):**

1. In Next Lane, open **Project Settings → GitLab** as an ADMIN and enter the
   GitLab project path, the instance base URL (if self-managed), and a GitLab
   Personal Access Token. Save.
2. Copy the generated **Webhook URL** and **Secret Token** shown in the
   "Webhook setup" panel.
3. In GitLab: **Project → Settings → Webhooks**. Paste the URL, put the secret
   in the **Secret token** field, and enable the **Push events** and
   **Merge request events** triggers.
4. Push a commit or open an MR whose message/title/branch contains the issue
   key — the link appears on the issue within seconds.

**Security:** every inbound delivery's `X-Gitlab-Token` header is compared in
constant time against the per-project secret before any payload is processed;
mismatched deliveries are rejected and never touch the database. The PAT is
encrypted at rest (AES-256-GCM) and never returned by any API response after
it is saved.

| Variable | Default | Description |
|----------|---------|-------------|
| `GITLAB_TOKEN_ENCRYPTION_KEY` | derived from `JWT_SECRET` | Key used to encrypt stored GitLab PATs at rest. Optional — set explicitly if you want GitLab token encryption to survive a `JWT_SECRET` rotation. |
| `GITLAB_WEBHOOK_BASE_URL` | derived from the incoming request | Explicit origin used to build the webhook URL shown in Settings. Recommended in production behind a reverse proxy. |

---

## Gitea integration

The third self-hosted forge, after GitHub and GitLab. Per-project two-way
link to a Gitea repository — pull requests, commits, and branches whose
title/message/name references an issue key (e.g. `NL-123`) show up on that
issue's "Development" section. Configured per-project from **Project
Settings → Gitea** (ADMIN only). Unlike GitHub/GitLab, the **Gitea instance
URL is required** — Gitea has no shared SaaS host, so there is no sensible
default. v1 is deliberately **links-only**: no live PR/CI status and no
auto-transition-on-merge (both are shipped for GitHub/GitLab).

**Setup (self-hosted):**

1. In Next Lane, open **Project Settings → Gitea** as an ADMIN and enter your
   Gitea instance URL (e.g. `https://git.example.com`), the repository path
   (`owner/repo`), and a Gitea access token with repo read scope. Save.
2. Copy the generated **Webhook URL** and **Secret** shown in the "Webhook
   setup" panel.
3. In Gitea: **Repository → Settings → Webhooks → Add Webhook → Gitea**.
   Paste the URL and secret, and subscribe to the **Push** and **Pull
   Request** events.
4. Push a commit or open a PR whose title/message/branch contains the issue
   key — the link appears on the issue within seconds.

**Security:** every inbound delivery's `X-Gitea-Signature` header is verified
as an HMAC-SHA256 of the raw request body (hex-encoded, no `sha256=` prefix)
using the per-project secret before any payload is processed; unsigned or
mismatched deliveries are rejected with `401` and never touch the database.
The access token is encrypted at rest (AES-256-GCM) and is never returned by
any API response after it is saved.

| Variable | Default | Description |
|----------|---------|-------------|
| `GITEA_TOKEN_ENCRYPTION_KEY` | derived from `JWT_SECRET` | Key used to encrypt stored Gitea tokens at rest. Optional — the zero-config path derives a key from the already-required `JWT_SECRET`. Set explicitly if you want Gitea token encryption to survive a `JWT_SECRET` rotation. |
| `GITEA_WEBHOOK_BASE_URL` | derived from the incoming request | Explicit origin used to build the webhook URL shown in Settings (e.g. `https://tracker.example.com`). Recommended in production behind a reverse proxy; otherwise derived from the incoming request's protocol + host. |

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
