#!/usr/bin/env node
// TEST-211 — the platform as a Docker Compose project (MOD-18-T06, roadmap §4m.5, D-R104),
// and TEST-217 — its `backup` service (KI-083).
//
// Run from the repository root with Docker running (Node >= 22, no npm install):
//
//   node deploy/tests/platform-compose.test.mjs               build the images, bring a platform up, check, take it down
//   node deploy/tests/platform-compose.test.mjs --no-build    use images already tagged articode-api*:<tag> / articode-platform-edge:<tag> / articode-backup:<tag>
//   node deploy/tests/platform-compose.test.mjs --keep        leave the project running (prints how to remove it)
//   node deploy/tests/platform-compose.test.mjs --tag t211 --port 18211
//
// A throwaway platform `articode-platform-t211-<run>` on http://localhost:<port> (127.0.0.1 only;
// the unused HTTPS port is <port>+1), with an env file written by
// deploy/scripts/new-platform-env.mjs into a temp directory (random secrets, never printed).
// What it proves:
//   - the generator writes random secrets without printing them and never overwrites a file;
//   - from the repository and that env file the platform comes up: `migrate` applies the
//     platform migrations and exits 0, `api` is healthy (platform readiness), and through the
//     `edge` origin /api/health names articode-platform-api in production and
//     /api/health/ready is 200 with the schema current (the runtime image carries
//     prisma/platform/migrations);
//   - KI-087: the account commands have a service of their own, `account` — the tools image
//     under the `tools` profile (`up` never creates it), hardened, with the `none` log driver
//     (a `run` container has no Docker log: LogConfig none, `docker logs` reads nothing), the
//     application role and PLATFORM_MFA_ENCRYPTION_KEY only, and a default command that only
//     lists the commands; `migrate` no longer receives PLATFORM_MFA_ENCRYPTION_KEY;
//   - the first super admin is created with the documented command (`run --rm account`) and
//     signs in through the edge (a `pla_refresh` cookie); a foreign Origin is refused
//     (PLATFORM_CORS_ORIGIN);
//   - an academy is registered and probed from inside the image (https only in production:
//     an unresolvable https origin is `unreachable`), and the fleet view lists it;
//   - the `probe` service printed its first `platform.probe.round` line;
//   - a second `up` repeats migrate with nothing pending and duplicates nothing;
//   - the database publishes no host port, the platform migrator has no CREATEDB and owns
//     the platform database, and no academy role or database exists in this cluster
//     (10-roles.sh is not mounted);
//   - api, probe and edge run as non-root users with every capability dropped and
//     no-new-privileges;
//   TEST-217 (KI-083) — the `backup` service, built from deploy/backup/ like an academy's:
//   - the generated env file carries the backup settings with their defaults, and the
//     service starts for the platform database as the platform migrator;
//   - a backup on demand writes <PLATFORM_DB_NAME>-<UTC stamp>.dump + .sha256 (mode 600,
//     owned by postgres) that verify;
//   - the restore drill with the platform checks passes on it (newest migration = live,
//     the super admin and the academy counted) without creating a database on the live
//     server, while the academy checks (BACKUP_DB_KIND=academy) refuse that dump; the
//     container's health check is green afterwards;
//   - the documented restore: stop api, probe and edge; restore.sh refuses without --yes,
//     then puts back the deleted rows and drops a table the dump does not hold (in one
//     transaction, with the app role's grants and the audit triggers); `run --rm migrate`
//     has nothing pending; started again, api is healthy and the super admin signs in;
//   - no password in the backup container's logs.
// The project, its volumes and its network are removed at the end (never another project's).

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const TAG = option('--tag', 't211');
const PORT = Number(option('--port', String(18000 + Math.floor(Math.random() * 1000))));
const HTTPS_PORT = PORT + 1;
const RUN = randomBytes(3).toString('hex');
const PROJECT = `articode-platform-t211-${RUN}`;
const ORIGIN = `http://localhost:${PORT}`;
// The site answers its own host only (Caddy serves an empty 200 to any other Host),
// so requests go to the origin itself — localhost, published on 127.0.0.1.
const BASE = ORIGIN;
const SECRET_NAMES = ['POSTGRES_PASSWORD', 'PLATFORM_DB_MIGRATOR_PASSWORD', 'PLATFORM_DB_APP_PASSWORD', 'PLATFORM_JWT_SECRET', 'PLATFORM_MFA_ENCRYPTION_KEY'];

const results = [];
const report = (status, name, detail = '') => {
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${mask(String(detail))}` : ''}`);
};
const pass = (n, d) => report('PASS', n, d);
const fail = (n, d) => report('FAIL', n, d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tail = (text, lines = 25) => mask(text.trim().split('\n').slice(-lines).join('\n'));

const tmp = mkdtempSync(join(tmpdir(), 'articode-t211-'));
const envFile = join(tmp, `${PROJECT}.env`);

// Every secret this run knows (the env file's and the admin password): never printed.
const secrets = [];
function mask(text) {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join('***');
  return out;
}

function run(cmd, argv, { env, timeoutMs = 20 * 60_000 } = {}) {
  const res = spawnSync(cmd, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { code: res.status ?? 1, out: (res.stdout ?? '') + (res.stderr ?? '') + (res.error ? String(res.error) : ''), stdout: res.stdout ?? '' };
}

/** The environment of a container as `NAME=value` strings — compared, never printed (it holds secrets). */
function containerEnv(id) {
  try {
    return JSON.parse(run('docker', ['inspect', '--format', '{{json .Config.Env}}', id]).out.trim()) ?? [];
  } catch {
    return [];
  }
}

/** The containers of this project that `service` has, `run` containers included (even outside the active profiles). */
const containersOfService = (service) => run('docker', ['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--filter', `label=com.docker.compose.service=${service}`]).out.trim();

/** `docker compose` on this test's project only. */
const compose = (argv, opts) => run('docker', ['compose', '-p', PROJECT, '-f', 'deploy/compose.platform.yaml', '--env-file', envFile, ...argv], opts);

function envValue(name) {
  const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1) : '';
}

function psql(sql, database = '"$PLATFORM_DB_NAME"', user = '"$POSTGRES_USER"') {
  // As the superuser (by default), over the container's local socket (trust) — this test's own throwaway cluster.
  const res = compose(['exec', '-T', 'db', 'sh', '-c', `psql -v ON_ERROR_STOP=1 -U ${user} -d ${database} -Atc "$0"`, sql]);
  if (res.code !== 0) throw new Error(`psql: ${tail(res.out, 3)}`);
  return res.out.trim();
}

function containerOf(service) {
  return compose(['ps', '-a', '-q', service]).out.trim().split('\n')[0] ?? '';
}

function stateOf(service) {
  const id = containerOf(service);
  if (!id) return { status: 'absent', health: '', exit: null };
  const res = run('docker', ['inspect', '--format', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.ExitCode}}', id]);
  const [status, health, exit] = res.out.trim().split('|');
  return { status, health, exit: Number(exit) };
}

async function waitFor(predicate, seconds, every = 2000) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(every);
  }
  return false;
}

async function http(path, { token, origin, method = 'GET', body } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, headers: res.headers, body: json, text };
}

const apiHealthy = (seconds) => waitFor(() => stateOf('api').health === 'healthy', seconds);

const lastJsonLine = (text) => {
  const line = text.trim().split('\n').reverse().find((l) => l.startsWith('{'));
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  }
};

// --- TEST-217: the backup service (KI-083) ----------------------------------------------------
async function checkBackup({ email, password, migration }) {
  const dbName = envValue('PLATFORM_DB_NAME');
  const migrator = envValue('PLATFORM_DB_MIGRATOR_USER');
  const app = envValue('PLATFORM_DB_APP_USER');

  const settings = ['BACKUP_RETENTION_DAYS', 'BACKUP_SCHEDULE', 'BACKUP_DRILL_SCHEDULE', 'BACKUP_TZ', 'BACKUP_REMOTE', 'BACKUP_AGE_RECIPIENT'].map((n) => `${n}=${envValue(n)}`).join(', ');
  if (settings === 'BACKUP_RETENTION_DAYS=14, BACKUP_SCHEDULE=30 2 * * *, BACKUP_DRILL_SCHEDULE=0 4 1 * *, BACKUP_TZ=UTC, BACKUP_REMOTE=, BACKUP_AGE_RECIPIENT=') pass('backup: the generated env file carries the backup settings with their defaults', settings);
  else fail('backup: the generated env file carries the backup settings with their defaults', settings);

  let logs = '';
  await waitFor(() => {
    logs = compose(['logs', '--no-log-prefix', 'backup']).out;
    return /entrypoint: ready/.test(logs);
  }, 60);
  const readyLine = logs.split('\n').find((l) => l.includes('entrypoint: ready')) ?? '';
  if (stateOf('backup').status === 'running' && readyLine.includes(`ready: platform database ${dbName} on db:5432 as ${migrator}`)) pass('backup: the service runs for the platform database as the platform migrator', readyLine.replace(/^\S+ /, '').trim());
  else return fail('backup: the service runs for the platform database as the platform migrator', `${JSON.stringify(stateOf('backup'))} ${tail(logs, 5)}`);

  // --- a backup on demand ---
  const backup = compose(['exec', '-T', 'backup', 'backup.sh']);
  const name = (backup.out.match(/complete: (\S+\.dump)/) ?? [])[1] ?? '';
  const files = name ? compose(['exec', '-T', 'backup', 'bash', '-c', 'cd /backups && stat -c "%n %a %U" "$1" "$1.sha256" && sha256sum -c "$1.sha256" && cat backup-last.json', '_', name]).out : '';
  if (backup.code === 0 && new RegExp(`^${dbName}-\\d{8}T\\d{6}Z\\.dump$`).test(name) && files.includes(`${name} 600 postgres`) && files.includes(`${name}.sha256 600 postgres`) && files.includes(`${name}: OK`) && /"result":"pass"/.test(files)) pass('backup: backup.sh on demand writes a dump and its .sha256 of the platform database', `${name}, mode 600, owned by postgres, sha256sum -c OK, backup-last.json pass`);
  else return fail('backup: backup.sh on demand writes a dump and its .sha256 of the platform database', `exit ${backup.code}: ${tail(backup.out + files, 8)}`);

  // --- the restore drill: the academy checks refuse a platform dump, the platform checks pass ---
  const databases = () => psql("select string_agg(datname, ',' order by datname) from pg_database where not datistemplate", 'postgres');
  const before = databases();
  const academyKind = compose(['exec', '-T', '-e', 'BACKUP_DB_KIND=academy', 'backup', 'restore-drill.sh']);
  const refused = lastJsonLine(academyKind.out) ?? {};
  if (academyKind.code === 1 && refused.result === 'fail' && /core table is missing.*academy/.test(refused.reason ?? '')) pass('backup: the drill with the academy checks (BACKUP_DB_KIND=academy) refuses the platform dump', (refused.reason ?? '').slice(0, 120));
  else fail('backup: the drill with the academy checks (BACKUP_DB_KIND=academy) refuses the platform dump', `exit ${academyKind.code}: ${tail(academyKind.out, 4)}`);

  const drill = compose(['exec', '-T', 'backup', 'restore-drill.sh']);
  const r = lastJsonLine(drill.out) ?? {};
  const stored = lastJsonLine(compose(['exec', '-T', 'backup', 'cat', '/backups/drill-last.json']).out);
  const after = databases();
  if (drill.code === 0 && r.result === 'pass' && r.kind === 'platform' && r.dump === name && r.migrations?.newest === migration && r.migrations?.live === migration && r.counts?.platform_users === 1 && r.counts?.academies === 1 && stored?.result === 'pass' && before === after) pass('backup: the restore drill with the platform checks passes on that dump', `kind platform, newest = live = ${migration}, counts ${JSON.stringify(r.counts)}; live databases unchanged (${after})`);
  else fail('backup: the restore drill with the platform checks passes on that dump', `exit ${drill.code}: ${tail(drill.out, 6)}; databases ${before} -> ${after}`);

  const test = JSON.parse(run('docker', ['inspect', '--format', '{{json .Config.Healthcheck.Test}}', containerOf('backup')]).out.trim() || '[]');
  const health = test[0] === 'CMD-SHELL' ? compose(['exec', '-T', 'backup', 'sh', '-c', test[1]]).code : null;
  if (health === 0) pass('backup: the container health check is green after the passing drill', 'cron running, backup-last.json and drill-last.json pass');
  else fail('backup: the container health check is green after the passing drill', `health check exit ${health}`);

  // --- the documented restore: stop the database clients, restore, migrate, start ---
  const stateSql = `select (select count(*) from academies) || ',' || (select count(*) from platform_users) || ',' || (select count(*) from _prisma_migrations) || ',' || (to_regclass('public.t217_extra') is not null) || ',' || (has_table_privilege('${app}', 'public.academies', 'SELECT') and has_table_privilege('${app}', 'public.academies', 'INSERT') and has_table_privilege('${app}', 'public.academies', 'DELETE')) || ',' || (select count(*) from pg_trigger where tgname like 'trg_platform_audit_logs_%')`;
  const good = psql(stateSql);
  psql('delete from academies');
  psql('create table t217_extra (id int)', '"$PLATFORM_DB_NAME"', migrator);
  const damaged = psql(stateSql);
  const stop = compose(['stop', 'api', 'probe', 'edge']);
  const dry = compose(['exec', '-T', 'backup', 'restore.sh', name]);
  const untouched = psql(stateSql) === damaged;
  if (stop.code === 0 && dry.code === 2 && /--yes/.test(dry.out) && untouched) pass('backup: with api, probe and edge stopped, restore.sh without --yes only verifies and refuses', tail(dry.out, 1).replace(/^\S+ /, ''));
  else fail('backup: with api, probe and edge stopped, restore.sh without --yes only verifies and refuses', `stop ${stop.code}, dry run ${dry.code}: ${tail(dry.out, 3)}; untouched ${untouched}`);

  const restore = compose(['exec', '-T', 'backup', 'restore.sh', '--yes', name]);
  const restored = psql(stateSql);
  if (restore.code === 0 && /restore: done/.test(restore.out) && /start api, probe and edge/.test(restore.out) && restored === good && good.endsWith(',false,true,2')) pass('backup: restore.sh --yes puts the platform database back in one transaction', `academies,platform_users,_prisma_migrations,extra table,app grants,audit triggers: ${damaged} -> ${restored}`);
  else fail('backup: restore.sh --yes puts the platform database back in one transaction', `exit ${restore.code}: ${tail(restore.out, 4)}; before ${good}, damaged ${damaged}, after ${restored}`);

  const migrate = compose(['run', '--rm', '-T', 'migrate']);
  if (migrate.code === 0 && /No pending migrations to apply/i.test(migrate.out)) pass('backup: `run --rm migrate` after the restore has nothing pending');
  else fail('backup: `run --rm migrate` after the restore has nothing pending', `exit ${migrate.code}: ${tail(migrate.out, 6)}`);

  const start = compose(['start', 'api', 'probe', 'edge']);
  const healthy = start.code === 0 && (await apiHealthy(120));
  await waitFor(async () => (await http('/api/health').catch(() => ({ status: 0 }))).body?.status === 'ok', 60);
  const login = healthy ? await http('/api/auth/login', { method: 'POST', origin: ORIGIN, body: { identifier: email, password } }) : { status: 0 };
  if (healthy && login.status === 200 && login.body?.user?.role === 'super_admin') pass('backup: started again, api is healthy and the restored super admin signs in through the edge', 'POST /api/auth/login 200');
  else fail('backup: started again, api is healthy and the restored super admin signs in through the edge', `start ${start.code}, api ${JSON.stringify(stateOf('api'))}, login ${login.status}`);

  const allLogs = compose(['logs', '--no-log-prefix', 'backup']).out;
  const leaked = secrets.filter((secret) => secret && allLogs.includes(secret)).length;
  if (leaked === 0) pass('backup: no password in the backup container\'s logs', `${allLogs.trim().split('\n').length} log lines`);
  else fail('backup: no password in the backup container\'s logs', `${leaked} secret values`);
}

/** The newest platform migration of the committed tree (the name readiness must report). */
function newestPlatformMigration() {
  const dir = join(ROOT, 'backend', 'prisma', 'platform', 'migrations');
  return readdirSync(dir)
    .filter((name) => /^\d{14}_/.test(name) && statSync(join(dir, name)).isDirectory())
    .sort()
    .pop();
}

async function main() {
  if (run('docker', ['version', '--format', '{{.Server.Version}}']).code !== 0) {
    console.error('Docker is not reachable — start Docker Desktop (or the daemon) first.');
    process.exit(2);
  }
  if (!Number.isInteger(PORT) || PORT < 1024 || HTTPS_PORT > 65535) {
    console.error('--port must be an integer 1024–65534 (the HTTPS port is <port>+1)');
    process.exit(2);
  }
  console.log(`TEST-211 — platform compose project ${PROJECT} on ${ORIGIN} (images :${TAG})`);
  const migration = newestPlatformMigration();

  // --- the env generator ---------------------------------------------------------
  const genArgs = ['deploy/scripts/new-platform-env.mjs', '--local', '--port', String(PORT), '--https-port', String(HTTPS_PORT), '--tag', TAG, '--out', envFile];
  const gen = run(process.execPath, genArgs);
  const values = SECRET_NAMES.map(envValue);
  secrets.push(...values);
  const printed = values.some((v) => v && gen.out.includes(v));
  // PMFA (ENV-91): the MFA key is an AES-256 key, exactly 32 bytes once decoded.
  const mfaKeyBytes = Buffer.from(envValue('PLATFORM_MFA_ENCRYPTION_KEY'), 'base64').length;
  if (gen.code === 0 && values.every((v) => v.length >= 32) && new Set(values).size === values.length && mfaKeyBytes === 32 && !printed) pass('the env generator writes random secrets without printing them', SECRET_NAMES.join(', '));
  else return fail('the env generator writes random secrets without printing them', `exit ${gen.code}${printed ? ', a secret was printed' : ''}${mfaKeyBytes === 32 ? '' : `, PLATFORM_MFA_ENCRYPTION_KEY is ${mfaKeyBytes} bytes`}`);
  const before = readFileSync(envFile, 'utf8');
  const again = run(process.execPath, genArgs);
  if (again.code !== 0 && /never overwritten/.test(again.out) && readFileSync(envFile, 'utf8') === before) pass('the env generator never overwrites an env file');
  else fail('the env generator never overwrites an env file', `exit ${again.code}`);

  const config = compose(['config', '--quiet']);
  if (config.code === 0) pass('compose config is valid with the generated env file');
  else return fail('compose config is valid with the generated env file', tail(config.out, 10));

  // --- KI-087: the account commands run in `account`, which keeps no Docker log --------------
  // The rendered file holds the env file's secrets: it is parsed here and never printed.
  const rendered = compose(['--profile', 'tools', 'config', '--format', 'json']);
  let services = {};
  try {
    services = JSON.parse(rendered.stdout).services ?? {};
  } catch {
    // reported by the checks below
  }
  const account = services.account ?? {};
  if (rendered.code === 0 && account.logging?.driver === 'none' && account.profiles?.includes('tools') && account.build?.target === 'tools' && account.image === services.migrate?.image && account.restart === 'no' && account.cap_drop?.includes('ALL') && account.security_opt?.includes('no-new-privileges:true'))
    pass('account: the tools image under the `tools` profile, hardened, with the `none` log driver (KI-087)', `image ${account.image}, profiles ${account.profiles.join(',')}, logging ${account.logging.driver}`);
  else fail('account: the tools image under the `tools` profile, hardened, with the `none` log driver (KI-087)', `config exit ${rendered.code}; ${JSON.stringify({ logging: account.logging, profiles: account.profiles, target: account.build?.target, image: account.image, restart: account.restart })}`);
  const accountEnv = Object.keys(account.environment ?? {}).sort();
  const appDb = ['DB_HOST', 'POSTGRES_PORT', 'PLATFORM_DB_NAME', 'PLATFORM_DB_APP_USER', 'PLATFORM_DB_APP_PASSWORD'];
  if (appDb.every((n) => accountEnv.includes(n)) && accountEnv.includes('PLATFORM_MFA_ENCRYPTION_KEY') && !accountEnv.some((n) => /MIGRATOR|JWT|^POSTGRES_PASSWORD$|^POSTGRES_USER$/.test(n)))
    pass('account: the application role and PLATFORM_MFA_ENCRYPTION_KEY, never the migrator, the superuser or the JWT secret', accountEnv.join(', '));
  else fail('account: the application role and PLATFORM_MFA_ENCRYPTION_KEY, never the migrator, the superuser or the JWT secret', accountEnv.join(', '));
  const migrateEnv = Object.keys(services.migrate?.environment ?? {}).sort();
  if (migrateEnv.includes('PLATFORM_DB_MIGRATOR_PASSWORD') && !migrateEnv.includes('PLATFORM_MFA_ENCRYPTION_KEY')) pass('migrate no longer receives PLATFORM_MFA_ENCRYPTION_KEY', migrateEnv.join(', '));
  else fail('migrate no longer receives PLATFORM_MFA_ENCRYPTION_KEY', migrateEnv.join(', '));
  const listed = compose(['config', '--services']);
  const defaultServices = listed.stdout.trim().split(/\r?\n/);
  if (listed.code === 0 && defaultServices.includes('migrate') && !defaultServices.includes('account')) pass('account is outside the default profile', `up starts ${defaultServices.join(', ')}`);
  else fail('account is outside the default profile', `exit ${listed.code}: ${defaultServices.join(', ')}`);

  // --- up --------------------------------------------------------------------------
  const started = Date.now();
  const up = compose(['up', '-d', ...(flag('--no-build') ? ['--no-build'] : ['--build'])]);
  if (up.code !== 0) {
    fail('docker compose up', `exit ${up.code}`);
    console.log(tail(up.out, 40));
    return;
  }
  const migrate = stateOf('migrate');
  const migrateLog = compose(['logs', '--no-log-prefix', 'migrate']).out;
  if (migrate.status === 'exited' && migrate.exit === 0 && migrateLog.includes(migration) && /successfully applied/i.test(migrateLog)) pass('migrate applied the platform migrations and exited 0', `${migration}; ${Math.round((Date.now() - started) / 1000)} s including the build`);
  else {
    fail('migrate applied the platform migrations and exited 0', JSON.stringify(migrate));
    console.log(tail(migrateLog, 30));
  }
  if (await apiHealthy(120)) pass('api is healthy (its health check is the platform readiness endpoint)');
  else {
    fail('api is healthy (its health check is the platform readiness endpoint)', JSON.stringify(stateOf('api')));
    console.log(tail(compose(['logs', '--tail', '40', 'api']).out));
    return;
  }
  const createdAccounts = containersOfService('account');
  const migrateHasKey = containerEnv(containerOf('migrate')).some((e) => e.startsWith('PLATFORM_MFA_ENCRYPTION_KEY='));
  if (createdAccounts === '' && !migrateHasKey) pass('`up` creates no account container, and the migrate container carries no PLATFORM_MFA_ENCRYPTION_KEY');
  else fail('`up` creates no account container, and the migrate container carries no PLATFORM_MFA_ENCRYPTION_KEY', `account containers: ${createdAccounts.split('\n').filter(Boolean).length}; key in migrate: ${migrateHasKey}`);

  // --- through the edge origin ----------------------------------------------------------
  await waitFor(async () => (await http('/api/health').catch(() => ({ status: 0 }))).body?.status === 'ok', 60);
  const health = await http('/api/health');
  if (health.status === 200 && health.body?.service === 'articode-platform-api' && health.body?.environment === 'production' && !health.headers.has('server')) pass('/api/health through the edge: 200, articode-platform-api in production', `version ${health.body.version}, no Server header`);
  else fail('/api/health through the edge: 200, articode-platform-api in production', `${health.status} ${health.text.slice(0, 200)} server=${health.headers.get('server')}`);

  const ready = await http('/api/health/ready');
  const schema = ready.body?.checks?.schema;
  if (ready.status === 200 && ready.body?.status === 'ready' && ready.body?.checks?.database?.status === 'up' && schema?.status === 'current' && schema.expected === migration && schema.applied === migration) pass('/api/health/ready through the edge: 200, schema current', `expected = applied = ${migration} (prisma/platform/migrations is in the runtime image)`);
  else fail('/api/health/ready through the edge: 200, schema current', `${ready.status} ${ready.text.slice(0, 300)}`);

  const docs = await http('/api/docs');
  if (docs.status === 404) pass('Swagger is off in production', '/api/docs 404');
  else fail('Swagger is off in production', `/api/docs ${docs.status}`);

  // --- the first super admin ---------------------------------------------------------------
  const email = `ops-${RUN}@example.test`;
  const password = `T211-${randomBytes(15).toString('base64url')}`;
  secrets.push(password);
  const boot = compose(['run', '--rm', '-T', '-e', 'PLATFORM_BOOTSTRAP_EMAIL', '-e', 'PLATFORM_BOOTSTRAP_FULL_NAME', '-e', 'PLATFORM_BOOTSTRAP_PASSWORD', 'account', 'npm', 'run', '--silent', 'platform:bootstrap-admin'], { env: { PLATFORM_BOOTSTRAP_EMAIL: email, PLATFORM_BOOTSTRAP_FULL_NAME: 'T211 Operator', PLATFORM_BOOTSTRAP_PASSWORD: password } });
  if (boot.code === 0 && /First platform super admin created/.test(boot.out) && !boot.out.includes(password) && containersOfService('account') === '') pass('the first super admin is created with the documented command', 'compose run --rm account npm run platform:bootstrap-admin; its output reached the caller, no container left');
  else fail('the first super admin is created with the documented command', `exit ${boot.code}: ${tail(boot.out, 6)}`);

  // KI-087 at run time: a `run` container of account (kept here, without --rm, to be inspected).
  const usageName = `${PROJECT}-account-usage`;
  const usage = compose(['run', '-T', '--name', usageName, 'account']);
  const [logType, capDrop, securityOpt, user, usageExit] = run('docker', ['inspect', '--format', '{{.HostConfig.LogConfig.Type}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{.Config.User}}|{{.State.ExitCode}}', usageName]).out.trim().split('|');
  const usageLogs = run('docker', ['logs', usageName]);
  const usageKey = containerEnv(usageName).includes(`PLATFORM_MFA_ENCRYPTION_KEY=${envValue('PLATFORM_MFA_ENCRYPTION_KEY')}`);
  run('docker', ['rm', '-f', usageName]);
  if (usage.code === 0 && /platform:enable-mfa -- --email/.test(usage.out) && logType === 'none' && usageExit === '0' && !usageLogs.out.includes('platform:enable-mfa') && /"ALL"/.test(capDrop) && /no-new-privileges:true/.test(securityOpt) && user === 'node' && usageKey)
    pass('a `run` container of account keeps no Docker log; its default command only lists the account commands', `LogConfig.Type none; docker logs: ${tail(usageLogs.out, 1) || 'nothing'}; user node, cap_drop ALL, no-new-privileges; the API's MFA key; exit 0`);
  else fail('a `run` container of account keeps no Docker log; its default command only lists the account commands', `run exit ${usage.code}, LogConfig.Type ${logType}, exit ${usageExit}, user ${user}, key ${usageKey}, docker logs: ${tail(usageLogs.out, 3)}; output: ${tail(usage.out, 4)}`);

  const login = await http('/api/auth/login', { method: 'POST', origin: ORIGIN, body: { identifier: email, password } });
  const token = login.body?.accessToken;
  const cookie = login.headers.getSetCookie().find((c) => c.startsWith('pla_refresh=')) ?? '';
  const cookieOk = /;\s*HttpOnly/i.test(cookie) && /;\s*Path=\/api\/auth/i.test(cookie) && /;\s*SameSite=Strict/i.test(cookie) && /;\s*Secure/i.test(cookie);
  if (login.status === 200 && token && login.body?.user?.role === 'super_admin' && cookieOk) pass('the super admin signs in through the edge', 'POST /api/auth/login 200; pla_refresh HttpOnly, Secure, SameSite=Strict, Path=/api/auth');
  else fail('the super admin signs in through the edge', `login ${login.status} ${login.body?.code ?? ''}; cookie ${cookie ? 'present' : 'absent'}${cookie && !cookieOk ? ' with unexpected attributes' : ''}`);
  if (!token) return;
  const me = await http('/api/auth/me', { token });
  if (me.status === 200 && (me.body?.email ?? me.body?.user?.email) === email) pass('GET /api/auth/me with the platform token', '200');
  else fail('GET /api/auth/me with the platform token', `${me.status}`);

  const slug = `t211-${RUN}`;
  const academy = { slug, name: { ar: 'أكاديمية الاختبار', en: 'T211 Academy' }, origin: 'https://academy-t211.invalid' };
  const foreign = await http('/api/academies', { method: 'POST', token, origin: 'https://elsewhere.example', body: academy });
  if (foreign.status === 403 && foreign.body?.code === 'origin_forbidden') pass('a write from a foreign Origin is refused', '403 origin_forbidden (PLATFORM_CORS_ORIGIN = the platform origin)');
  else fail('a write from a foreign Origin is refused', `${foreign.status} ${foreign.body?.code ?? ''}`);

  // --- the registry and the fleet probe ---------------------------------------------------
  const created = await http('/api/academies', { method: 'POST', token, origin: ORIGIN, body: academy });
  const academyId = created.body?.id;
  if (created.status === 201 && academyId && created.body?.origin === academy.origin) pass('POST /api/academies registers an academy', `201, ${slug} at ${academy.origin}`);
  else return fail('POST /api/academies registers an academy', `${created.status} ${created.text.slice(0, 300)}`);

  const probe = await http(`/api/academies/${academyId}/probe`, { method: 'POST', token, origin: ORIGIN });
  if (probe.status === 201 && probe.body?.outcome === 'unreachable') pass('POST /api/academies/:id/probe runs the probe inside the image', `201, outcome unreachable (${probe.body?.reason ?? ''}: an https origin that does not resolve)`);
  else fail('POST /api/academies/:id/probe runs the probe inside the image', `${probe.status} ${probe.text.slice(0, 300)}`);

  const fleet = await http('/api/fleet', { token });
  const item = fleet.body?.items?.find((i) => i.academy?.slug === slug);
  if (fleet.status === 200 && item?.latest?.outcome === 'unreachable' && fleet.body?.counts?.unreachable >= 1 && typeof fleet.body?.newestAcademyMigration === 'string') pass('GET /api/fleet lists the academy with its check', `outcome unreachable; newest academy migration of the image ${fleet.body.newestAcademyMigration}`);
  else fail('GET /api/fleet lists the academy with its check', `${fleet.status} ${fleet.text.slice(0, 300)}`);

  let round = '';
  await waitFor(() => {
    round = compose(['logs', '--no-log-prefix', 'probe']).out.split('\n').find((l) => l.includes('"event":"platform.probe.round"')) ?? '';
    return round !== '';
  }, 60);
  if (round) pass('the probe service printed its first round', round.trim());
  else fail('the probe service printed its first round', tail(compose(['logs', '--no-log-prefix', 'probe']).out, 5));

  // --- a second up ------------------------------------------------------------------------
  const countSql = "select (select count(*) from platform_users) || ',' || (select count(*) from academies) || ',' || (select count(*) from _prisma_migrations)";
  const counts1 = psql(countSql);
  const second = compose(['up', '-d', '--no-build']);
  const migrate2 = stateOf('migrate');
  const logs2 = compose(['logs', '--no-log-prefix', 'migrate']).out;
  const counts2 = psql(countSql);
  if (second.code === 0 && migrate2.exit === 0 && /No pending migrations to apply/i.test(logs2) && counts1 === counts2 && counts1.startsWith('1,1,')) pass('a second up repeats migrate with nothing pending and duplicates nothing', `platform_users,academies,_prisma_migrations = ${counts2}`);
  else fail('a second up repeats migrate with nothing pending and duplicates nothing', `up ${second.code}, migrate ${JSON.stringify(migrate2)}, before ${counts1}, after ${counts2}`);
  if (await apiHealthy(90)) pass('api is healthy again after the second up');
  else fail('api is healthy again after the second up', JSON.stringify(stateOf('api')));

  // --- the database -------------------------------------------------------------------------
  const dbId = containerOf('db');
  const bindings = run('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}|{{json .NetworkSettings.Ports}}', dbId]).out.trim();
  if (!/"HostPort"/.test(bindings)) pass('the database publishes no port on the host', bindings);
  else fail('the database publishes no port on the host', bindings);

  const roles = psql(`select rolname || '=' || rolcreatedb from pg_roles where rolname in ('${envValue('PLATFORM_DB_MIGRATOR_USER')}', '${envValue('PLATFORM_DB_APP_USER')}') order by 1`).replace(/\n/g, ', ');
  const owner = psql("select pg_get_userbyid(datdba) from pg_database where datname = current_database()");
  if (roles === 'platform_app=false, platform_migrator=false' && owner === envValue('PLATFORM_DB_MIGRATOR_USER')) pass('the platform migrator has no CREATEDB and owns the platform database', `${roles}; owner ${owner}`);
  else fail('the platform migrator has no CREATEDB and owns the platform database', `${roles}; owner ${owner}`);

  const academyRoles = psql("select count(*) from pg_roles where rolname in ('articode', 'articode_migrator', 'articode_app')");
  const databases = psql('select string_agg(datname, \',\' order by datname) from pg_database where not datistemplate', 'postgres');
  if (academyRoles === '0' && databases === `${envValue('PLATFORM_DB_NAME')},postgres`) pass('no academy role or database in the platform cluster', `databases ${databases} (10-roles.sh is not mounted)`);
  else fail('no academy role or database in the platform cluster', `academy roles ${academyRoles}, databases ${databases}`);

  // --- TEST-217: backup, drill, restore (KI-083) --------------------------------------------
  await checkBackup({ email, password, migration });

  // --- hardening ------------------------------------------------------------------------------
  for (const service of ['api', 'probe', 'edge']) {
    const id = containerOf(service);
    const inspect = run('docker', ['inspect', '--format', '{{.State.Status}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}', id]).out.trim();
    const [status, capDrop, securityOpt] = inspect.split('|');
    const uid = run('docker', ['exec', id, 'id', '-u']).out.trim();
    if (status === 'running' && /"ALL"/.test(capDrop) && /no-new-privileges:true/.test(securityOpt) && /^\d+$/.test(uid) && uid !== '0') pass(`${service} runs non-root, without capabilities`, `uid ${uid}, cap_drop ALL, no-new-privileges`);
    else fail(`${service} runs non-root, without capabilities`, `${inspect}; uid ${uid}`);
  }
}

const keep = flag('--keep');
try {
  await main();
} catch (error) {
  fail('unexpected error', error.message);
} finally {
  if (results.includes('FAIL') && !keep) console.log(tail(compose(['ps', '-a']).out, 20));
  if (keep) console.log(`kept: docker compose -p ${PROJECT} -f deploy/compose.platform.yaml --env-file ${envFile} down -v`);
  else {
    // This test's own throwaway project only: its containers, volumes and network.
    compose(['down', '-v', '--remove-orphans']);
    rmSync(tmp, { recursive: true, force: true });
  }
}
const failed = results.filter((r) => r === 'FAIL').length;
console.log(`RESULT ${results.filter((r) => r === 'PASS').length} PASS / ${failed} FAIL / ${results.filter((r) => r === 'SKIP').length} SKIP`);
process.exit(failed ? 1 : 0);
