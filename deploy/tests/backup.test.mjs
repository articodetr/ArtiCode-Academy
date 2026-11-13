#!/usr/bin/env node
// TEST-203 — the `backup` image: backup, restore and the restore drill
// (MOD-17-T04, roadmap §4l.5, D-R92, ADR-072).
//
// Run from the repository root with Docker running (Node >= 22, no npm install):
//
//   node deploy/tests/backup.test.mjs                  build deploy/backup, then check it
//   node deploy/tests/backup.test.mjs --no-build       check an image that is already built
//   node deploy/tests/backup.test.mjs --tag test       tags articode-backup:<tag> (default test)
//   node deploy/tests/backup.test.mjs --tools-tag t01  the migrate image articode-api-tools:<tag>
//                                                      (built from deploy/api.Dockerfile when missing)
//
// A throwaway PostgreSQL 18 with docker/postgres/initdb/10-roles.sh, migrated and seeded
// by the `tools` image, then two backup containers: `main` (offsite copy to a local
// rclone path, schedules that never fire — every job is started by the test) and
// `cron` (a backup every minute, on its own database, to prove the cron path).
//   AC1  backup -> delete data (and add what a newer migration would) -> restore ->
//        the data is back and the extra objects are gone; a dry run, a connected
//        session and a damaged dump are refused and leave the database untouched;
//   AC2  the drill passes on the good dump without touching the live server (the
//        migrator has no CREATEDB) and fails clearly on a wrong checksum, a truncated
//        dump, a corrupt dump with a matching checksum and incomplete dumps;
//   AC3  retention removes old dumps by their name date only, never the newest, never
//        a file outside the naming pattern;
//   AC4  no password in `docker logs`, in the container's command (`docker inspect`),
//        in `ps` during a backup, a restore and a drill, or in the jobs' environment;
//        the password file is mode 600;
//   plus the offsite copy (age + rclone) decrypts to the dump's checksum, the cron
//   path runs a job as `postgres` with its output in `docker logs`, and the health check.
//
// Prints PASS / FAIL / SKIP lines; never a password (every container text printed
// goes through redact()). Every password and the age key are random, generated here,
// handed to docker by variable name only and thrown away. Exit code 1 when anything fails.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const IMAGE = `articode-backup:${option('--tag', 'test')}`;
const TOOLS = `articode-api-tools:${option('--tools-tag', 't01')}`;
const RUN_ID = randomBytes(4).toString('hex');

const NET = `articode-t203-${RUN_ID}`;
const DB = `articode-t203-db-${RUN_ID}`;
const MAIN = `articode-t203-main-${RUN_ID}`;
const CRON = `articode-t203-cron-${RUN_ID}`;
const VOL_MAIN = `articode-t203-backups-${RUN_ID}`;
const VOL_CRON = `articode-t203-cron-${RUN_ID}`;
const DB_NAME = 'articode_academy';
const CRON_DB = 't203_cron';
const MIGRATOR = 'articode_migrator';
const APP = 'articode_app';
const SUPER = 'articode';
const REMOTE = ':local:/remote/academy';

const SECRETS = {
  POSTGRES_PASSWORD: randomBytes(18).toString('hex'),
  DB_MIGRATOR_PASSWORD: randomBytes(18).toString('hex'),
  DB_APP_PASSWORD: randomBytes(18).toString('hex'),
};
const secretValues = () => [...Object.values(SECRETS), ...(ageKey.secret ? [ageKey.secret] : [])];
const ageKey = { public: '', secret: '' };

const results = [];
const report = (status, name, detail = '') => {
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
};
const pass = (name, detail) => report('PASS', name, detail);
const fail = (name, detail) => report('FAIL', name, detail);
const skip = (name, detail) => report('SKIP', name, detail);
const check = (ok, name, okDetail, failDetail) => (ok ? pass(name, okDetail) : fail(name, failDetail ?? okDetail));

/** Every container text shown goes through here: secret values become ***. */
function redact(text) {
  let out = String(text ?? '');
  for (const v of secretValues()) out = out.split(v).join('***');
  return out;
}
const secretHits = (text) => secretValues().filter((v) => String(text).includes(v)).length;
const tail = (text, lines = 20) => redact(text).trim().split('\n').slice(-lines).join('\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs docker; secrets travel in `env` and are named in args (`-e NAME`), never valued. */
function docker(argv, { env, input, allowFail = true, timeout } = {}) {
  const res = spawnSync('docker', argv, {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    timeout,
    maxBuffer: 256 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  const out = { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? String(res.error ?? '') };
  if (!allowFail && out.code !== 0) throw new Error(`docker ${argv[0]} ${argv[1] ?? ''} failed: ${tail(out.stderr, 5).split('\n').join(' | ')}`);
  return out;
}
const e = (names) => names.flatMap((n) => ['-e', n]);

/** psql in the db container over its local socket (trusted there). */
function sql(query, user = MIGRATOR, db = DB_NAME) {
  const res = docker(['exec', '-i', DB, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', db], { input: query });
  return { ...res, out: res.stdout.trim() };
}
const sqlValue = (query, user, db) => {
  const res = sql(query, user, db);
  if (res.code !== 0) throw new Error(`SQL failed: ${tail(res.stderr, 3)}`);
  return res.out;
};

/** Runs a bash snippet in a container ("$@" = rest). */
const sh = (container, script, rest = [], opts = {}) => docker(['exec', ...(opts.user ? ['-u', opts.user] : []), ...(opts.execEnv ?? []), ...(opts.stdin ? ['-i'] : []), container, 'bash', '-c', script, '_', ...rest], opts);

// Runs a job inside `container` (as root, like cron) while sampling `ps` until it ends.
const PS_SAMPLER = [
  '"$@" >/tmp/t203-job.out 2>&1 & p=$!',
  'n=0',
  'while kill -0 "$p" 2>/dev/null; do ps -eo user=,args=; n=$((n + 1)); done',
  'wait "$p"; rc=$?',
  'echo "@@SAMPLES $n"; echo "@@LOG"; cat /tmp/t203-job.out; rm -f /tmp/t203-job.out',
  'exit $rc',
].join('\n');
function runWithPs(container, argv, extraEnv = []) {
  const res = docker(['exec', ...extraEnv, container, 'bash', '-c', PS_SAMPLER, '_', ...argv]);
  const [ps, log = ''] = res.stdout.split('@@LOG\n');
  const samples = Number((ps.match(/@@SAMPLES (\d+)/) ?? [])[1] ?? 0);
  return { code: res.code, ps, log, samples, stderr: res.stderr };
}
const lastJsonLine = (text) => {
  const line = text.trim().split('\n').reverse().find((l) => l.startsWith('{'));
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
function build() {
  const started = Date.now();
  const res = docker(['build', '-t', IMAGE, '--progress=plain', 'deploy/backup']);
  const secs = Math.round((Date.now() - started) / 1000);
  if (res.code === 0) pass('build deploy/backup (context = that folder)', `${IMAGE} in ${secs} s`);
  else {
    fail('build deploy/backup (context = that folder)', `exit ${res.code}`);
    console.log(tail(res.stderr + res.stdout, 40));
  }
}

function checkImage() {
  const res = docker(['run', '--rm', '--entrypoint', 'bash', IMAGE, '-c', 'pg_dump --version; initdb --version; age --version; rclone version | head -n 1; command -v cron gosu pgrep; stat -c "%U %a" /backups; id -un']);
  const out = res.stdout;
  const pgDump = (out.match(/pg_dump \(PostgreSQL\) (\d+)\.(\d+)/) ?? []).slice(1);
  const ok = res.code === 0 && pgDump[0] === '18' && /initdb \(PostgreSQL\) 18\./.test(out) && /v?1\.\d+\.\d+/.test(out) && /rclone v1\./.test(out) && out.includes('/usr/sbin/cron') && out.includes('/usr/local/bin/gosu') && out.includes('postgres 700');
  check(ok, 'image tools: pg_dump/initdb 18, age, rclone, cron, gosu; /backups postgres 700', `pg_dump ${pgDump.join('.')}; ${(out.match(/rclone v[\d.]+\S*/) ?? [''])[0]}; age ${(out.match(/^v?1\.\d+\.\d+$/m) ?? [''])[0]}`, tail(out + res.stderr, 8));
  const size = Number(docker(['image', 'inspect', '--format', '{{.Size}}', IMAGE]).stdout.trim());
  if (size) pass('image size', `${(size / 1e6).toFixed(0)} MB`);
}

function ensureTools() {
  if (docker(['image', 'inspect', TOOLS]).code === 0) return true;
  console.log(`(building ${TOOLS} from deploy/api.Dockerfile --target tools)`);
  const res = docker(['build', '-f', 'deploy/api.Dockerfile', '--target', 'tools', '-t', TOOLS, '.']);
  if (res.code !== 0) {
    fail(`build ${TOOLS}`, tail(res.stderr, 10));
    return false;
  }
  return true;
}

function generateAgeKey() {
  const res = docker(['run', '--rm', '--entrypoint', 'age-keygen', IMAGE]);
  ageKey.secret = (res.stdout.match(/^AGE-SECRET-KEY-1[0-9A-Z]+$/m) ?? [''])[0];
  ageKey.public = (res.stdout.match(/public key: (age1[0-9a-z]+)/) ?? [])[1] ?? '';
  if (!ageKey.secret || !ageKey.public) throw new Error('age-keygen gave no key pair');
}

// The entrypoint refuses bad settings at start, loudly, instead of running cron.
function checkRefusals() {
  const cases = [
    ['no DB_MIGRATOR_PASSWORD', [], /DB_MIGRATOR_PASSWORD is required/],
    ['a malformed BACKUP_SCHEDULE', ['-e', 'DB_MIGRATOR_PASSWORD', '-e', 'BACKUP_SCHEDULE=every night'], /BACKUP_SCHEDULE must be five cron fields/],
    ['credentials inside BACKUP_REMOTE', ['-e', 'DB_MIGRATOR_PASSWORD', '-e', 'BACKUP_REMOTE=:s3,secret_access_key=x:bucket', '-e', `BACKUP_AGE_RECIPIENT=${ageKey.public}`], /BACKUP_REMOTE holds '='/],
    ['a non-numeric BACKUP_RETENTION_DAYS', ['-e', 'DB_MIGRATOR_PASSWORD', '-e', 'BACKUP_RETENTION_DAYS=two weeks'], /BACKUP_RETENTION_DAYS must be a whole number/],
  ];
  for (const [what, extra, expected] of cases) {
    const res = docker(['run', '--rm', '-e', `POSTGRES_DB=${DB_NAME}`, '-e', `DB_MIGRATOR_USER=${MIGRATOR}`, ...extra, IMAGE], { env: SECRETS, timeout: 60_000 });
    const text = res.stdout + res.stderr;
    check(res.code !== 0 && expected.test(text) && secretHits(text) === 0, `the entrypoint refuses ${what}`, `exit ${res.code}: ${tail(text, 1)}`);
  }
}

// --- the database: roles, migrations, seed ---------------------------------------------
async function setupDatabase() {
  const plain = {
    POSTGRES_USER: SUPER,
    POSTGRES_DB: DB_NAME,
    DB_MIGRATOR_USER: MIGRATOR,
    DB_APP_USER: APP,
    DB_HOST: 'db',
    SEED_ACADEMY_SLUG: 't203-academy',
    SEED_ACADEMY_NAME_AR: 'أكاديمية الاختبار',
    SEED_ACADEMY_NAME_EN: 'T203 Academy',
    SEED_ACADEMY_TIMEZONE: 'UTC',
    SEED_ACADEMY_CURRENCY: 'USD',
    SEED_ACADEMY_LOCALE: 'ar',
  };
  const env = { ...plain, ...SECRETS };
  docker(['network', 'create', NET], { allowFail: false });
  docker(['create', '--name', DB, '--network', NET, '--network-alias', 'db', ...e(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'DB_MIGRATOR_USER', 'DB_MIGRATOR_PASSWORD', 'DB_APP_USER', 'DB_APP_PASSWORD']), 'postgres:18'], { env, allowFail: false });
  docker(['cp', resolve(ROOT, 'docker', 'postgres', 'initdb', '10-roles.sh'), `${DB}:/docker-entrypoint-initdb.d/10-roles.sh`], { allowFail: false });
  docker(['start', DB], { allowFail: false });
  const deadline = Date.now() + 90_000;
  let up = false;
  while (!up && Date.now() < deadline) {
    up = docker(['exec', DB, 'pg_isready', '-h', '127.0.0.1', '-U', SUPER, '-d', DB_NAME]).code === 0;
    if (!up) await sleep(1000);
  }
  if (!up) throw new Error('PostgreSQL did not become ready within 90 s');
  const toolEnv = ['DB_HOST', 'POSTGRES_DB', 'DB_MIGRATOR_USER', 'DB_MIGRATOR_PASSWORD', 'DB_APP_USER', 'DB_APP_PASSWORD', ...Object.keys(plain).filter((k) => k.startsWith('SEED_'))];
  const res = docker(['run', '--rm', '--network', NET, ...e(toolEnv), TOOLS], { env });
  if (res.code !== 0) throw new Error(`migrate + seed failed: ${tail(res.stdout + res.stderr, 10)}`);
  const server = sqlValue('SHOW server_version');
  pass('throwaway PostgreSQL migrated and seeded by the tools image', `server ${server}, roles from 10-roles.sh`);
  // Production: the migrator owns the database but cannot create one (6.6.3, D-R90).
  sqlValue(`ALTER ROLE ${MIGRATOR} NOCREATEDB; CREATE DATABASE ${CRON_DB} OWNER ${MIGRATOR}; SELECT 1`, SUPER, 'postgres');
  check(sqlValue(`SELECT rolcreatedb FROM pg_roles WHERE rolname = '${MIGRATOR}'`) === 'f', 'the migrator has no CREATEDB (the production setting)', `${MIGRATOR}: rolcreatedb = false`);
  return { toolEnv, env };
}

function startBackup(name, volume, extraEnv, extraArgs = []) {
  docker(['volume', 'create', volume], { allowFail: false });
  docker(['run', '-d', '--name', name, '--network', NET, '-e', 'DB_MIGRATOR_PASSWORD', '-e', `DB_MIGRATOR_USER=${MIGRATOR}`, ...extraEnv, '-v', `${volume}:/backups`, ...extraArgs, IMAGE], { env: SECRETS, allowFail: false });
}

async function waitForLog(container, pattern, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let text = '';
  while (Date.now() < deadline) {
    const res = docker(['logs', container]);
    text = res.stdout + res.stderr;
    if (pattern.test(text)) return text;
    await sleep(1000);
  }
  return text;
}

// --- AC4 (static) -----------------------------------------------------------------------
function checkNoSecretsAtRest() {
  const inspect = docker(['inspect', '--format', '{{json .Path}} {{json .Args}} {{json .Config.Cmd}} {{json .Config.Entrypoint}}', MAIN]).stdout;
  check(secretHits(inspect) === 0, 'AC4 no password in the container command (docker inspect Path/Args/Cmd/Entrypoint)', redact(inspect.trim()), `${secretHits(inspect)} secret values found`);

  const modes = sh(MAIN, 'stat -c "%n %a %U %G" /run/articode-backup /run/articode-backup/pgpass /run/articode-backup/env').stdout;
  check(
    /\/run\/articode-backup 700 postgres postgres/.test(modes) && /pgpass 600 postgres postgres/.test(modes) && /env 600 postgres postgres/.test(modes),
    'AC4 the password file (PGPASSFILE) and the job env file are mode 600, owned by postgres',
    modes.trim().split('\n').join('; '),
  );
  const pgpass = sh(MAIN, 'cat /run/articode-backup/pgpass').stdout;
  const envFile = sh(MAIN, 'cat /run/articode-backup/env').stdout;
  check(pgpass.includes(`db:5432:*:${MIGRATOR}:${SECRETS.DB_MIGRATOR_PASSWORD}`) && pgpass.trim().split('\n').length === 1, 'the password file holds one line for the migrator on db:5432', 'host:port:*:user:<password>');
  check(secretHits(envFile) === 0 && envFile.includes(`POSTGRES_DB=${DB_NAME}`), 'AC4 the job env file holds the settings and no password', `${envFile.trim().split('\n').length - 1} variables`);
  const environ = sh(MAIN, 'tr "\\0" "\\n" </proc/1/environ').stdout;
  check(secretHits(environ) === 0 && !/^DB_MIGRATOR_PASSWORD=/m.test(environ), 'AC4 cron (PID 1) and its jobs inherit no password', 'DB_MIGRATOR_PASSWORD removed before cron starts', `${secretHits(environ)} secret values in /proc/1/environ`);
}

function checkPs(name, run, toolPattern) {
  const hits = secretHits(run.ps);
  const saw = toolPattern.test(run.ps);
  check(hits === 0 && saw, `AC4 no password in ps during ${name}`, `${run.samples} snapshots, ${toolPattern.source} seen, 0 secret values`, hits ? `${hits} secret values in ps` : `the job ended before ps saw ${toolPattern.source} (${run.samples} snapshots)`);
}

// --- AC1 ---------------------------------------------------------------------------------
const LEVEL_ROWS = 20000;
const MARKER = 'T203MARK';
function seedMarkers() {
  sqlValue(`INSERT INTO levels (code, name, sort_order)
              SELECT 'T203L' || lpad(i::text, 5, '0'), jsonb_build_object('ar', 'مستوى ' || i, 'en', md5(i::text)), i
                FROM generate_series(1, ${LEVEL_ROWS}) AS i;
            INSERT INTO levels (code, name, sort_order) VALUES ('${MARKER}', '{"ar":"علامة","en":"marker"}', 30000);
            SELECT 1`);
  return state();
}
function state() {
  const row = sqlValue(`SELECT (SELECT count(*) FROM levels), (SELECT count(*) FROM levels WHERE code = '${MARKER}'),
                               (SELECT slug FROM academy), (SELECT count(*) FROM _prisma_migrations),
                               (SELECT max(migration_name) FROM _prisma_migrations), (SELECT count(*) FROM pg_default_acl),
                               to_regclass('public.t203_extra') IS NOT NULL, to_regtype('public.t203_kind') IS NOT NULL,
                               (SELECT bool_and(has_table_privilege('${APP}', 'public.levels', p)) FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p),
                               (SELECT count(*) FROM pg_extension WHERE extname = 'btree_gist')`);
  const [levels, marker, slug, migrations, newest, defaultAcls, extra, extraType, appGrants, btreeGist] = row.split('|');
  return { levels: Number(levels), marker: Number(marker), slug, migrations: Number(migrations), newest, defaultAcls: Number(defaultAcls), extra: extra === 't', extraType: extraType === 't', appGrants: appGrants === 't', btreeGist: Number(btreeGist) };
}

function backupNow(label) {
  const run = runWithPs(MAIN, ['backup.sh']);
  const name = (run.log.match(/complete: (\S+\.dump)/) ?? [])[1];
  return { run, name, label };
}

function checkFirstBackup(b) {
  const re = new RegExp(`^${DB_NAME}-\\d{8}T\\d{6}Z\\.dump$`);
  const steps = ['dump: ', 'dump: done', 'retention: kept', 'offsite: ', 'complete: '].every((s) => b.run.log.includes(s));
  check(b.run.code === 0 && b.name && re.test(b.name) && steps, 'AC1 backup.sh dumps as the migrator, one log line per step', `${b.name}`, `exit ${b.run.code}: ${tail(b.run.log, 8)}`);
  const files = sh(MAIN, 'cd /backups && stat -c "%n %a %U" "$1" "$1.sha256" && sha256sum -c "$1.sha256" && cat backup-last.json && ls -A /backups', [b.name ?? 'none']).stdout;
  check(new RegExp(`${b.name} 600 postgres`).test(files) && /\.sha256 600 postgres/.test(files) && /: OK/.test(files) && /"result":"pass"/.test(files) && !/\.partial/.test(files), 'AC1 the dump and its .sha256 are complete, mode 600, and verify', 'sha256sum -c OK; backup-last.json pass; no temporary file left', tail(files, 8));
  checkPs('a backup', b.run, /pg_dump/);
}

function checkOffsite(name) {
  const listing = sh(MAIN, 'ls -A /remote/academy').stdout;
  const both = listing.includes(`${name}.age`) && listing.includes(`${name}.sha256`);
  const dec = docker(
    ['exec', '-i', MAIN, 'bash', '-c', 'umask 077; cat >/tmp/t203-key; age -d -i /tmp/t203-key -o /tmp/t203-dec.dump "/remote/academy/$1.age"; rc=$?; rm -f /tmp/t203-key; [ $rc = 0 ] || exit $rc; sha256sum </tmp/t203-dec.dump; cat "/remote/academy/$1.sha256"; rm -f /tmp/t203-dec.dump', '_', name],
    { input: `${ageKey.secret}\n` },
  );
  const [decrypted = '', recorded = ''] = dec.stdout.trim().split('\n').map((l) => l.split(/\s+/)[0]);
  check(both && dec.code === 0 && decrypted.length === 64 && decrypted === recorded, 'offsite: the age copy and its .sha256 are on the rclone remote and decrypt to the dump', `${REMOTE}/${name}.age -> sha256 ${decrypted.slice(0, 16)}… matches`, `listing: ${listing.trim()}; ${tail(dec.stderr, 3)}`);
  const leftovers = sh(MAIN, 'ls -A /backups | grep -c "\\.age" || true').stdout.trim();
  check(leftovers === '0', 'offsite: no encrypted copy is kept beside the local dumps', '/backups holds no .age file', `${leftovers} .age files`);
}

// A copy of the dump with random bytes over a data block: the archive's table of
// contents still reads, its data does not (the checksum is rewritten to match).
function makeCorruptDump(name) {
  const res = sh(
    MAIN,
    [
      'set -e; mkdir -p /tmp/t203; d=/backups/$1; s=$(stat -c %s "$d")',
      'for pct in 75 85 65 92 55 45; do',
      '  cp "$d" /tmp/t203/corrupt.dump',
      '  head -c 4096 /dev/urandom | dd of=/tmp/t203/corrupt.dump bs=4096 iflag=fullblock seek=$((s * pct / 100)) oflag=seek_bytes conv=notrunc status=none',
      '  if pg_restore --list /tmp/t203/corrupt.dump >/dev/null 2>&1 && ! pg_restore --file=/dev/null /tmp/t203/corrupt.dump >/dev/null 2>&1; then',
      '    (cd /tmp/t203 && sha256sum corrupt.dump >corrupt.dump.sha256); echo "OFFSET $pct"; exit 0',
      '  fi',
      'done; exit 1',
    ].join('\n'),
    [name],
    { user: 'postgres' },
  );
  return res.code === 0 ? res.stdout.trim() : null;
}

async function checkRestore(dumpName, before) {
  // Damage: data deleted and changed, plus what a newer migration would have added.
  sqlValue(`DELETE FROM levels WHERE code = '${MARKER}' OR sort_order > ${LEVEL_ROWS / 2};
            UPDATE academy SET slug = 't203-changed';
            CREATE TABLE t203_extra (id int);
            CREATE TYPE t203_kind AS ENUM ('a');
            INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
              VALUES ('t203-future', 'x', '29991231235959_t203_future', now(), now(), 1);
            SELECT 1`);
  const damaged = state();
  const untouched = (s) => s.levels === damaged.levels && s.marker === 0 && s.slug === 't203-changed' && s.extra && s.extraType;

  const dry = runWithPs(MAIN, ['restore.sh', dumpName]);
  check(dry.code === 2 && /--yes/.test(dry.log) && untouched(state()), 'AC1 restore.sh without --yes only verifies and refuses', tail(dry.log, 1));

  docker(['exec', '-d', '-e', 'PGAPPNAME=t203-blocker', DB, 'psql', '-X', '-U', APP, '-d', DB_NAME, '-c', 'SELECT pg_sleep(300)']);
  let blockers = '0';
  for (let i = 0; i < 20 && blockers === '0'; i += 1) {
    blockers = sqlValue(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 't203-blocker' AND state = 'active'`, SUPER);
    if (blockers === '0') await sleep(500);
  }
  const busy = runWithPs(MAIN, ['restore.sh', '--yes', dumpName]);
  check(blockers === '1' && busy.code === 2 && /other session/.test(busy.log) && untouched(state()), 'AC1 restore.sh refuses while another session is connected (the api must be stopped)', tail(busy.log, 1), `blockers ${blockers}, exit ${busy.code}: ${tail(busy.log, 2)}`);
  sqlValue(`SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name = 't203-blocker'`, SUPER);
  for (let i = 0; i < 20; i += 1) {
    if (sqlValue(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 't203-blocker'`, SUPER) === '0') break;
    await sleep(500);
  }

  const offset = makeCorruptDump(dumpName);
  if (!offset) fail('AC1 a dump that breaks half-way leaves the database unchanged', 'could not build a corrupt dump with a readable table of contents');
  else {
    const broken = runWithPs(MAIN, ['restore.sh', '--yes', '/tmp/t203/corrupt.dump']);
    check(broken.code === 1 && /rolled back/.test(broken.log) && untouched(state()), 'AC1 a dump that breaks half-way leaves the database unchanged (one transaction)', `${offset}%: ${tail(broken.log, 1)}`, `exit ${broken.code}: ${tail(broken.log, 4)}`);
  }

  const run = runWithPs(MAIN, ['restore.sh', '--yes', dumpName]);
  const after = state();
  const back = after.levels === before.levels && after.marker === 1 && after.slug === before.slug;
  const clean = !after.extra && !after.extraType && after.migrations === before.migrations && after.newest === before.newest;
  const grants = after.appGrants && after.defaultAcls === before.defaultAcls && after.btreeGist === 1;
  check(run.code === 0 && back, 'AC1 backup -> delete data -> restore -> the data is back', `${after.levels} levels (marker present), academy slug restored`, `exit ${run.code}: ${tail(run.log, 6)}; ${JSON.stringify(after)}`);
  check(run.code === 0 && clean, 'AC1 the restore drops what the dump does not hold (a newer migration\'s table, type and row)', `${after.migrations} migrations, newest ${after.newest}`, JSON.stringify(after));
  check(run.code === 0 && grants, 'AC1 the restored database keeps the application role\'s grants, the default privileges and btree_gist', `${APP} DML on levels, ${after.defaultAcls} default ACLs`, JSON.stringify(after));
  checkPs('a restore', run, /pg_restore|psql/);
  return after;
}

function checkMigrateAfterRestore(toolEnv, env) {
  const res = docker(['run', '--rm', '--network', NET, ...e(toolEnv), TOOLS, 'npx', 'prisma', 'migrate', 'deploy'], { env });
  check(res.code === 0 && /No pending migrations to apply/i.test(res.stdout + res.stderr), 'AC1 `prisma migrate deploy` after the restore: nothing pending', 'the host procedure\'s next step', tail(res.stdout + res.stderr, 6));
}

// --- AC2 -----------------------------------------------------------------------------------
function drill(argv = []) {
  const run = runWithPs(MAIN, ['restore-drill.sh', ...argv]);
  return { run, result: lastJsonLine(run.log) };
}

function checkDrills(dumpName, liveNewest) {
  const databases = () => sqlValue('SELECT string_agg(datname, \',\' ORDER BY datname) FROM pg_database', SUPER);
  const before = databases();
  const good = drill();
  const stored = lastJsonLine(sh(MAIN, 'cat /backups/drill-last.json').stdout);
  const r = good.result ?? {};
  check(
    good.run.code === 0 && r.result === 'pass' && r.dump === dumpName && r.migrations?.newest === liveNewest && r.migrations?.live === liveNewest && r.counts?.academy === 1 && r.counts?.roles > 0 && r.counts?.permissions > 0 && stored?.result === 'pass',
    'AC2 the drill restores the newest dump into a throwaway cluster and passes',
    `${r.migrations?.finished} migrations, newest = live, academy 1, roles ${r.counts?.roles}, permissions ${r.counts?.permissions}; drill-last.json pass`,
    `exit ${good.run.code}: ${tail(good.run.log, 6)}`,
  );
  check(databases() === before, 'AC2 the drill leaves the live server alone (no database created there)', before, `${before} -> ${databases()}`);
  checkPs('a drill', good.run, /initdb|pg_restore|postgres -D|pg_ctl/);

  const prep = sh(
    MAIN,
    [
      'set -e; mkdir -p /tmp/t203; cd /tmp/t203; d=/backups/$1; s=$(stat -c %s "$d")',
      'cp "$d" wrongsha.dump; printf "%064d  wrongsha.dump\\n" 0 >wrongsha.dump.sha256',
      'head -c $((s / 2)) "$d" >truncated.dump; sed "s/  .*/  truncated.dump/" "$d.sha256" >truncated.dump.sha256',
      'head -c $((s * 9 / 10)) "$d" >short.dump; sha256sum short.dump >short.dump.sha256',
      'pg_dump --host=db --username="$2" --dbname="$3" --no-password -Fc --exclude-table-data=academy -f noacademy.dump; sha256sum noacademy.dump >noacademy.dump.sha256',
      'pg_dump --host=db --username="$2" --dbname="$3" --no-password -Fc --exclude-table=_prisma_migrations -f nomigrations.dump; sha256sum nomigrations.dump >nomigrations.dump.sha256',
    ].join('\n'),
    [dumpName, MIGRATOR, DB_NAME],
    { user: 'postgres', execEnv: ['-e', 'PGPASSFILE=/run/articode-backup/pgpass'] },
  );
  if (prep.code !== 0) {
    fail('AC2 bad dumps prepared', tail(prep.stderr, 4));
    return;
  }
  const cases = [
    ['a wrong checksum', 'wrongsha.dump', /sha256 mismatch/],
    ['a truncated dump (its original checksum)', 'truncated.dump', /sha256 mismatch/],
    ['a truncated dump with a matching checksum', 'short.dump', /does not restore/],
    ['a corrupt data block with a matching checksum', 'corrupt.dump', /does not restore/],
    ['a dump without the academy row', 'noacademy.dump', /academy table holds 0 rows/],
    ['a dump without _prisma_migrations', 'nomigrations.dump', /no _prisma_migrations table/],
  ];
  for (const [what, file, reason] of cases) {
    const bad = drill([`/tmp/t203/${file}`]);
    const res = bad.result ?? {};
    // A reason never quotes row data from the dump (psql CONTEXT lines would).
    check(bad.run.code === 1 && res.result === 'fail' && reason.test(res.reason ?? '') && !/CONTEXT:|COPY levels|مستوى/.test(res.reason ?? ''), `AC2 the drill fails clearly on ${what}`, (res.reason ?? '').slice(0, 110), `exit ${bad.run.code}: ${tail(bad.run.log, 3)}`);
  }
  return true;
}

function healthOf() {
  const test = JSON.parse(docker(['inspect', '--format', '{{json .Config.Healthcheck.Test}}', MAIN]).stdout.trim() || '[]');
  if (test[0] !== 'CMD-SHELL') return null;
  return docker(['exec', MAIN, 'sh', '-c', test[1]]).code;
}

// --- AC3 -----------------------------------------------------------------------------------
const stampOf = (daysAgo, hours = 0) => new Date(Date.now() - daysAgo * 86_400_000 - hours * 3_600_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function checkRetention() {
  const d = DB_NAME;
  const old20 = stampOf(20);
  const old15 = stampOf(15);
  const keep13 = stampOf(13);
  const keep1 = stampOf(1);
  const removed = [`${d}-${old20}.dump`, `${d}-${old20}.dump.sha256`, `${d}-${old20}.dump.age`, `${d}-${old15}.dump.sha256`, `${d}-20251001T000000Z.dump`];
  const kept = [`${d}-${keep13}.dump`, `${d}-${keep13}.dump.sha256`, `${d}-${keep1}.dump`, 'notes.txt', `${d}-${old20}.dump.bak`, `other_db-${old20}.dump`, `${d}-20200101.dump`, `${d}-20261399T000000Z.dump`, `.${d}-${old20}.dump.tmp`];
  sh(MAIN, 'cd /backups && for f in "$@"; do printf x >"$f"; done', [...removed, ...kept], { user: 'postgres' });
  const b = backupNow('retention');
  const listing = sh(MAIN, 'ls -A /backups').stdout.split('\n').map((l) => l.trim());
  const gone = removed.filter((f) => !listing.includes(f));
  const stayed = kept.filter((f) => listing.includes(f));
  check(b.run.code === 0 && gone.length === removed.length, 'AC3 retention removes dumps older than BACKUP_RETENTION_DAYS by their name date, with their .sha256/.age', `${gone.length} removed (20 and 15 days old, 2025-10-01)`, `still there: ${removed.filter((f) => listing.includes(f)).join(', ')}; ${tail(b.run.log, 4)}`);
  check(stayed.length === kept.length && listing.includes(b.name), 'AC3 retention keeps newer dumps and every file outside the naming pattern', `${stayed.length} kept: 13- and 1-day-old dumps, .bak, another database, a short name, an impossible date, a hidden file`, `removed by mistake: ${kept.filter((f) => !listing.includes(f)).join(', ')}`);
  check(/impossible date - kept/.test(b.run.log), 'AC3 a dump name with an impossible date is reported and kept', tail(b.run.log.split('\n').find((l) => l.includes('impossible')) ?? '', 1));

  // Only old dumps: the newest survives whatever its age.
  const n30 = stampOf(30);
  const n20 = stampOf(20);
  const n40 = stampOf(40);
  const files = [`${d}-${n30}.dump`, `${d}-${n30}.dump.sha256`, `${d}-${n20}.dump`, `${d}-${n20}.dump.sha256`, `${d}-${n40}.dump`];
  sh(MAIN, 'mkdir -p /tmp/t203-prune && cd /tmp/t203-prune && for f in "$@"; do printf x >"$f"; done', files, { user: 'postgres' });
  const prune = docker(['exec', '-e', 'BACKUP_DIR=/tmp/t203-prune', MAIN, 'backup.sh', '--prune-only']);
  const left = sh(MAIN, 'ls -A /tmp/t203-prune | grep -v "^\\." | sort').stdout.trim().split('\n');
  check(prune.code === 0 && left.join(',') === [`${d}-${n20}.dump`, `${d}-${n20}.dump.sha256`].join(','), 'AC3 the newest dump is never removed, however old', `--prune-only over 40/30/20-day-old dumps kept ${d}-${n20}.dump`, `left: ${left.join(', ')}; ${tail(prune.stdout + prune.stderr, 3)}`);
}

// --- cron ----------------------------------------------------------------------------------
async function checkCron(startedAt) {
  const remaining = Math.max(5, 150 - Math.round((Date.now() - startedAt) / 1000));
  const logs = await waitForLog(CRON, /backup: complete: /, remaining);
  const cronFile = sh(CRON, 'stat -c "%U %a" /etc/cron.d/articode-backup; grep -v "^#" /etc/cron.d/articode-backup | grep "backup.sh"').stdout;
  check(/^root 644/.test(cronFile) && /^\* \* \* \* \* root \/usr\/local\/bin\/backup\.sh >\/proc\/1\/fd\/1 2>\/proc\/1\/fd\/2/m.test(cronFile), 'cron: /etc/cron.d/articode-backup rendered from BACKUP_SCHEDULE, root 0644', cronFile.trim().split('\n').join(' | '));
  const dumps = sh(CRON, 'stat -c "%n %U" /backups/*.dump 2>/dev/null || true').stdout.trim();
  check(/backup: dump: done/.test(logs) && /backup: complete: /.test(logs) && new RegExp(`${CRON_DB}-\\d{8}T\\d{6}Z\\.dump postgres`).test(dumps), 'cron: a scheduled backup ran as postgres with the saved settings, its output in docker logs', dumps.split('\n')[0], `no completed backup within the wait: ${tail(logs, 6)}`);
  check(secretHits(logs) === 0, 'AC4 no password in docker logs of the cron container', `${logs.trim().split('\n').length} log lines`, `${secretHits(logs)} secret values`);
  const mainLogs = docker(['logs', MAIN]);
  check(secretHits(mainLogs.stdout + mainLogs.stderr) === 0 && /entrypoint: ready/.test(mainLogs.stdout), 'AC4 no password in docker logs of the main container', tail(mainLogs.stdout, 1));
}

// ---------------------------------------------------------------------------------------------
async function main() {
  if (docker(['version', '--format', '{{.Server.Version}}']).code !== 0) {
    console.error('Docker is not reachable — start Docker Desktop (or the daemon) first.');
    process.exit(2);
  }
  console.log(`TEST-203 — backup image (${IMAGE}; migrations by ${TOOLS}; run ${RUN_ID})`);
  if (flag('--no-build')) skip('build', '--no-build: checking an existing image');
  else build();
  if (results.includes('FAIL')) return;
  checkImage();
  if (!ensureTools()) return;
  generateAgeKey();
  checkRefusals();

  let cronStartedAt = 0;
  try {
    const { toolEnv, env } = await setupDatabase();
    startBackup(CRON, VOL_CRON, ['-e', `POSTGRES_DB=${CRON_DB}`, '-e', 'BACKUP_SCHEDULE=* * * * *', '-e', 'BACKUP_DRILL_SCHEDULE=0 0 31 2 *']);
    cronStartedAt = Date.now();
    startBackup(MAIN, VOL_MAIN, ['-e', `POSTGRES_DB=${DB_NAME}`, '-e', 'BACKUP_SCHEDULE=0 0 31 2 *', '-e', 'BACKUP_DRILL_SCHEDULE=0 0 31 2 *', '-e', `BACKUP_REMOTE=${REMOTE}`, '-e', `BACKUP_AGE_RECIPIENT=${ageKey.public}`], ['--mount', 'type=tmpfs,destination=/remote,tmpfs-mode=1777']);
    const ready = await waitForLog(MAIN, /entrypoint: ready/, 30);
    check(/entrypoint: ready/.test(ready) && /offsite copy to :local:\/remote\/academy/.test(ready), 'the main container starts: settings checked, offsite copy on', tail(ready, 2).split('\n').join(' / '));
    checkNoSecretsAtRest();

    const before = seedMarkers();
    const first = backupNow('first');
    checkFirstBackup(first);
    if (!first.name) throw new Error('no dump to continue with');
    checkOffsite(first.name);
    const restored = await checkRestore(first.name, before);
    checkMigrateAfterRestore(toolEnv, env);

    checkDrills(first.name, restored.newest);
    const unhealthy = healthOf();
    const again = drill();
    const healthy = healthOf();
    check(unhealthy === 1 && again.result?.result === 'pass' && healthy === 0, 'the health check fails after a failed drill and recovers after a passing one', `exit ${unhealthy} -> ${healthy}`);
    // Eight drills started and stopped a throwaway postgres (re-parented to PID 1, cron).
    const leftovers = sh(MAIN, 'ps -eo stat=,comm= | awk \'$1 ~ /^Z/ || $2 == "postgres"\'; ls -d /tmp/articode-drill.* 2>/dev/null || true').stdout.trim();
    check(leftovers === '', 'the drills leave no server, zombie or temporary cluster behind', 'no postgres process, no zombie, no /tmp/articode-drill.*', leftovers.split('\n').join(' | '));

    checkRetention();
    await checkCron(cronStartedAt);
  } catch (error) {
    fail('run', redact(error.message));
  } finally {
    docker(['rm', '-f', MAIN, CRON, DB]);
    docker(['volume', 'rm', VOL_MAIN, VOL_CRON]);
    docker(['network', 'rm', NET]);
  }
}

await main();
const failed = results.filter((r) => r === 'FAIL').length;
console.log(`RESULT ${results.filter((r) => r === 'PASS').length} PASS / ${failed} FAIL / ${results.filter((r) => r === 'SKIP').length} SKIP`);
process.exit(failed ? 1 : 0);
