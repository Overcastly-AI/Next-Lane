# Next Lane web — production image (static build served by nginx).
# Built from the monorepo root context.
#
# Runtime configuration (NEW — Phase 4 prerequisite):
#   The API URL is NO LONGER baked into the bundle at build time.
#   Instead, `docker-entrypoint.sh` writes /usr/share/nginx/html/config.js on
#   every container start from the API_URL env var, which index.html loads as
#   the very first script tag.  This lets ONE built image serve any environment.
#
#   Set at runtime (e.g. docker run / Helm values / Compose .env):
#     API_URL=https://api.example.com
#   or, for backward-compat with existing deployments:
#     VITE_API_URL=https://api.example.com
#   Fallback when neither is set: http://localhost:4000

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/web apps/web
# VITE_API_URL is no longer used to bake the URL into the bundle.
# The ARG/ENV below are kept solely for backward-compat (in case a CI pipeline
# still passes --build-arg VITE_API_URL=...); the value is intentionally empty
# so the runtime fallback chain in config.ts takes over at startup.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @next-lane/web build

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 80
# Entrypoint writes config.js from API_URL / VITE_API_URL env vars, then
# exec's nginx so the container still responds to signals correctly.
ENTRYPOINT ["/docker-entrypoint.sh"]
