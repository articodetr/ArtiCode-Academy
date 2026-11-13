# syntax=docker/dockerfile:1
#
# ArtiCode Academy — the `web` image (MOD-17-T02, D-R88, D-R89, ADR-072).
#
# Built on the server from a git tag, with the repository root as the build
# context (the root .dockerignore lets in only what the frontend build and the
# Caddyfile need — never an .env file, node_modules, dist or .git):
#
#   docker build -f deploy/web.Dockerfile --target runtime -t articode-web:<tag> .
#
# Targets
#   build    the Vite build of frontend/ exactly as committed — `npm ci`, then
#            `npm run build` (`tsc -b && vite build`); nothing in frontend/ is
#            changed for the image. VITE_API_BASE_URL is empty: the UI calls
#            /api/* on its own origin (frontend/src/api/client.ts).
#   runtime  (the default) Caddy serving that dist from /srv with
#            deploy/Caddyfile: one origin per academy — the UI on `/` with the SPA
#            fallback to index.html, the API on `/api/*` through reverse_proxy to
#            API_UPSTREAM (default api:3000) — and automatic HTTPS for the
#            academy's domain (SITE_ADDRESS, default http://localhost = plain HTTP
#            for a local trial). Runs as the non-root user `web` (uid 10001): it
#            binds ports 80 and 443 because Docker sets
#            net.ipv4.ip_unprivileged_port_start=0 in every container network
#            namespace (bridge networks — not with `network_mode: host`), so it
#            needs no capability at all and runs with `cap_drop: [ALL]` and
#            `no-new-privileges`. Certificates and ACME state live in /data
#            (mount a volume there — caddy_data, MOD-17-T03), autosaved config in
#            /config; both belong to `web`.
#
# Nothing secret is baked in: SITE_ADDRESS and API_UPSTREAM come from the
# environment at run time.
# TEST-201: deploy/tests/web-image.test.mjs.

# Node of .nvmrc (S1-R01); frontend/ installs with the npm Node ships (npm 10).
ARG NODE_VERSION=22.20.0
# An exact Caddy 2 release (2.11.9 — 2026-11-05).
ARG CADDY_VERSION=2.11.9

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
WORKDIR /app

# Dependencies first, so this layer is reused while the lockfile is unchanged.
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY frontend/ ./
RUN VITE_API_BASE_URL= npm run build

# ---------------------------------------------------------------------------
FROM caddy:${CADDY_VERSION}-alpine AS runtime
RUN addgroup -S -g 10001 web \
 && adduser -S -D -H -u 10001 -G web -h /srv -s /sbin/nologin web \
 && chown -R web:web /data /config
# Owned by root and read-only for the process user.
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
USER web
# A Caddyfile that does not parse or provision fails the build, not the start.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
EXPOSE 80 443 443/udp
# Liveness only: the loopback-only site of the Caddyfile (127.0.0.1:2020).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:2020/"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
