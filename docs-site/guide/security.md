# Security

Next Lane is maintained by [Overcastly AI](https://overcastly.com).

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately via GitHub Security Advisories — this keeps the report
confidential until a fix is ready:

> https://github.com/Overcastly-AI/Next-Lane/security/advisories/new

Use the **Report a vulnerability** button on that page. The maintainers will
be notified immediately.

When reporting, please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (proof-of-concept if possible).
- The affected version / commit, and your deployment environment (Docker
  Compose, Kubernetes, local dev).

We aim to acknowledge reports within a few business days and will keep you
updated on remediation progress. We are happy to credit reporters in release
notes unless you prefer to remain anonymous.

---

## Scope

In scope: the Next Lane application (API, web, deployment manifests in this
repo).

Out of scope: vulnerabilities in third-party dependencies (please report those
upstream, though a heads-up is appreciated), and issues that require a
misconfigured or intentionally insecure deployment.

---

## Hardening notes for self-hosters

- **Always set a strong, unique `JWT_SECRET`** — the API refuses to start
  without one.
- **Change the seeded demo credentials** (`demo@nextlane.dev` / `nextlane`)
  before exposing an instance externally.
- **Terminate TLS** at a reverse proxy (nginx, Caddy, Traefik) or via the Helm
  chart's cert-manager Ingress.
- **Restrict `CORS_ORIGINS`** to the origins you actually serve.
- **SSRF guard is enabled by default** for outbound webhooks and for outbound
  GitHub/GitLab status polling, pinned against DNS-rebinding — only set
  `WEBHOOK_ALLOW_PRIVATE=true` on a fully private, trusted deployment.
- **Personal Access Token scopes are enforced on every route** — a token
  restricted to, say, `issues:read` cannot touch projects, workspaces,
  reports, or any other resource family it wasn't granted (20 scopes total;
  see [Connecting](./agents-mcp#connecting) in the AI Agents & MCP chapter).
  Re-check any narrowly scoped agent tokens minted before this hardening
  pass — they may need `projects:read`/`workspaces:read` added.
- **Zero high-severity CVEs in production dependencies** — `pnpm audit --prod`
  reports none as of this writing; re-run it yourself before deploying, since
  the dependency tree changes over time.

Full details in
[`SECURITY.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/SECURITY.md).
