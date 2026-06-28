# Troubleshooting

Diagnosis steps for the most common issues. Always start with the logs:

```bash
docker compose logs api    # API errors and startup messages
docker compose logs db     # Postgres startup / connection issues
docker compose logs web    # nginx access/error log
docker compose logs        # all services together
```

---

## The API container won't start

**Symptom:** `docker compose up` exits immediately for the `api` service; logs
show an error about `JWT_SECRET`.

**Fix:** Set `JWT_SECRET` in `.env`:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

---

## Port already in use

**Symptom:** `docker compose up` fails with `bind: address already in use` for
port 3000 or 4000.

**Fix:** Change the port in `.env`:

```bash
WEB_PORT=3001
API_PORT=4001
VITE_API_URL=http://localhost:4001
```

Restart: `docker compose up -d --build`.

---

## Cannot connect to the database

**Symptom:** API logs show `ECONNREFUSED` or `Connection refused` connecting to
PostgreSQL.

**Common causes:**

1. The `db` container is not healthy yet. Check `docker compose ps` — the `db`
   service should show `healthy`. The API waits for the healthcheck before
   starting, but if Postgres takes longer than usual the API may still retry.
2. `DATABASE_URL` is wrong. In Docker Compose the hostname is `db`, not
   `localhost`. Check `docker compose logs api | grep DATABASE_URL`.
3. Postgres volume is corrupt. Try `docker compose down -v && docker compose up -d --build`.

---

## Database migration fails on startup

**Symptom:** API logs show `Error: P1001` or `migrate deploy` failing.

**Fix:**

```bash
# Check what migrations are pending
docker compose exec api npx prisma migrate status

# If the DB is in a bad state, reset it (destroys all data)
docker compose down -v
docker compose up -d --build
```

---

## Realtime updates not working (cards don't move across tabs)

**Symptom:** Moving a card in one browser tab does not update in another tab
without refreshing.

**Common causes:**

1. The WebSocket connection is being blocked by a reverse proxy that does not
   support HTTP upgrade. Add the `Upgrade` / `Connection` headers and set a long
   `proxy_read_timeout` (see [Self-Hosting](./self-hosting#reverse-proxy-and-tls)).
2. Running more than one API replica without Redis. Multi-replica Socket.io
   requires `REDIS_URL` to be set (see [Configuration](./configuration#redis)).
3. A firewall or VPN is blocking WebSocket connections.

Check the browser console (`Network` tab → `WS` filter) to confirm the
WebSocket connection is established.

---

## Email (password reset) not being sent

**Symptom:** Forgot Password works in the UI but the user never receives an
email.

**Fix:** Configure SMTP by setting `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, and `MAIL_FROM` in `.env` (see [Configuration](./configuration#smtp--email)).

**Without SMTP (development):** the reset link is printed to the API log:

```bash
docker compose logs api | grep -i "password reset"
```

**Note:** In production mode (`NODE_ENV=production`) the link is **not** logged
for security. Configure SMTP before exposing the instance publicly.

---

## Images (logos, attachments) not showing after restart

**Symptom:** Uploaded logos or file attachments show broken image links after
restarting or rebuilding the containers.

**Cause:** The `uploads` Docker volume was deleted (e.g. `docker compose down -v`).

**Fix:** Never use `docker compose down -v` in production — it destroys all
named volumes including the database and uploads. Use `docker compose down`
(without `-v`) to stop and preserve data.

For Kubernetes: use a PVC with `accessModes: ReadWriteMany` (or ReadWriteOnce
if you have one API replica) with `api.uploads.persistence.enabled: true` in
Helm values.

---

## CSP errors in browser console

**Symptom:** The browser console shows `Content Security Policy` violations
(e.g. blocked font, script, or connect-src).

**Cause:** The web container's nginx serves a strict CSP. Common sources:

- **Fonts:** Use only self-hosted fonts. Adding external font CDN URLs (Google
  Fonts, etc.) without updating the nginx config will be blocked.
- **API calls:** If the API is on a different origin and you are not using
  same-origin mode, the `connect-src` directive must include the API origin.
  In Docker Compose or Kubernetes same-origin mode this is handled automatically.

**Fix:** In Docker Compose, check `apps/web/nginx.conf` for the `Content-Security-Policy`
header and update `connect-src` to include your API URL if you are running in
external mode.

---

## The web app loads but shows "Failed to fetch" errors

**Symptom:** The UI loads but all API calls fail with a network error.

**Common causes:**

1. `VITE_API_URL` was not set correctly when the web image was built — it is
   baked at build time.
2. The API container is not running (`docker compose ps`).
3. A firewall is blocking port 4000 between the browser and the host.
4. In Kubernetes same-origin mode: the nginx proxy in the web pod cannot reach
   the `api` Service. Check `kubectl -n next-lane logs deploy/next-lane-web`.

**Fix for Docker Compose:**

```bash
# Confirm the API is running and healthy
docker compose ps
curl http://localhost:4000/health

# Rebuild with the correct API URL
echo "VITE_API_URL=http://localhost:4000" >> .env
docker compose up -d --build
```

---

## Planning poker votes are not syncing

**Symptom:** Poker session opens but votes from other participants do not appear
in real time.

**Cause:** WebSocket connection issue (see "Realtime updates not working" above).

---

## Helm install fails with "secrets.jwtSecret is required"

**Fix:**

```bash
helm install next-lane deploy/helm/next-lane \
  --set secrets.jwtSecret="$(openssl rand -hex 32)" \
  ...
```

Or create a Kubernetes Secret and set `secrets.existingSecret=<name>`.

---

## Kubernetes: API pods crash on boot

**Symptom:** `kubectl -n next-lane logs deploy/next-lane-api` shows `JWT_SECRET`
missing or DB connection errors.

**Fix:** Verify the Secret exists and contains the right keys:

```bash
kubectl -n next-lane get secret next-lane-secrets \
  -o jsonpath='{.data}' | \
  python3 -c "
import sys, json, base64
d = json.load(sys.stdin)
for k, v in d.items():
    print(k, '=', base64.b64decode(v).decode())
"
```

---

## Kubernetes: realtime updates only reach some clients

**Cause:** Multiple API replicas without Redis.

**Fix:** Enable Redis and set `api.replicaCount > 1` only after Redis is
configured. See [Self-Hosting](./self-hosting#ha-and-redis).

---

## How to completely reset a development instance

```bash
docker compose down -v       # stop and remove all volumes (deletes all data)
docker compose up -d --build # fresh start with seed data
```

This is destructive — all database records and uploads are permanently deleted.
