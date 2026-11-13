#!/usr/bin/env node
// TEST-211 — the platform as a Docker Compose project (MOD-18-T06, roadmap §4m.5, D-R104).
//
// Run from the repository root with Docker running (Node >= 22, no npm install):
//
//   node deploy/tests/platform-compose.test.mjs               build the images, bring a platform up, check, take it down
//   node deploy/tests/platform-compose.test.mjs --no-build    use images already tagged articode-api*:<tag> / articode-platform-edge:<tag>
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
//   - the first super admin is created with the documented command and signs in through the
//     edge (a `pla_refresh` cookie); a foreign Origin is refused (PLATFORM_CORS_ORIGIN);
//   - an academy is registered and probed from inside the image (https only in production:
//     an unresolvable https origin is `unreachable`), and the fleet view lists it;
//   - the `probe` service printed its first `platform.probe.round` line;
//   - a second `up` repeats migrate with nothing pending and duplicates nothing;
//   - the database publishes no host port, the platform migrator has no CREATEDB and owns
//     the platform database, and no academy role or database exists in this cluster
//     (10-roles.sh is not mounted);
//   - api, probe and edge run as non-root users with every capability dropped and
//     no-new-privileges.
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
const SECRET_NAMES = ['POSTGRES_PASSWORD', 'PLATFORM_DB_MIGRATOR_PASSWORD', 'PLATFORM_DB_APP_PASSWORD', 'PLATFORM_JWT_SECRET'];

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
  return { code: res.status ?? 1, out: (res.stdout ?? '') + (res.stderr ?? '') + (res.error ? String(res.error) : '') };
}

/** `docker compose` on this test's project only. */
const compose = (argv, opts) => run('docker', ['compose', '-p', PROJECT, '-f', 'deploy/compose.platform.yaml', '--env-file', envFile, ...argv], opts);

function envValue(name) {
  const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1) : '';
}

function psql(sql, database = '"$PLATFORM_DB_NAME"') {
  // As the superuser, over the container's local socket (trust) — this test's own throwaway cluster.
  const res = compose(['exec', '-T', 'db', 'sh', '-c', `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${database} -Atc "$0"`, sql]);
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
  if (gen.code === 0 && values.every((v) => v.length >= 32) && new Set(values).size === values.length && !printed) pass('the env generator writes random secrets without printing them', SECRET_NAMES.join(', '));
  else return fail('the env generator writes random secrets without printing them', `exit ${gen.code}${printed ? ', a secret was printed' : ''}`);
  const before = readFileSync(envFile, 'utf8');
  const again = run(process.execPath, genArgs);
  if (again.code !== 0 && /never overwritten/.test(again.out) && readFileSync(envFile, 'utf8') === before) pass('the env generator never overwrites an env file');
  else fail('the env generator never overwrites an env file', `exit ${again.code}`);

  const config = compose(['config', '--quiet']);
  if (config.code === 0) pass('compose config is valid with the generated env file');
  else return fail('compose config is valid with the generated env file', tail(config.out, 10));

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
  const boot = compose(['run', '--rm', '-T', '-e', 'PLATFORM_BOOTSTRAP_EMAIL', '-e', 'PLATFORM_BOOTSTRAP_FULL_NAME', '-e', 'PLATFORM_BOOTSTRAP_PASSWORD', 'migrate', 'npm', 'run', '--silent', 'platform:bootstrap-admin'], { env: { PLATFORM_BOOTSTRAP_EMAIL: email, PLATFORM_BOOTSTRAP_FULL_NAME: 'T211 Operator', PLATFORM_BOOTSTRAP_PASSWORD: password } });
  if (boot.code === 0 && /First platform super admin created/.test(boot.out) && !boot.out.includes(password)) pass('the first super admin is created with the documented command', 'compose run --rm migrate npm run platform:bootstrap-admin');
  else fail('the first super admin is created with the documented command', `exit ${boot.code}: ${tail(boot.out, 6)}`);

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
