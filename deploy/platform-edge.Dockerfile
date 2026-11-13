# syntax=docker/dockerfile:1
#
# ArtiCode platform — the `edge` image (MOD-18-T06, D-R104): Caddy in front of
# the platform API, the only service of deploy/compose.platform.yaml with a
# published port.
#
# Built with the repository root as the build context (the root .dockerignore
# lets in deploy/Caddyfile.platform and nothing else this image could use):
#
#   docker build -f deploy/platform-edge.Dockerfile -t articode-platform-edge:<tag> .
#
# Why an image of its own rather than the stock caddy image with the Caddyfile
# mounted and `user:` set: the stock image's /data and /config belong to root, and
# a named volume mounted there takes that ownership on first use, so a non-root
# Caddy could not store its certificates or ACME account. Here, as in
# deploy/web.Dockerfile, the user `edge` (uid 10001) owns them before the volumes
# are created, the Caddyfile is baked in read-only (root-owned) and validated at
# build time. It binds 80 and 443 without any capability (Docker sets
# net.ipv4.ip_unprivileged_port_start=0 in a bridge network namespace), so it runs
# with `cap_drop: [ALL]` and `no-new-privileges`.
#
# Nothing secret is baked in: SITE_ADDRESS and API_UPSTREAM come from the
# environment at run time.
# TEST-211: deploy/tests/platform-compose.test.mjs.

# The same Caddy release as deploy/web.Dockerfile.
ARG CADDY_VERSION=2.11.9

FROM caddy:${CADDY_VERSION}-alpine
RUN addgroup -S -g 10001 edge \
 && adduser -S -D -H -u 10001 -G edge -h /data -s /sbin/nologin edge \
 && chown -R edge:edge /data /config
# Owned by root and read-only for the process user.
COPY deploy/Caddyfile.platform /etc/caddy/Caddyfile
USER edge
# A Caddyfile that does not parse or provision fails the build, not the start.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
EXPOSE 80 443 443/udp
# Liveness only: the loopback-only site of the Caddyfile (127.0.0.1:2020).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:2020/"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
