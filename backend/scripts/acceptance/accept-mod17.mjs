// MOD-17 acceptance journey (roadmap 4l.9) — run through accept-mod17.ps1, which pipes one JSON object on
// stdin: { port, keep, noBuild, admin: { email, password } }. The password is never printed.
//
// Brings up the demo academy `academy-demo` on http://localhost:<port> (published on 127.0.0.1 only) from
// this repository with deploy/compose.academy.yaml and an env file written by
// deploy/scripts/new-academy-env.mjs into a temp folder (random secrets, never printed), then:
// migrate + api healthy → readiness and the UI on one origin → the first admin (the documented command)
// signs in → a backup → the restore drill → maintenance ran → the database publishes no port and the
// migrator has no CREATEDB → the demo academy is taken down with its volumes (unless keep).
// Prints PASS / FAIL / SKIP lines, EVIDENCE lines and a RESULT line; exit 1 on any FAIL.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROJECT = 'academy-demo';

const input = JSON.parse(readFileSync(0, 'utf8').replace(/^﻿/, ''));
const PORT = Number(input.port) || 8080;
const ORIGIN = PORT === 80 ? 'http://localhost' : `http://localhost:${PORT}`;
// The site answers its own host only (Caddy serves an empty 200 to any other Host).
const BASE = ORIGIN;
const ADMIN = input.admin ?? {};

const results = [];
const line = (status, name, detail = '') => {
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
};
const pass = (n, d) => line('PASS', n, d);
const fail = (n, d) => line('FAIL', n, d);
const evidence = (text) => console.log(`EVIDENCE ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tail = (text, n = 20) => text.trim().split('\n').slice(-n).join('\n');
const mask = (text) => (ADMIN.password ? text.split(ADMIN.password).join('***') : text);

const tmp = mkdtempSync(join(tmpdir(), 'articode-accept-mod17-'));
const envFile = join(tmp, 'demo.env');

function run(cmd, argv, { env } = {}) {
  const res = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env });
  return { code: res.status ?? 1, out: (res.stdout ?? '') + (res.stderr ?? '') + (res.error ? String(res.error) : '') };
}
const compose = (argv, opts) => run('docker', ['compose', '-p', PROJECT, '-f', 'deploy/compose.academy.yaml', '--env-file', envFile, ...argv], opts);

function containerOf(service) {
  return compose(['ps', '-a', '-q', service]).out.trim().split('\n')[0] ?? '';
}
function stateOf(service) {
  const id = containerOf(service);
  if (!id) return { status: 'absent', health: '', exit: null };
  const [status, health, exit] = run('docker', ['inspect', '--format', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.ExitCode}}', id]).out.trim().split('|');
  return { status, health, exit: Number(exit) };
}
async function waitFor(predicate, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(2000);
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
  return { status: res.status, type: res.headers.get('content-type') ?? '', body };
}
function envValue(name) {
  const found = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : '';
}
function psql(sql) {
  const res = compose(['exec', '-T', 'db', 'sh', '-c', 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"', sql]);
  if (res.code !== 0) throw new Error(`psql: ${tail(res.out, 3)}`);
  return res.out.trim();
}

async function journey() {
  const version = run('docker', ['version', '--format', '{{.Server.Version}}']);
  if (version.code !== 0) return fail('1. Docker is running', 'start Docker Desktop first');
  pass('1. Docker is running', `engine ${version.out.trim()}`);
  // By the compose project label: nothing of the demo academy may exist yet.
  if (run('docker', ['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`]).out.trim()) return fail('1. no earlier demo academy is running', `run: docker compose -p ${PROJECT} -f deploy/compose.academy.yaml down -v   (with that run's env file), or remove the ${PROJECT} containers in Docker Desktop`);

  const gen = run(process.execPath, ['deploy/scripts/new-academy-env.mjs', 'demo', '--local', '--port', String(PORT), '--name-ar', 'الأكاديمية التجريبية', '--name-en', 'Demo Academy', '--timezone', 'Europe/Istanbul', '--currency', 'USD', '--tag', 'demo', '--out', envFile]);
  const secretNames = ['POSTGRES_PASSWORD', 'DB_MIGRATOR_PASSWORD', 'DB_APP_PASSWORD', 'JWT_SECRET'];
  if (gen.code === 0 && secretNames.every((n) => envValue(n).length >= 32 && !gen.out.includes(envValue(n)))) pass('2. env file generated with random secrets, none printed', secretNames.join(', '));
  else return fail('2. env file generated with random secrets, none printed', tail(gen.out, 5));

  console.log(input.noBuild ? 'Starting the demo academy from the existing images...' : 'Building the four images and starting the demo academy (several minutes the first time)...');
  const started = Date.now();
  const up = compose(['up', '-d', input.noBuild ? '--no-build' : '--build']);
  if (up.code !== 0) {
    console.log(tail(up.out, 30));
    return fail('3. docker compose up', `exit ${up.code}`);
  }
  const migrate = stateOf('migrate');
  if (migrate.status === 'exited' && migrate.exit === 0) pass('3. migrate applied the migrations and the seed, then exited 0', `${Math.round((Date.now() - started) / 1000)} s`);
  else return fail('3. migrate applied the migrations and the seed, then exited 0', JSON.stringify(migrate));
  if (await waitFor(() => stateOf('api').health === 'healthy', 180)) pass('4. api is healthy (readiness)');
  else {
    console.log(tail(compose(['logs', '--tail', '30', 'api']).out));
    return fail('4. api is healthy (readiness)', JSON.stringify(stateOf('api')));
  }

  await waitFor(async () => (await http('/api/health').catch(() => ({ status: 0 }))).body?.status === 'ok', 60);
  const ready = await http('/api/health/ready');
  const schema = ready.body?.checks?.schema;
  if (ready.status === 200 && schema?.status === 'current') {
    pass('5. readiness through the academy origin: 200, schema current');
    evidence(`schema ${schema.applied}`);
  } else fail('5. readiness through the academy origin: 200, schema current', `${ready.status} ${JSON.stringify(ready.body)}`);
  const page = await http('/login');
  if (page.status === 200 && page.type.includes('text/html')) pass('6. the web app is served on the same origin', `${ORIGIN}/login`);
  else fail('6. the web app is served on the same origin', `${page.status} ${page.type}`);

  const boot = compose(['run', '--rm', '-T', '-e', 'BOOTSTRAP_ADMIN_EMAIL', '-e', 'BOOTSTRAP_ADMIN_FULL_NAME', '-e', 'BOOTSTRAP_ADMIN_PASSWORD', 'migrate', 'npm', 'run', '--silent', 'auth:bootstrap-admin'], { env: { BOOTSTRAP_ADMIN_EMAIL: ADMIN.email, BOOTSTRAP_ADMIN_FULL_NAME: 'Demo Admin', BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password } });
  if (boot.code === 0 && /First academy admin created/.test(boot.out)) pass('7. first admin created with the documented command (compose run migrate npm run auth:bootstrap-admin)');
  else return fail('7. first admin created with the documented command', mask(tail(boot.out, 6)));

  const login = await http('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ identifier: ADMIN.email, password: ADMIN.password }) });
  const token = login.body?.accessToken;
  const academy = token ? await http('/api/academy', { headers: { authorization: `Bearer ${token}` } }) : { status: 0 };
  if (login.status === 200 && academy.status === 200) {
    pass('8. the admin signs in through the academy origin and reads the academy', `${academy.body?.name?.ar ?? ''} / ${academy.body?.slug ?? ''}`);
    evidence(`admin ${ADMIN.email}`);
  } else fail('8. the admin signs in through the academy origin and reads the academy', `login ${login.status} ${login.body?.code ?? ''}, academy ${academy.status}`);

  const backup = compose(['exec', '-T', 'backup', 'backup.sh']);
  const listing = compose(['exec', '-T', 'backup', 'sh', '-c', 'ls -1 /backups']).out.split('\n').map((l) => l.trim());
  const dumps = listing.filter((f) => f.endsWith('.dump')).sort();
  const newest = dumps.at(-1);
  if (backup.code === 0 && newest && listing.includes(`${newest}.sha256`)) {
    pass('9. a backup was taken (pg_dump -Fc + sha256)');
    evidence(`backup ${newest}`);
  } else fail('9. a backup was taken (pg_dump -Fc + sha256)', tail(backup.out, 8));

  const drill = compose(['exec', '-T', 'backup', 'restore-drill.sh']);
  const report = compose(['exec', '-T', 'backup', 'cat', '/backups/drill-last.json']).out.trim();
  let drillResult = '';
  try {
    drillResult = JSON.parse(report).result;
  } catch {
    // not JSON
  }
  if (drill.code === 0 && drillResult === 'pass') {
    pass('10. the restore drill restored the newest backup into a throwaway cluster and checked it');
    evidence(`drill ${report.slice(0, 240)}`);
  } else fail('10. the restore drill restored the newest backup into a throwaway cluster and checked it', tail(drill.out, 8));

  const maintenance = compose(['logs', '--no-log-prefix', 'maintenance']).out;
  const first = maintenance.split('\n').find((l) => l.includes('"maintenance.pruned"'));
  if (first) pass('11. the daily maintenance ran once at start', first.trim());
  else fail('11. the daily maintenance ran once at start', tail(maintenance, 4));

  const ports = run('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}', containerOf('db')]).out.trim();
  const createdb = psql(`select rolcreatedb from pg_roles where rolname = '${envValue('DB_MIGRATOR_USER')}'`);
  if (!/"HostPort"/.test(ports) && createdb === 'f') pass('12. the database publishes no host port and the migrator has no CREATEDB');
  else fail('12. the database publishes no host port and the migrator has no CREATEDB', `ports ${ports}, createdb ${createdb}`);
}

try {
  await journey();
} catch (error) {
  fail('unexpected error', mask(error.message));
} finally {
  if (input.keep) {
    console.log(`KEPT: the demo academy still runs on ${ORIGIN}. Remove it later with:`);
    console.log(`  docker compose -p ${PROJECT} -f deploy/compose.academy.yaml --env-file "${envFile}" down -v`);
    console.log(`  then delete the folder ${tmp} (it holds the demo secrets).`);
  } else if (!existsSync(envFile)) {
    rmSync(tmp, { recursive: true, force: true });
  } else {
    const down = compose(['down', '-v', '--remove-orphans']);
    if (down.code === 0) pass('13. the demo academy was taken down with its volumes');
    else fail('13. the demo academy was taken down with its volumes', tail(down.out, 4));
    rmSync(tmp, { recursive: true, force: true });
  }
}
const failed = results.filter((r) => r === 'FAIL').length;
console.log(`RESULT ${results.filter((r) => r === 'PASS').length} PASS / ${failed} FAIL / ${results.filter((r) => r === 'SKIP').length} SKIP`);
process.exit(failed ? 1 : 0);
