# Self-Hosting

Next Lane ships two production-ready deployment paths: **Docker Compose** for
single-host installs, and **Kubernetes** (Helm chart or Kustomize) for clustered
or highly-available deployments.

---

## Docker Compose (recommended for small installs)

The `docker-compose.yml` at the repo root defines four services:

| Service | Image | Role |
|---------|-------|------|
| `db` | postgres:16-alpine | PostgreSQL database |
| `redis` | redis:7-alpine | Socket.io adapter + BullMQ queue |
| `api` | Built from `apps/api/Dockerfile` | NestJS REST + WebSocket API |
| `web` | Built from `apps/web/Dockerfile` | React SPA served by nginx |

The API runs `prisma migrate deploy` on every boot before starting, so schema
migrations apply automatically on upgrade.

### Production hardening checklist (Docker Compose)

- **Set a strong `JWT_SECRET`** — the API refuses to start without one.
- **Change or disable the demo seed** — set `AUTO_SEED=false` in `.env` or
  remove the seed step from `apps/api/docker-entrypoint.sh` before exposing the
  instance externally. The demo account (`demo@nextlane.dev` / `nextlane`) is a
  known credential.
- **Terminate TLS at a reverse proxy** — nginx, Caddy, or Traefik in front of
  port 3000 (web) and optionally 4000 (API, if you expose it separately).
  The web container's nginx config is intended to sit behind a TLS-terminating
  proxy.
- **Set `CORS_ORIGINS`** to the exact origin(s) you serve the web app from.
- **Configure SMTP** (`SMTP_HOST` etc.) so password reset emails are delivered.
  Without SMTP configured, reset links are printed to the API log — which is
  fine for development but not for production.
- **Restrict port exposure** — in production you typically only expose port 80/443
  on the proxy; set `POSTGRES_PORT` and `REDIS_PORT` to bind on `127.0.0.1` only
  or remove their host-port mappings entirely.

### Upgrading

```bash
git pull
docker compose up -d --build
```

Migrations run automatically on API boot. Review `CHANGELOG.md` before upgrading
for any breaking configuration changes.

### Backups (PostgreSQL)

```bash
# Dump
docker compose exec db pg_dump -U nextlane nextlane > backup-$(date +%F).sql

# Restore (into a fresh container with an empty volume)
docker compose exec -T db psql -U nextlane nextlane < backup-2026-01-01.sql
```

Schedule this with cron or a systemd timer. The named volume `postgres-data`
is the only stateful asset (plus the `uploads` volume for file attachments).

---

## Kubernetes — Helm chart

The Helm chart at `deploy/helm/next-lane` is the recommended path for
Kubernetes. It includes:

- Pre-install/upgrade migration Job (`prisma migrate deploy`)
- HorizontalPodAutoscaler and PodDisruptionBudget for API and web
- cert-manager Ingress for automatic TLS
- Optional bundled Bitnami PostgreSQL and Redis subcharts
- Security contexts (non-root, read-only root filesystem, dropped capabilities)
- SBOM and Trivy scan on every published image

### Quickstart (Helm, single cluster node)

```bash
helm install next-lane deploy/helm/next-lane \
  --namespace next-lane --create-namespace \
  --set secrets.jwtSecret="$(openssl rand -hex 32)" \
  --set ingress.host=tracker.example.com
```

### Production (external PostgreSQL + Redis, HA)

```bash
helm upgrade --install next-lane deploy/helm/next-lane \
  -n next-lane --create-namespace \
  -f deploy/helm/next-lane/values-prod.example.yaml \
  --set secrets.jwtSecret="$(openssl rand -hex 32)"
```

`values-prod.example.yaml` disables the bundled datastores and configures three
API replicas with autoscaling and PDB. Review it before use and adjust hostnames,
resource limits, and storage classes.

### Secret management

The chart **never ships a default secret**. Provide one of:

- `--set secrets.jwtSecret=...` (chart creates the Kubernetes Secret)
- `--set secrets.existingSecret=<name>` (bring your own Secret, managed via
  external-secrets, sealed-secrets, SOPS, or your cloud secret manager)

The referenced Secret must contain `JWT_SECRET`, and optionally `DATABASE_URL`
and `REDIS_URL` when not using the bundled subcharts.

### Upgrading (Helm)

```bash
helm upgrade next-lane deploy/helm/next-lane -n next-lane \
  -f deploy/helm/next-lane/values-prod.example.yaml \
  --set image.api.tag=1.1.0 --set image.web.tag=1.1.0 \
  --reuse-values
```

The pre-upgrade migration Job runs before the new API pods roll out, so schema
changes apply exactly once.

### Kubernetes — Kustomize (Helm-free)

```bash
# dev overlay
kubectl apply -k deploy/kustomize/overlays/dev

# prod overlay (edit hostnames/issuer in the overlay first)
kubectl apply -k deploy/kustomize/overlays/prod
kubectl -n next-lane wait --for=condition=complete job/next-lane-migrate --timeout=600s
```

Kustomize has no hook ordering, so wait explicitly for the migration Job before
the API finishes rolling.

### HA and Redis

Multi-replica API deployments require Redis:

- Without Redis: Socket.io uses an in-memory adapter. Only safe with one API
  pod.
- With Redis: `@socket.io/redis-adapter` fans out realtime events across all
  pods; BullMQ handles durable webhook delivery with retries.

Enable via `redis.enabled: true` (bundled) or `externalRedis.host` (managed),
then raise `api.replicaCount`.

Full Kubernetes reference: [`docs/DEPLOY-KUBERNETES.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/docs/DEPLOY-KUBERNETES.md)

---

## Reverse proxy and TLS

Next Lane does not terminate TLS itself. Terminate it at a reverse proxy
in front of the web container (port 3000 / 80):

**nginx example:**

```nginx
server {
    listen 443 ssl http2;
    server_name tracker.example.com;

    ssl_certificate     /etc/ssl/certs/tracker.pem;
    ssl_certificate_key /etc/ssl/private/tracker.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (Socket.io)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

**Caddy example:**

```Caddyfile
tracker.example.com {
    reverse_proxy localhost:3000
}
```

Caddy handles TLS automatically via Let's Encrypt.

In the Helm chart, TLS is handled by the cert-manager Ingress annotation
(`ingress.tls.certManager.enabled: true`).
