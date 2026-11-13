#!/usr/bin/env node
// TEST-202 (compose part) — one academy as a Docker Compose project (MOD-17-T03, roadmap §4l.5, ADR-072).
//
// Run from the repository root with Docker running (Node >= 22, no npm install):
//
//   node deploy/tests/academy-compose.test.mjs               build the images, bring an academy up, check, take it down
//   node deploy/tests/academy-compose.test.mjs --no-build    use images already tagged articode-*:<tag>
//   node deploy/tests/academy-compose.test.mjs --keep        leave the project running (prints how to remove it)
//   node deploy/tests/academy-compose.test.mjs --tag t202 --port 18202
//
// A throwaway academy `academy-t202-<run>` on http://localhost:<port> (127.0.0.1 only), with an
// env file written by deploy/scripts/new-academy-env.mjs into a temp directory (random secrets,
// never printed). What it proves (the acceptance criteria of MOD-17-T03):
//   AC1  from the repository and a generated env file the academy comes up: migrate completes,
//        api is healthy (readiness 200, schema current), the UI and /api answer on one origin,
//        the first admin is created with the documented command and signs in;
//   AC2  a second `up` repeats migrate (nothing pending) and the seed without duplicating anything;
//   AC3  a failed migration keeps `api` from starting, and an api whose image carries a newer
//        migration than the database answers 503 `schema_outdated`;
//   AC4  the database publishes no port on the host;
//   AC5  the migrator role has no CREATEDB.
// Then: backup and maintenance are running, the maintenance loop printed its first line.
// The project, its volumes and its network are removed at the end (never another project's).

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const TAG = option('--tag', 't202');
const PORT = Number(option('--port', String(18000 + Math.floor(Math.random() * 1000))));
const RUN = randomBytes(3).toString('hex');
const PROJECT = `academy-t202-${RUN}`;
const ORIGIN = `http://localhost:${PORT}`;
// The site answers its own host only (Caddy serves an empty 200 to any other Host),
// so requests go to the origin itself — localhost, published on 127.0.0.1.
const BASE = ORIGIN;

const results = [];
const report = (status, name, detail = '') => {
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
};
const pass = (n, d) => report('PASS', n, d);
const fail = (n, d) => report('FAIL', n, d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tail = (text, lines = 25) => text.trim().split('\n').slice(-lines).join('\n');

const tmp = mkdtempSync(join(tmpdir(), 'articode-t202-'));
const envFile = join(tmp, `${PROJECT}.env`);

function run(cmd, argv, { env, input, timeoutMs = 20 * 60_000 } = {}) {
  const res = spawnSync(cmd, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { code: res.status ?? 1, out: (res.stdout ?? '') + (res.stderr ?? '') + (res.error ? String(res.error) : '') };
}

/** `docker compose` on this test's project only. */
const compose = (argv, opts) => run('docker', ['compose', '-p', PROJECT, '-f', 'deploy/compose.academy.yaml', '--env-file', envFile, ...argv], opts);

function envValue(name) {
  const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1) : '';
}

function psql(sql) {
  // As the superuser, over the container's local socket (trust) — the test's own throwaway database.
  const res = compose(['exec', '-T', 'db', 'sh', '-c', 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"', sql]);
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

async function http(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, type: res.headers.get('content-type') ?? '', body, text };
}

async function apiHealthy(seconds) {
  return waitFor(() => stateOf('api').health === 'healthy', seconds);
}

async function main() {
  if (run('docker', ['version', '--format', '{{.Server.Version}}']).code !== 0) {
    console.error('Docker is not reachable — start Docker Desktop (or the daemon) first.');
    process.exit(2);
  }
  console.log(`TEST-202 — academy compose project ${PROJECT} on ${ORIGIN} (images :${TAG})`);

  const gen = run(process.execPath, ['deploy/scripts/new-academy-env.mjs', `t202-${RUN}`, '--local', '--port', String(PORT), '--name-ar', 'أكاديمية الاختبار', '--name-en', 'T202 Academy', '--timezone', 'UTC', '--currency', 'USD', '--tag', TAG, '--out', envFile]);
  const secretNames = ['POSTGRES_PASSWORD', 'DB_MIGRATOR_PASSWORD', 'DB_APP_PASSWORD', 'JWT_SECRET'];
  const secrets = secretNames.map(envValue);
  if (gen.code === 0 && secrets.every((v) => v.length >= 32) && !secrets.some((v) => gen.out.includes(v))) pass('the env generator writes random secrets without printing them', secretNames.join(', '));
  else return fail('the env generator writes random secrets without printing them', tail(gen.out, 5));

  const config = compose(['config', '--quiet']);
  if (config.code === 0) pass('compose config is valid with the generated env file');
  else return fail('compose config is valid with the generated env file', tail(config.out, 10));

  // --- AC1 ----------------------------------------------------------------------
  const started = Date.now();
  const up = compose(['up', '-d', ...(flag('--no-build') ? ['--no-build'] : ['--build'])]);
  if (up.code !== 0) {
    fail('AC1 docker compose up', `exit ${up.code}`);
    console.log(tail(up.out, 40));
    return;
  }
  const migrate = stateOf('migrate');
  if (migrate.status === 'exited' && migrate.exit === 0) pass('AC1 migrate ran once and completed', `${Math.round((Date.now() - started) / 1000)} s including the build`);
  else fail('AC1 migrate ran once and completed', JSON.stringify(migrate));
  if (await apiHealthy(120)) pass('AC1 api is healthy (its health check is the readiness endpoint)');
  else {
    fail('AC1 api is healthy (its health check is the readiness endpoint)', JSON.stringify(stateOf('api')));
    console.log(tail(compose(['logs', '--tail', '40', 'api']).out));
    return;
  }

  await waitFor(async () => (await http('/api/health').catch(() => ({ status: 0 }))).body?.status === 'ok', 60);
  const ready = await http('/api/health/ready');
  const schema = ready.body?.checks?.schema;
  if (ready.status === 200 && ready.body?.checks?.database?.status === 'up' && schema?.status === 'current' && schema.expected && schema.expected === schema.applied) pass('AC1 readiness through the web origin: 200, schema current', schema.expected);
  else fail('AC1 readiness through the web origin: 200, schema current', `${ready.status} ${JSON.stringify(ready.body)}`);
  const page = await http('/classes');
  if (page.status === 200 && page.type.includes('text/html')) pass('AC1 the UI is served on the same origin (a deep path gets index.html)');
  else fail('AC1 the UI is served on the same origin (a deep path gets index.html)', `${page.status} ${page.type}`);

  const email = `admin-${RUN}@example.test`;
  const password = `T202-${randomBytes(12).toString('base64url')}`;
  const boot = compose(['run', '--rm', '-T', '-e', 'BOOTSTRAP_ADMIN_EMAIL', '-e', 'BOOTSTRAP_ADMIN_FULL_NAME', '-e', 'BOOTSTRAP_ADMIN_PASSWORD', 'migrate', 'npm', 'run', '--silent', 'auth:bootstrap-admin'], { env: { BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_FULL_NAME: 'T202 Admin', BOOTSTRAP_ADMIN_PASSWORD: password } });
  if (boot.code === 0 && /First academy admin created/.test(boot.out) && !boot.out.includes(password)) pass('AC1 the first admin is created with the documented command', 'compose run --rm migrate npm run auth:bootstrap-admin');
  else fail('AC1 the first admin is created with the documented command', tail(boot.out.replaceAll(password, '***'), 8));

  const login = await http('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ identifier: email, password }) });
  const token = login.body?.accessToken;
  const me = token ? await http('/api/auth/me', { headers: { authorization: `Bearer ${token}` } }) : { status: 0 };
  if (login.status === 200 && me.status === 200 && (me.body?.email ?? me.body?.user?.email) === email) pass('AC1 the first admin signs in through the web origin', 'POST /api/auth/login 200, GET /api/auth/me 200');
  else fail('AC1 the first admin signs in through the web origin', `login ${login.status} ${login.body?.code ?? ''}, me ${me.status}`);

  // --- AC2 ----------------------------------------------------------------------
  const before = psql('select (select count(*) from academy) || \',\' || (select count(*) from roles) || \',\' || (select count(*) from permissions) || \',\' || (select count(*) from users)');
  const again = compose(['up', '-d', '--no-build']);
  const migrate2 = stateOf('migrate');
  const logs2 = compose(['logs', '--no-log-prefix', 'migrate']).out;
  const after = psql('select (select count(*) from academy) || \',\' || (select count(*) from roles) || \',\' || (select count(*) from permissions) || \',\' || (select count(*) from users)');
  if (again.code === 0 && migrate2.exit === 0 && /No pending migrations to apply/i.test(logs2) && before === after && before.startsWith('1,')) pass('AC2 a second up repeats migrate and the seed without duplicating anything', `academy,roles,permissions,users = ${after}`);
  else fail('AC2 a second up repeats migrate and the seed without duplicating anything', `up ${again.code}, migrate ${JSON.stringify(migrate2)}, before ${before}, after ${after}`);
  if (await apiHealthy(90)) pass('AC2 api is healthy again after the second up');
  else fail('AC2 api is healthy again after the second up', JSON.stringify(stateOf('api')));

  // --- AC3: a failed migration keeps api stopped ------------------------------------
  compose(['stop', 'api', 'web']);
  compose(['rm', '-f', 'api']);
  const broken = compose(['up', '-d', '--no-build', 'api'], { env: { DB_MIGRATOR_PASSWORD: `wrong-${randomBytes(8).toString('hex')}` } });
  const migrate3 = stateOf('migrate');
  const api3 = stateOf('api');
  if (broken.code !== 0 && migrate3.status === 'exited' && migrate3.exit !== 0 && api3.status !== 'running') pass('AC3 a failed migration keeps api stopped', `up exit ${broken.code}, migrate exit ${migrate3.exit}, api ${api3.status}`);
  else fail('AC3 a failed migration keeps api stopped', `up exit ${broken.code}, migrate ${JSON.stringify(migrate3)}, api ${JSON.stringify(api3)}`);
  const healed = compose(['up', '-d', '--no-build']);
  if (healed.code === 0 && (await apiHealthy(120))) pass('AC3 the next up with the right env migrates and starts api');
  else fail('AC3 the next up with the right env migrates and starts api', `exit ${healed.code} ${JSON.stringify(stateOf('api'))}`);

  // --- AC3: an image newer than the database -----------------------------------------
  const future = join(tmp, 'migrations-future', '29991231235959_t202_future');
  mkdirSync(future, { recursive: true });
  writeFileSync(join(future, 'migration.sql'), '-- TEST-202: a migration this database has not applied\nSELECT 1;\n');
  const probeName = `${PROJECT}-newer-api`;
  const probe = compose(['run', '-d', '--no-deps', '--name', probeName, '-v', `${future}:/app/prisma/migrations/29991231235959_t202_future:ro`, 'api']);
  if (probe.code !== 0) fail('AC3 an image with a newer migration answers 503 schema_outdated', tail(probe.out, 5));
  else {
    let answer = '';
    await waitFor(() => {
      const r = run('docker', ['exec', probeName, 'node', '-e', "fetch('http://127.0.0.1:3000/api/health/ready').then(async r=>console.log(r.status+' '+await r.text()),e=>console.log('error '+e.message))"]);
      answer = r.out.trim();
      return /^\d{3} /.test(answer);
    }, 60);
    const [status, ...rest] = answer.split(' ');
    let body = {};
    try {
      body = JSON.parse(rest.join(' '));
    } catch {
      // keep empty
    }
    if (status === '503' && body.reason === 'schema_outdated' && body.checks?.schema?.status === 'outdated' && body.checks.schema.expected === '29991231235959_t202_future') pass('AC3 an image with a newer migration answers 503 schema_outdated', `expected ${body.checks.schema.expected}, applied ${body.checks.schema.applied}`);
    else fail('AC3 an image with a newer migration answers 503 schema_outdated', answer.slice(0, 300));
    run('docker', ['rm', '-f', probeName]);
  }

  // --- AC4 / AC5 -------------------------------------------------------------------------
  const dbId = containerOf('db');
  const bindings = run('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}|{{json .NetworkSettings.Ports}}', dbId]).out.trim();
  const published = /"HostPort"/.test(bindings);
  if (!published) pass('AC4 the database publishes no port on the host', bindings);
  else fail('AC4 the database publishes no port on the host', bindings);

  const createdb = psql(`select rolname || '=' || rolcreatedb from pg_roles where rolname in ('${envValue('DB_MIGRATOR_USER')}', '${envValue('DB_APP_USER')}') order by 1`).replace(/\n/g, ', ');
  if (/articode_app=false/.test(createdb) && /articode_migrator=false/.test(createdb)) pass('AC5 the migrator role has no CREATEDB in production', createdb);
  else fail('AC5 the migrator role has no CREATEDB in production', createdb);

  // --- the other services ------------------------------------------------------------------
  for (const service of ['backup', 'maintenance', 'web']) {
    const s = stateOf(service);
    if (s.status === 'running') pass(`${service} is running`);
    else fail(`${service} is running`, JSON.stringify(s));
  }
  const maintenanceLog = compose(['logs', '--no-log-prefix', 'maintenance']).out;
  if (/"event":"maintenance.pruned"/.test(maintenanceLog)) pass('maintenance printed its first run', maintenanceLog.trim().split('\n').find((l) => l.includes('maintenance.pruned')));
  else fail('maintenance printed its first run', tail(maintenanceLog, 5));
}

let keep = flag('--keep');
try {
  await main();
} catch (error) {
  fail('unexpected error', error.message);
} finally {
  if (results.includes('FAIL') && !keep) console.log(tail(compose(['ps', '-a']).out, 20));
  if (keep) console.log(`kept: docker compose -p ${PROJECT} -f deploy/compose.academy.yaml --env-file ${envFile} down -v`);
  else {
    // This test's own throwaway project only: its containers, volumes and network.
    compose(['down', '-v', '--remove-orphans']);
    rmSync(tmp, { recursive: true, force: true });
  }
}
const failed = results.filter((r) => r === 'FAIL').length;
console.log(`RESULT ${results.filter((r) => r === 'PASS').length} PASS / ${failed} FAIL / ${results.filter((r) => r === 'SKIP').length} SKIP`);
process.exit(failed ? 1 : 0);
