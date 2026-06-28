# Security Policy

Next Lane is a self-hosted application that holds your team's project data, so we
take security seriously and welcome responsible disclosure.

## Supported versions

Next Lane is pre-1.0 and under active development. Security fixes are applied to the
**latest `main`** and the most recent release. Please run a current version before
reporting an issue.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately via one of:

- **GitHub Security Advisories** — use the repository's
  [**Report a vulnerability**](https://github.com/Overcastly-AI/Next-Lane/security/advisories/new)
  button (preferred), which keeps the report private until a fix is ready.

When reporting, please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (proof-of-concept if possible).
- Affected version / commit, and your environment (Docker, Kubernetes, etc.).

We aim to acknowledge reports within **a few business days** and will keep you
updated on remediation progress. We're happy to credit reporters in the release
notes unless you prefer to remain anonymous.

## Scope

In scope: the Next Lane application (API, web, deployment manifests in this repo).

Out of scope: vulnerabilities in third-party dependencies (please report those
upstream, though a heads-up is appreciated), and issues that require a
misconfigured or intentionally insecure deployment.

## Hardening notes for self-hosters

Next Lane ships with security defaults, but a safe deployment is a shared
responsibility. At minimum:

- **Always set a strong, unique `JWT_SECRET`** — the API refuses to start without
  one, and there is no built-in default.
- **Change the seeded demo credentials** (`demo@nextlane.dev`) before exposing an
  instance to anyone, or disable seeding in production.
- **Terminate TLS** in front of the app (reverse proxy or the Helm chart's
  cert-manager Ingress).
- **Restrict `CORS_ORIGINS`** to the origins you actually serve.
- Webhook delivery is SSRF-guarded by default; only set `WEBHOOK_ALLOW_PRIVATE`
  if you intentionally need to reach private network targets.

See [`docs/DEPLOY-KUBERNETES.md`](./docs/DEPLOY-KUBERNETES.md) for production
deployment and secret-management guidance.
