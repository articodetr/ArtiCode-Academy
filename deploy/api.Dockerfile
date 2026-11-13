# syntax=docker/dockerfile:1
#
# ArtiCode Academy — the `api` image (MOD-17-T01, D-R88, ADR-072).
#
# Built on the server from a git tag, with the repository root as the build
# context (the root .dockerignore lets in only what the backend needs — never an
# .env file, node_modules, dist or .git):
#
#   docker build -f deploy/api.Dockerfile --target runtime -t articode-api:<tag> .
#   docker build -f deploy/api.Dockerfile --target tools   -t articode-api-tools:<tag> .
#
# Targets
#   build    compiles the backend: npm 11 (KI-045), `npm ci`, `prisma generate`, `nest build`.
#   tools    the build stage as a non-root image with the Prisma CLI and tsx — the
#            one-shot `migrate` service (migrate deploy, then the idempotent seed,
#            D-R91) and the first-admin command (`npm run auth:bootstrap-admin`).
#   runtime  production dependencies only (`--omit=dev --omit=optional` — the Prisma
#            CLI and TypeScript are optional peers of runtime packages, so plain
#            `--omit=dev` would keep them), `dist`, `package.json` (the health
#            endpoint reads its version) and `prisma/migrations` (read-only — the
#            schema check of MOD-17-T03); non-root; `node dist/main.js`.
#
# Nothing secret is baked in: every setting comes from the environment at run
# time (`NODE_ENV=production` requires JWT_SECRET and DATABASE_URL — env.schema.ts).
# TEST-200: deploy/tests/api-image.test.mjs.

# Node of .nvmrc (S1-R01) on Debian bookworm: glibc, for the argon2 prebuild.
ARG NODE_VERSION=22.20.0
# Node 22.20 ships npm 10.9.3, which rejects the committed lockfile (KI-045).
ARG NPM_VERSION=11.16.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS build
ARG NPM_VERSION
# openssl: the Prisma CLI detects libssl to pick its schema-engine binary.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --global "npm@${NPM_VERSION}"

# Dependencies first, so this layer is reused while the lockfile is unchanged.
# Scripts are skipped here (the project's postinstall needs the sources) and run
# right after for the three packages that need them: argon2 (checks its
# prebuild), esbuild (tsx) and @prisma/engines (downloads the schema engine
# that `migrate deploy` runs).
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts \
 && npm rebuild argon2 esbuild @prisma/engines

COPY backend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
FROM build AS tools
USER node
# The one-shot migrate service (D-R91); compose may override the command.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# ---------------------------------------------------------------------------
FROM base AS prod-deps
ARG NPM_VERSION
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --global "npm@${NPM_VERSION}" \
 && npm ci --omit=dev --omit=optional --ignore-scripts

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000
# Owned by root and read-only for the process user.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma/migrations ./prisma/migrations
USER node
EXPOSE 3000
# Liveness only; readiness (database and schema) is the compose health check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
