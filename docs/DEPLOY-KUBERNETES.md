# Deploying Next Lane on Kubernetes

Next Lane ships two equivalent ways to deploy on a Kubernetes cluster:

- **Helm chart** — `deploy/helm/next-lane` (recommended; toggles, bundled
  datastores, migration hook, HPA/PDB).
- **Kustomize** — `deploy/kustomize` (base + `dev`/`prod` overlays) as a
  Helm-free alternative.

Both deploy the same two workloads — the **API** (NestJS) and the **web** SPA
(nginx) — plus a one-shot **migration Job** (`prisma migrate deploy`). The
single-host `docker compose` path is unchanged and still recommended for small
installs.

> **Verification status:** the chart and manifests are authored and validated to
> the extent the build sandbox allows — every template renders to **valid YAML**
> for both the default (bundled datastore) and external-datastore value sets, and
> all static manifests parse. The `helm` and `kubectl`/`kustomize` binaries could
> **not** be installed in the build sandbox (egress is restricted to package
> registries), so the chart has **not yet been `helm lint`'d or applied to a live
> cluster**. Run `helm lint deploy/helm/next-lane` and a dry-run install on your
> cluster before production use (commands below).

---

## Prerequisites

- A Kubernetes cluster (v1.25+) and `kubectl` configured.
- **Helm 3.12+** (for the Helm path).
- An **Ingress controller** (e.g. ingress-nginx) if you want external access via
  a hostname.
- **cert-manager** with a configured `ClusterIssuer` if you want automatic TLS.
- Container images for the API and web published to a registry your cluster can
  pull (`ghcr.io/next-lane/next-lane-api`, `…-web`, or your mirror). See
  [Building & publishing images](#building--publishing-images).
- For production: a **managed PostgreSQL** (and, for HA, a **managed Redis**).

---

## Quickstart (Helm)

Batteries-included demo on any cluster (bundled PostgreSQL, single API replica,
no Redis):

```bash
helm install next-lane deploy/helm/next-lane \
  --namespace next-lane --create-namespace \
  --set secrets.jwtSecret="$(openssl rand -hex 32)" \
  --set ingress.host=tracker.example.com
```

What this does:

1. Runs `prisma migrate deploy` as a **pre-install Job** before the API starts.
2. Deploys the API + web, a ClusterIP Service each, and an Ingress for the host.
3. Brings up a bundled Bitnami PostgreSQL (dev/demo only).
4. Issues a TLS cert via cert-manager (enabled by default — set
   `ingress.tls.certManager.issuerName` to your issuer, or disable TLS).

No Ingress controller handy? Disable ingress and port-forward:

```bash
helm install next-lane deploy/helm/next-lane -n next-lane --create-namespace \
  --set secrets.jwtSecret="$(openssl rand -hex 32)" \
  --set ingress.enabled=false
kubectl -n next-lane port-forward svc/next-lane-web 8080:80
# open http://localhost:8080
```

> The bundled PostgreSQL password defaults to `nextlane`. **Change
> `postgresql.auth.password`** (or use an external DB) before any real use.

### Validate before installing

```bash
helm lint deploy/helm/next-lane
# Render with defaults and confirm valid manifests:
helm template next-lane deploy/helm/next-lane \
  --set secrets.jwtSecret=dummy | kubectl apply --dry-run=client -f -
# Render the external-datastore (production) shape:
helm template next-lane deploy/helm/next-lane \
  -f deploy/helm/next-lane/values-prod.example.yaml \
  --set secrets.jwtSecret=dummy | kubectl apply --dry-run=client -f -
```

---

## Production install (Helm, external datastores + HA)

Use a managed PostgreSQL + Redis, disable the bundled subcharts, run multiple
replicas, and manage secrets out of band. A worked example lives in
[`deploy/helm/next-lane/values-prod.example.yaml`](../deploy/helm/next-lane/values-prod.example.yaml).

```bash
helm upgrade --install next-lane deploy/helm/next-lane \
  -n next-lane --create-namespace \
  -f deploy/helm/next-lane/values-prod.example.yaml \
  --set secrets.jwtSecret="$(openssl rand -hex 32)"
```

Key production choices it encodes:

- `postgresql.enabled=false`, `redis.enabled=false` → external managed instances
  via `externalDatabase.*` / `externalRedis.*`.
- `api.replicaCount: 3` + `api.autoscaling.enabled` + `api.pdb.enabled`.
- `web.replicaCount: 3` + autoscaling + PDB.
- cert-manager TLS on the real hostname.
- Durable attachments via a `ReadWriteMany` PVC (`api.uploads.persistence`).

---

## Secret management

The chart **never ships a default secret**. You must do one of:

**Option A — let the chart create the Secret (simplest).** Provide values:

```bash
--set secrets.jwtSecret="$(openssl rand -hex 32)"
# DB/Redis creds are derived from the bundled subcharts, or set
# secrets.databaseUrl / externalDatabase.* and secrets.redisUrl / externalRedis.*
```

If `secrets.jwtSecret` is empty (and no `existingSecret`), templating **fails
fast** with a clear error — by design. (The API also refuses to boot without
`JWT_SECRET`.)

**Option B — bring your own Secret (recommended for production).** Manage it with
[external-secrets](https://external-secrets.io/), sealed-secrets, SOPS, or your
cloud secret manager, then point the chart at it:

```bash
--set secrets.existingSecret=next-lane-secrets
```

The referenced Secret must contain these keys:

| Key            | When required                                   |
|----------------|-------------------------------------------------|
| `JWT_SECRET`   | always                                          |
| `DATABASE_URL` | when not using the bundled PostgreSQL subchart  |
| `REDIS_URL`    | when not using the bundled Redis subchart **and** you want HA realtime (optional) |

Example out-of-band Secret:

```bash
kubectl -n next-lane create secret generic next-lane-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=DATABASE_URL="postgresql://nextlane:***@db.internal:5432/nextlane?schema=public&sslmode=require" \
  --from-literal=REDIS_URL="redis://:***@redis.internal:6379"
```

When `secrets.existingSecret` is set the chart creates **no** Secret of its own.

---

## How the browser reaches the API (important)

The web image bakes `VITE_API_URL` at **build time**; the SPA calls
`${VITE_API_URL}/api/...` and connects Socket.io to `${VITE_API_URL}`. The chart
supports two runtime modes via `web.apiMode` — **no application source change
required**:

### `same-origin` (default, recommended)

Build the web image with an **empty** `VITE_API_URL`. The SPA then calls
`/api/...` and `/socket.io` on its **own** origin, and the chart mounts an nginx
config (a ConfigMap) into the web pod that **reverse-proxies** `/api` and
`/socket.io` to the API Service. Result: one image works in every environment,
one Ingress host, no CORS, nothing to rebuild per environment.

### `external`

The SPA talks to the API on a **separate** origin. You must build the web image
with `VITE_API_URL=https://api.example.com` (build-time). Set `web.apiUrl` for
documentation only — it cannot retro-fit an already-built image. Make sure the
API's `CORS_ORIGINS` (auto-derived from `ingress.host`, or set explicitly)
includes the web origin, and expose the API on its own host/Ingress.

> The same-origin default exists specifically to close the long-standing
> "`VITE_API_URL` is baked at build time" gap for multi-environment deploys.

---

## Single-replica vs. HA (Redis)

Next Lane's realtime + webhook-delivery layers are **`REDIS_URL`-gated**:

- **No Redis (single replica):** Socket.io uses the in-memory adapter and
  webhooks fan out in-process. Correct only with **one** API pod. Keep
  `api.replicaCount: 1`, `redis.enabled: false`, and no `externalRedis.host`.
- **Redis present (HA, multi-replica):** Socket.io attaches the
  `@socket.io/redis-adapter` so realtime events broadcast across **all** API
  pods, and webhook delivery runs through a durable **BullMQ** queue (retries +
  backoff). Required before scaling the API past one replica.

Enable Redis by either setting `redis.enabled: true` (bundled Bitnami Redis) or
`externalRedis.host` (managed Redis). Then raise `api.replicaCount` / enable
`api.autoscaling`.

> If you scale `api.replicaCount > 1` **without** Redis, realtime updates will
> only reach clients connected to the same pod, and webhook retries are not
> durable. The chart does not hard-block this, but don't do it.

---

## HA topology overview

```
                          ┌────────────────────────────┐
                          │        Ingress (TLS)        │  cert-manager issues
        Browser  ───────► │  host: tracker.example.com  │  the certificate
                          └──────────────┬──────────────┘
                                         │  (one host; same-origin mode)
                                ┌────────▼─────────┐
                                │   Service: web    │  ClusterIP
                                └────────┬─────────┘
                       ┌─────────────────┼─────────────────┐
                 ┌─────▼─────┐     ┌─────▼─────┐     ┌──────▼────┐
                 │  web pod  │     │  web pod  │     │  web pod  │  nginx:
                 │  (nginx)  │     │  (nginx)  │     │  (nginx)  │  serves SPA +
                 └─────┬─────┘     └─────┬─────┘     └─────┬─────┘  proxies /api,
                       │   /api, /socket.io  ──────────────┘        /socket.io
                                ┌────────▼─────────┐
                                │   Service: api    │  ClusterIP :4000
                                └────────┬─────────┘
                       ┌─────────────────┼─────────────────┐
                 ┌─────▼─────┐     ┌─────▼─────┐     ┌──────▼────┐
                 │  api pod  │     │  api pod  │     │  api pod  │  NestJS
                 └─────┬─────┘     └─────┬─────┘     └─────┬─────┘  /health probes
                       │                 │                 │
          ┌────────────┴───────┐  ┌──────┴───────┐  ┌──────┴───────────┐
          ▼                    ▼  ▼              ▼  ▼                  ▼
   ┌─────────────┐      ┌──────────────┐   ┌──────────────────────────────┐
   │ PostgreSQL  │      │    Redis     │   │  pre-install/upgrade Job:      │
   │ (managed)   │      │  (managed)   │   │  prisma migrate deploy         │
   └─────────────┘      └──────────────┘   └──────────────────────────────┘
                         ▲ Socket.io adapter (cross-pod fan-out)
                         ▲ BullMQ webhook queue (durable, retried)
```

- **HPA** scales `api`/`web` on CPU (and optionally memory).
- **PodDisruptionBudget** keeps a minimum available during node drains.
- **Attachments** (`/app/uploads`): use a `ReadWriteMany` volume (or object
  storage) so multiple API replicas can share them.

---

## Upgrade & migration runbook

Migrations run automatically as a Helm **pre-upgrade hook Job** before the new
API rolls out, so schema changes apply safely (and exactly once) on every
upgrade.

```bash
# 1. Pull / set the new image tags (and review changes).
helm upgrade next-lane deploy/helm/next-lane -n next-lane \
  -f deploy/helm/next-lane/values-prod.example.yaml \
  --set image.api.tag=1.1.0 --set image.web.tag=1.1.0 \
  --reuse-values

# 2. Watch the migration Job, then the rollout.
kubectl -n next-lane get jobs
kubectl -n next-lane logs job/next-lane-migrate
kubectl -n next-lane rollout status deploy/next-lane-api
kubectl -n next-lane rollout status deploy/next-lane-web
```

- **If the migration Job fails**, the upgrade aborts and the **old** API keeps
  running (no partial rollout). Fix the cause and re-run `helm upgrade`.
- **Rollback:** `helm rollback next-lane <REV>`. Note Helm rolls back manifests,
  **not** data — forward-only / backward-compatible migrations are strongly
  recommended (which `prisma migrate deploy` encourages).
- **Zero-downtime:** the API uses rolling updates with `/health`
  readiness/liveness/startup probes; keep ≥2 replicas + a PDB.
- **Disable the auto-migration** (e.g. to run it manually) with
  `--set migrations.enabled=false` and run
  `kubectl -n next-lane create job --from=... ` or a manual Job.

---

## Kustomize (Helm-free alternative)

Plain manifests under `deploy/kustomize`:

```
base/                 # single-replica defaults, external datastores expected
overlays/dev/         # 1 replica, plain-HTTP ingress, demo seed on, :latest tags
overlays/prod/        # 3 replicas, cert-manager TLS, HPA + PDB, pinned tags
```

Apply an overlay (not the base directly):

```bash
# dev
kubectl apply -k deploy/kustomize/overlays/dev

# prod (edit the hostnames/issuer in the overlay first)
kubectl apply -k deploy/kustomize/overlays/prod
```

Before applying, supply a real Secret (the base ships an **obvious placeholder**
`secret.example.yaml` so the kustomization renders):

```bash
kubectl -n next-lane create secret generic next-lane-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=DATABASE_URL="postgresql://nextlane:***@db:5432/nextlane?schema=public"
  # add --from-literal=REDIS_URL=... for HA
```

> Kustomize has **no hook ordering** like Helm. The migration `Job` is applied
> alongside the workloads; wait for it before/while the API rolls:
>
> ```bash
> kubectl apply -k deploy/kustomize/overlays/prod
> kubectl -n next-lane wait --for=condition=complete job/next-lane-migrate --timeout=600s
> ```
>
> (Delete a prior completed Job first: `kubectl -n next-lane delete job
> next-lane-migrate --ignore-not-found`.)

Render locally without applying:

```bash
kubectl kustomize deploy/kustomize/overlays/prod | less
```

The Kustomize base expects **external** datastores (it does not bundle Postgres/
Redis). For a batteries-included quick-start, prefer the Helm chart.

---

## Helm values reference

| Key | Default | Description |
|-----|---------|-------------|
| `nameOverride` / `fullnameOverride` | `""` | Override generated resource names. |
| `commonLabels` / `commonAnnotations` | `{}` | Applied to every resource. |
| `image.pullSecrets` | `[]` | Image pull secrets for private registries. |
| `image.api.repository` | `ghcr.io/next-lane/next-lane-api` | API image repo. |
| `image.api.tag` | `""` (→ `appVersion`) | API image tag. |
| `image.api.pullPolicy` | `IfNotPresent` | API pull policy. |
| `image.web.repository` | `ghcr.io/next-lane/next-lane-web` | Web image repo. |
| `image.web.tag` | `""` (→ `appVersion`) | Web image tag. |
| `image.web.pullPolicy` | `IfNotPresent` | Web pull policy. |
| `api.replicaCount` | `1` | API replicas. **Keep 1 unless Redis is enabled.** |
| `api.port` | `4000` | API container port (`API_PORT`). |
| `api.env.NODE_ENV` | `production` | Node env. |
| `api.env.LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error`/`fatal`. |
| `api.env.JWT_EXPIRES_IN` | `7d` | JWT lifetime. |
| `api.env.corsOrigins` | `""` (→ `https://<ingress.host>`) | `CORS_ORIGINS` allowlist. |
| `api.env.resetBaseUrl` | `""` (→ `https://<ingress.host>`) | Password-reset link base. |
| `api.env.throttleTtl` / `throttleLimit` / `throttleAuthLimit` | `""` (API defaults) | Rate-limit tuning. |
| `api.env.rateLimitDisabled` | `false` | Disable rate limiting (avoid in prod). |
| `api.env.webhookAllowPrivate` | `false` | Allow webhooks to private IPs (**SSRF risk**; never on shared/internet-facing). |
| `api.env.autoSeed` | `false` | Seed demo data on boot (API pod runs the server directly, so this mainly matters for the bundled-demo flow). |
| `api.extraEnv` / `api.extraEnvFrom` | `[]` | Extra env / envFrom (e.g. `SMTP_*`). |
| `api.resources` | 100m/256Mi → 1/512Mi | Requests/limits. |
| `api.probes.*` | enabled | Liveness/readiness/startup on `/health`. |
| `api.podSecurityContext` | runAsNonRoot, uid 1000, RuntimeDefault | Pod security. |
| `api.securityContext` | no-priv-esc, **readOnlyRootFilesystem**, drop ALL caps | Container security. |
| `api.uploads.mountPath` | `/app/uploads` | Attachment dir. |
| `api.uploads.persistence.enabled` | `false` (emptyDir) | Durable attachments (PVC). |
| `api.uploads.persistence.size` / `storageClass` / `accessModes` | 5Gi / `""` / RWO | PVC settings (use RWX for multi-replica). |
| `api.service.type` / `port` | `ClusterIP` / `4000` | API Service. |
| `api.autoscaling.enabled` | `false` | API HPA. |
| `api.autoscaling.minReplicas` / `maxReplicas` | `2` / `6` | HPA bounds. |
| `api.autoscaling.targetCPUUtilizationPercentage` | `70` | CPU target. |
| `api.autoscaling.targetMemoryUtilizationPercentage` | `""` | Memory target (optional). |
| `api.pdb.enabled` | `false` | API PodDisruptionBudget. |
| `api.pdb.minAvailable` / `maxUnavailable` | `1` / `""` | PDB policy (set one). |
| `api.nodeSelector` / `tolerations` / `affinity` / `topologySpreadConstraints` | `{}`/`[]` | Scheduling. |
| `web.replicaCount` | `2` | Web replicas. |
| `web.port` | `80` | Web container port. |
| `web.apiMode` | `same-origin` | `same-origin` (nginx proxies /api) or `external`. |
| `web.apiUrl` | `""` | Informational in `external` mode (build-time value). |
| `web.resources` | 25m/32Mi → 200m/128Mi | Requests/limits. |
| `web.probes.*` | enabled | Liveness/readiness on `/`. |
| `web.podSecurityContext` / `securityContext` | runAsNonRoot uid 101, readOnlyRootFS, drop ALL | Security. |
| `web.service.type` / `port` | `ClusterIP` / `80` | Web Service. |
| `web.autoscaling.*` | disabled | Web HPA. |
| `web.pdb.*` | disabled | Web PDB. |
| `ingress.enabled` | `true` | Create the Ingress. |
| `ingress.className` | `nginx` | IngressClass. |
| `ingress.host` | `tracker.example.local` | Public hostname. |
| `ingress.extraHosts` | `[]` | Additional hosts → web. |
| `ingress.path` / `pathType` | `/` / `Prefix` | Routing. |
| `ingress.annotations` | `{}` | Extra Ingress annotations. |
| `ingress.tls.enabled` | `true` | Enable TLS. |
| `ingress.tls.certManager.enabled` | `true` | Add cert-manager annotation. |
| `ingress.tls.certManager.issuerName` | `letsencrypt-prod` | Issuer name. |
| `ingress.tls.certManager.issuerKind` | `ClusterIssuer` | `ClusterIssuer` or `Issuer`. |
| `ingress.tls.secretName` | `next-lane-tls` | Cert Secret name. |
| `secrets.existingSecret` | `""` | Use a Secret you manage (no Secret created). |
| `secrets.jwtSecret` | `""` | **Required** unless `existingSecret`. No default. |
| `secrets.databaseUrl` | `""` | Full external `DATABASE_URL` (overrides assembled). |
| `secrets.redisUrl` | `""` | Full external `REDIS_URL`. |
| `externalDatabase.host`/`port`/`user`/`database`/`password`/`params` | `""`/5432/nextlane/nextlane/`""`/`schema=public` | Assemble `DATABASE_URL` from parts. |
| `externalRedis.host`/`port`/`password` | `""`/6379/`""` | Assemble `REDIS_URL` (empty host = no Redis). |
| `migrations.enabled` | `true` | Run `prisma migrate deploy` as a pre-install/upgrade hook Job. |
| `migrations.hookWeight` | `-5` | Hook ordering. |
| `migrations.hookDeletePolicy` | `before-hook-creation,hook-succeeded` | Hook cleanup. |
| `migrations.backoffLimit` / `activeDeadlineSeconds` | `3` / `600` | Job retry / timeout. |
| `migrations.resources` | 100m/256Mi → 1/512Mi | Job resources. |
| `serviceAccount.create` / `name` / `annotations` | `true` / `""` / `{}` | ServiceAccount (IRSA/Workload Identity via annotations). |
| `postgresql.enabled` | `true` | Bundle Bitnami PostgreSQL (demo only). |
| `postgresql.auth.username`/`password`/`database` | nextlane/nextlane/nextlane | **Change the password.** |
| `postgresql.primary.persistence.*` | enabled, 8Gi | PG storage. |
| `redis.enabled` | `false` | Bundle Bitnami Redis (enables HA realtime). |
| `redis.architecture` | `standalone` | `standalone` or `replication`. |
| `redis.auth.enabled` / `password` | `false` / `""` | Redis auth. |
| `redis.master.persistence.*` | enabled, 2Gi | Redis storage. |

> The Bitnami `postgresql`/`redis` subcharts expose many more values; see their
> upstream docs. Fetching them needs network access to the Bitnami repo
> (`helm dependency update`); in air-gapped clusters vendor the `.tgz` into
> `charts/` or use external datastores (no fetch required).

---

## Building & publishing images

The repo Dockerfiles build the production images from the monorepo root:

```bash
# API
docker build -f apps/api/Dockerfile -t ghcr.io/next-lane/next-lane-api:1.0.0 .

# Web — same-origin mode: build with EMPTY VITE_API_URL
docker build -f apps/web/Dockerfile \
  --build-arg VITE_API_URL= \
  -t ghcr.io/next-lane/next-lane-web:1.0.0 .

# Web — external mode: bake the API origin
docker build -f apps/web/Dockerfile \
  --build-arg VITE_API_URL=https://api.example.com \
  -t ghcr.io/next-lane/next-lane-web:1.0.0 .
```

Push to your registry and reference the tags via `image.api.tag` /
`image.web.tag` (Helm) or the `images:` block (Kustomize). Automated multi-arch
GHCR publishing via CI is a separate Phase 4 deliverable (see
`docs/ROADMAP.md`).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `helm install` errors: *secrets.jwtSecret is required* | Set `--set secrets.jwtSecret=...` or `secrets.existingSecret`. |
| API pods `CrashLoopBackOff`, logs mention `JWT_SECRET` | Secret missing/empty; check the Secret keys. |
| API can't connect to DB | Wrong `DATABASE_URL` / network policy / external DB firewall. Check the migration Job logs first. |
| Realtime updates only reach some clients | Multi-replica API without Redis. Enable `redis.enabled` or `externalRedis.host`. |
| 404/CORS calling the API from the SPA | `web.apiMode: external` but image built with empty `VITE_API_URL` (or vice-versa); mismatch with `CORS_ORIGINS`. |
| WebSocket disconnects | Ingress not proxying WS; for a split API ingress add `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"`. |
| Attachments vanish after restart/scale | `api.uploads.persistence.enabled=false` (emptyDir) or RWO PVC with >1 replica; use a RWX volume. |
