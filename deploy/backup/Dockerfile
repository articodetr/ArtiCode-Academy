# syntax=docker/dockerfile:1
#
# ArtiCode Academy — the `backup` image (MOD-17-T04, D-R92, ADR-072).
#
# The build context is this folder, deploy/backup/ (its own .dockerignore lets in
# the scripts and the crontab only):
#
#   docker build -t articode-backup:<tag> deploy/backup
#
# One container per academy, beside the `db` service of the compose project
# (reachable as host `db`). It holds no secret: every setting comes from the
# environment at run time, and the entrypoint turns DB_MIGRATOR_PASSWORD into a
# password file (mode 600) — never a command-line argument.
#
#   cron (PID 1, root)  runs the jobs of /etc/cron.d/articode-backup, rendered at
#                       start from ./crontab and BACKUP_SCHEDULE / BACKUP_DRILL_SCHEDULE;
#   every job runs as `postgres` (uid 999) and logs to the container's stdout:
#     backup.sh          nightly `pg_dump -Fc` as the migrator (the database owner,
#                        never the superuser) + sha256, retention, optional
#                        age-encrypted offsite copy through rclone;
#     restore-drill.sh   monthly: restores the newest dump into a throwaway cluster
#                        inside this container and checks it (no CREATEDB needed);
#     restore.sh         by hand only: restores a dump into the live database.
#
# PostgreSQL client and server binaries of the base image share the server's major
# version (pg_dump refuses a newer server major) — keep this tag in step with the
# `db` service image of deploy/compose.academy.yaml (same major; same minor
# recommended). TEST-203: deploy/tests/backup.test.mjs.

ARG POSTGRES_VERSION=18.7
FROM postgres:${POSTGRES_VERSION}-trixie

# cron: Debian's daemon (needs root; drops to the user named in /etc/cron.d).
# systemd-standalone-sysusers satisfies cron-daemon-common without pulling systemd.
# age + rclone: the optional offsite copy. procps: pgrep for the health check.
# The distribution's default cron jobs (dpkg, apt) are removed: only ours run.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      cron systemd-standalone-sysusers age rclone ca-certificates procps \
 && rm -rf /var/lib/apt/lists/* \
 && find /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly \
      -type f ! -name .placeholder -delete \
 && sed -i '/pam_loginuid\.so/s/^/#/' /etc/pam.d/cron \
 && install -d -o postgres -g postgres -m 700 /backups \
 && install -d -m 755 /etc/articode-backup /usr/local/lib/articode-backup

COPY --chmod=0644 crontab /etc/articode-backup/crontab
COPY --chmod=0644 common.sh /usr/local/lib/articode-backup/common.sh
COPY --chmod=0755 entrypoint.sh /usr/local/bin/articode-backup-entrypoint
COPY --chmod=0755 backup.sh restore.sh restore-drill.sh /usr/local/bin/

ENV PGHOST=db \
    PGPORT=5432 \
    BACKUP_DIR=/backups \
    BACKUP_RETENTION_DAYS=14 \
    BACKUP_SCHEDULE="30 2 * * *" \
    BACKUP_DRILL_SCHEDULE="0 4 1 * *" \
    TZ=UTC

WORKDIR /backups
# Healthy while cron runs and neither the last backup nor the last drill failed.
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s --retries=1 \
  CMD pgrep -x cron >/dev/null && ! grep -qs '"result":"fail"' "$BACKUP_DIR/backup-last.json" "$BACKUP_DIR/drill-last.json"
ENTRYPOINT ["articode-backup-entrypoint"]
CMD []
