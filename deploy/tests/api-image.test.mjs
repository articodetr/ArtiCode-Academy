#!/usr/bin/env node
// TEST-200 — the `api` image (MOD-17-T01, roadmap §4l.5, ADR-072).
//
// Run from the repository root with Docker running (Node >= 22, no npm install):
//
//   node deploy/tests/api-image.test.mjs              build both targets, then check them
//   node deploy/tests/api-image.test.mjs --no-build   check images that are already built
//   node deploy/tests/api-image.test.mjs --no-cache   build without the Docker layer cache
//   node deploy/tests/api-image.test.mjs --no-db      skip the phase with a throwaway PostgreSQL
//   node deploy/tests/api-image.test.mjs --tag t01    tags articode-api:t01 / articode-api-tools:t01
//
// What it proves (the acceptance criteria of MOD-17-T01):
//   AC1  `--target runtime` and `--target tools` build from the committed tree;
//   AC2  `runtime` boots with NODE_ENV=production: /api/health 200, readiness 503
//        without a database (and 200 with one, after `tools` migrated and seeded it
//        twice — the idempotent one-shot `migrate` service of D-R91);
//   AC3  no .env file in either image and no secret value of the local env files in
//        any layer or config blob (`docker save`, every blob decompressed and searched);
//   AC4  `runtime` holds exactly the production packages of backend/package-lock.json
//        (no dev or dev-optional package — the Prisma CLI and TypeScript included);
//   AC5  both images run as the non-root user `node`.
//
// Prints PASS / FAIL / SKIP lines and, for the secret scan, counts only — never a
// value. Every password and JWT secret it needs is random, generated here, handed to
// docker by variable name only and thrown away. Exit code 1 when anything fails.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const tagArg = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : 'test';
const RUNTIME = `articode-api:${tagArg}`;
const TOOLS = `articode-api-tools:${tagArg}`;
const RUN_ID = randomBytes(4).toString('hex');

const results = [];
const report = (status, name, detail = '') => {
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
};
const pass = (name, detail) => report('PASS', name, detail);
const fail = (name, detail) => report('FAIL', name, detail);
const skip = (name, detail) => report('SKIP', name, detail);

/** Runs docker; secrets travel in `env` and are named in args (`-e NAME`), never valued. */
function docker(argv, { env, allowFail = true } = {}) {
  const res = spawnSync('docker', argv, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  const out = { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? String(res.error ?? '') };
  if (!allowFail && out.code !== 0) throw new Error(`docker ${argv[0]} failed: ${out.stderr.trim().split('\n').slice(-5).join(' | ')}`);
  return out;
}

const tail = (text, lines = 25) => text.trim().split('\n').slice(-lines).join('\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON — the status is enough
  }
  return { status: res.status, body };
}

/** Polls `url` until it answers at all (any status) or the deadline passes. */
async function waitForAnswer(url, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      return await getJson(url);
    } catch {
      await sleep(1000);
    }
  }
  return null;
}

function hostPort(container) {
  const out = docker(['port', container, '3000/tcp'], { allowFail: false }).stdout;
  const line = out.split('\n').find((l) => l.startsWith('127.0.0.1:'));
  if (!line) throw new Error(`no loopback port for ${container}: ${out.trim()}`);
  return line.trim().split(':').pop();
}

async function waitHealthy(container, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let state = '';
  while (Date.now() < deadline) {
    state = docker(['inspect', '--format', '{{.State.Health.Status}}', container]).stdout.trim();
    if (state === 'healthy' || state === 'unhealthy') return state;
    await sleep(1000);
  }
  return state || 'unknown';
}

// --- AC1 -------------------------------------------------------------------
// The paths the root .dockerignore lets in; anything untracked or git-ignored under
// them (besides the generated client, which .dockerignore drops) would reach the
// build context, so the image would no longer be built from the committed tree.
const CONTEXT_PATHS = ['backend/package.json', 'backend/package-lock.json', 'backend/nest-cli.json', 'backend/tsconfig.json', 'backend/tsconfig.build.json', 'backend/prisma.config.ts', 'backend/prisma.platform.config.ts', 'backend/prisma', 'backend/src', 'backend/scripts'];

function checkCommittedContext() {
  const res = spawnSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=all', '--', ...CONTEXT_PATHS], { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) {
    skip('AC1 the build context is the committed tree', 'git is not available here');
    return;
  }
  const strays = res.stdout
    .split('\n')
    .filter((l) => l.startsWith('??') || l.startsWith('!!'))
    .map((l) => l.slice(3).trim())
    .filter((p) => !p.startsWith('backend/src/generated/') && !p.startsWith('backend/scripts/acceptance/') && !/(^|\/)\.env(\.|$)/.test(p));
  if (strays.length === 0) pass('AC1 the build context is the committed tree', 'no untracked or ignored file under the paths .dockerignore lets in');
  else fail('AC1 the build context is the committed tree', `would enter the context: ${strays.slice(0, 8).join(', ')}`);
}

function build() {
  for (const [target, tag] of [
    ['runtime', RUNTIME],
    ['tools', TOOLS],
  ]) {
    const started = Date.now();
    const res = docker(['build', '-f', 'deploy/api.Dockerfile', '--target', target, '-t', tag, '--progress=plain', ...(flag('--no-cache') ? ['--no-cache'] : []), '.']);
    const secs = Math.round((Date.now() - started) / 1000);
    if (res.code === 0) pass(`AC1 build --target ${target}`, `${tag} in ${secs} s`);
    else {
      fail(`AC1 build --target ${target}`, `exit ${res.code}`);
      console.log(tail(res.stderr + res.stdout, 40));
    }
  }
}

// --- AC5 -------------------------------------------------------------------
function checkUser(tag) {
  const user = docker(['image', 'inspect', '--format', '{{.Config.User}}', tag]).stdout.trim();
  const uid = docker(['run', '--rm', '--entrypoint', 'id', tag, '-u']).stdout.trim();
  if (user === 'node' && uid !== '' && uid !== '0') pass(`AC5 ${tag} runs as a non-root user`, `USER ${user}, uid ${uid}`);
  else fail(`AC5 ${tag} runs as a non-root user`, `USER "${user}", uid "${uid}"`);
}

// --- AC3 (files) -------------------------------------------------------------
function checkNoEnvFiles(tag) {
  // As root, so no directory is hidden from the search by its permissions.
  const res = docker(['run', '--rm', '--user', '0', '--entrypoint', 'sh', tag, '-c', "find / -xdev \\( -name .env -o -name '.env.*' \\) -print"]);
  const found = res.stdout.trim();
  if (res.code === 0 && found === '') pass(`AC3 ${tag} holds no .env file`);
  else fail(`AC3 ${tag} holds no .env file`, found || `exit ${res.code}`);
}

// --- AC4 + layout --------------------------------------------------------------
function checkRuntimeLayout() {
  const res = docker(['run', '--rm', '--entrypoint', 'sh', RUNTIME, '-c', 'ls -A /app | tr "\\n" " "; echo; ls -A /app/prisma | tr "\\n" " "; echo; ls -A /app/prisma/platform | tr "\\n" " "']);
  const [app = '', prisma = '', platform = ''] = res.stdout.trim().split('\n').map((l) => l.trim());
  // prisma/platform/migrations: the platform readiness check (MOD-18-T06) — the same image runs the platform.
  if (app === 'dist node_modules package.json prisma' && prisma === 'migrations platform' && platform === 'migrations') pass('AC4 runtime holds dist, package.json and the migrations only', 'academy and platform migrations; no sources, no schema, no scripts');
  else fail('AC4 runtime holds dist, package.json and the migrations only', `/app: ${app}; /app/prisma: ${prisma}; /app/prisma/platform: ${platform}`);
}

const WALKER = [
  "const fs=require('fs'),path=require('path');const out=[];",
  "function add(p,rel){if(!fs.existsSync(path.join(p,'package.json')))return;out.push(rel);walk(path.join(p,'node_modules'),rel+'/node_modules')}",
  "function walk(dir,rel){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir)){if(e.startsWith('.'))continue;const p=path.join(dir,e);",
  "if(e.startsWith('@')){for(const s of fs.readdirSync(p))add(path.join(p,s),rel+'/'+e+'/'+s)}else add(p,rel+'/'+e)}}",
  "walk('/app/node_modules','node_modules');console.log(JSON.stringify(out))",
].join('');

function checkProductionPackagesOnly() {
  const lock = JSON.parse(readFileSync(join(ROOT, 'backend', 'package-lock.json'), 'utf8')).packages;
  const entries = Object.entries(lock).filter(([key]) => key !== '');
  const forbidden = new Set(entries.filter(([, v]) => v.dev || v.devOptional).map(([k]) => k));
  const expected = new Set(entries.filter(([, v]) => !v.dev && !v.devOptional && !v.optional).map(([k]) => k));
  const optionalOnly = new Set(entries.filter(([, v]) => v.optional && !v.dev && !v.devOptional).map(([k]) => k));

  const res = docker(['run', '--rm', '--entrypoint', 'node', RUNTIME, '-e', WALKER]);
  let installed;
  try {
    installed = JSON.parse(res.stdout.trim());
  } catch {
    fail('AC4 runtime holds production packages only', `cannot list node_modules: ${tail(res.stderr, 3)}`);
    return;
  }
  const dev = installed.filter((p) => forbidden.has(p));
  const unknown = installed.filter((p) => !forbidden.has(p) && !expected.has(p) && !optionalOnly.has(p));
  const missing = [...expected].filter((p) => !installed.includes(p));
  const short = (list) => list.slice(0, 8).map((p) => p.replace(/^node_modules\//, '')).join(', ') + (list.length > 8 ? ', …' : '');
  if (dev.length === 0 && unknown.length === 0 && missing.length === 0) {
    pass('AC4 runtime holds production packages only', `${installed.length} packages = the ${expected.size} production entries of the lockfile; ${forbidden.size} dev/dev-optional entries absent`);
  } else {
    fail(
      'AC4 runtime holds production packages only',
      [dev.length && `dev: ${short(dev)}`, unknown.length && `not in the lockfile: ${short(unknown)}`, missing.length && `missing: ${short(missing)}`].filter(Boolean).join('; '),
    );
  }
}

// --- AC3 (values) ------------------------------------------------------------
function secretValues() {
  const files = ['.env', 'backend/.env', 'backend/.env.local'].map((f) => join(ROOT, f)).filter(existsSync);
  const values = new Set();
  for (const file of files) {
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const key = line.slice(0, line.indexOf('=')).trim().replace(/^export\s+/, '');
      let value = line.slice(line.indexOf('=') + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (/(PASSWORD|SECRET|API_KEY|TOKEN)/i.test(key)) values.add(value);
      if (/_URL$/i.test(key)) {
        try {
          const password = decodeURIComponent(new URL(value).password);
          if (password) values.add(password);
        } catch {
          // not a URL with credentials
        }
      }
    }
  }
  return { files: files.length, values: [...values].filter((v) => v.length >= 8 && v !== 'change-me') };
}

function tarEntries(file) {
  const fd = openSync(file, 'r');
  const header = Buffer.alloc(512);
  const entries = [];
  let offset = 0;
  try {
    while (readSync(fd, header, 0, 512, offset) === 512 && header.some((b) => b !== 0)) {
      const sizeField = header.subarray(124, 136);
      let size;
      if (sizeField[0] & 0x80) {
        size = 0;
        for (let i = 1; i < 12; i += 1) size = size * 256 + sizeField[i];
      } else size = parseInt(sizeField.toString('latin1').replace(/\0.*$/, '').trim() || '0', 8);
      const type = String.fromCharCode(header[156] || 48);
      if ((type === '0' || type === '7') && size > 0) entries.push({ start: offset + 512, size });
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  } finally {
    closeSync(fd);
  }
  return entries;
}

function magic(file, start) {
  const fd = openSync(file, 'r');
  const buf = Buffer.alloc(4);
  try {
    readSync(fd, buf, 0, 4, start);
  } finally {
    closeSync(fd);
  }
  if (buf[0] === 0x1f && buf[1] === 0x8b) return 'gzip';
  if (buf.readUInt32LE(0) === 0xfd2fb528) return 'zstd';
  return 'raw';
}

async function scan(stream, needles, found) {
  const keep = Math.max(...needles.map((n) => n.length)) - 1;
  let carry = Buffer.alloc(0);
  for await (const chunk of stream) {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    needles.forEach((needle, i) => {
      if (!found.has(i) && buf.indexOf(needle) !== -1) found.add(i);
    });
    carry = buf.subarray(Math.max(0, buf.length - keep));
  }
}

// A string both images carry (src/common/package-info.ts): finding it proves the
// scanner really read the layers, so a scan that reads nothing cannot pass.
const CONTROL = Buffer.from('articode-academy-api', 'utf8');

async function checkNoSecretValues(tag, values) {
  const needles = [...values, CONTROL];
  const control = needles.length - 1;
  const dir = mkdtempSync(join(tmpdir(), 'articode-t200-'));
  const file = join(dir, 'image.tar');
  try {
    const saved = docker(['save', '-o', file, tag]);
    if (saved.code !== 0) {
      fail(`AC3 ${tag} carries no secret value`, `docker save: ${tail(saved.stderr, 2)}`);
      return;
    }
    const found = new Set();
    const entries = tarEntries(file);
    let blobs = 0;
    for (const { start, size } of entries) {
      const kind = magic(file, start);
      const raw = createReadStream(file, { start, end: start + size - 1, highWaterMark: 1 << 20 });
      if (kind === 'zstd' && typeof zlib.createZstdDecompress !== 'function') {
        fail(`AC3 ${tag} carries no secret value`, 'a zstd layer and no zstd in this Node');
        return;
      }
      const stream = kind === 'gzip' ? raw.pipe(zlib.createGunzip()) : kind === 'zstd' ? raw.pipe(zlib.createZstdDecompress()) : raw;
      await scan(stream, needles, found);
      blobs += 1;
    }
    const leaked = [...found].filter((i) => i !== control).length;
    if (!found.has(control)) fail(`AC3 ${tag} carries no secret value`, `the control string was not found in ${blobs} blobs — the scan read nothing`);
    else if (leaked === 0) pass(`AC3 ${tag} carries no secret value`, `${values.length} values × ${blobs} blobs (layers, config, manifests): 0 found; control found`);
    else fail(`AC3 ${tag} carries no secret value`, `${leaked} of ${values.length} values found — inspect the build context`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- AC2 without a database --------------------------------------------------
async function checkBootWithoutDatabase() {
  const name = `articode-t200-api-${RUN_ID}`;
  const env = { JWT_SECRET: randomBytes(36).toString('base64url'), DATABASE_URL: 'postgresql://nobody:unused@127.0.0.1:9/none' };
  const before = results.length;
  try {
    docker(['run', '-d', '--name', name, '-p', '127.0.0.1::3000', '-e', 'JWT_SECRET', '-e', 'DATABASE_URL', RUNTIME], { env, allowFail: false });
    const base = `http://127.0.0.1:${hostPort(name)}/api`;
    const health = await waitForAnswer(`${base}/health`, 60);
    if (health?.status === 200 && health.body?.status === 'ok' && health.body?.environment === 'production') pass('AC2 /api/health answers 200 in production', `version ${health.body.version}`);
    else fail('AC2 /api/health answers 200 in production', JSON.stringify(health));

    const ready = await getJson(`${base}/health/ready`);
    if (ready.status === 503 && ready.body?.status === 'not_ready' && ready.body?.checks?.database?.status === 'down') pass('AC2 readiness answers 503 without a database', 'database down');
    else fail('AC2 readiness answers 503 without a database', `${ready.status} ${JSON.stringify(ready.body)}`);

    const docs = await getJson(`${base}/docs`);
    if (docs.status === 404) pass('runtime keeps Swagger off in production', '/api/docs 404');
    else fail('runtime keeps Swagger off in production', `/api/docs ${docs.status}`);

    const state = await waitHealthy(name, 60);
    if (state === 'healthy') pass('the image HEALTHCHECK (liveness) reports healthy');
    else fail('the image HEALTHCHECK (liveness) reports healthy', state);
  } catch (error) {
    fail('AC2 runtime boots in production', error.message);
  } finally {
    if (results.slice(before).includes('FAIL')) {
      const logs = docker(['logs', '--tail', '30', name]);
      console.log(tail(logs.stdout + logs.stderr));
    }
    docker(['rm', '-f', name]);
  }
}

// --- AC2 with a database: tools migrates + seeds twice, runtime is ready ------------
async function checkWithDatabase() {
  const network = `articode-t200-${RUN_ID}`;
  const db = `articode-t200-db-${RUN_ID}`;
  const api = `articode-t200-api-db-${RUN_ID}`;
  const secrets = {
    POSTGRES_PASSWORD: randomBytes(18).toString('hex'),
    DB_MIGRATOR_PASSWORD: randomBytes(18).toString('hex'),
    DB_APP_PASSWORD: randomBytes(18).toString('hex'),
    JWT_SECRET: randomBytes(36).toString('base64url'),
  };
  const plain = {
    POSTGRES_USER: 'articode',
    POSTGRES_DB: 'articode_academy',
    DB_MIGRATOR_USER: 'articode_migrator',
    DB_APP_USER: 'articode_app',
    DB_HOST: 'db',
    SEED_ACADEMY_SLUG: 't200-academy',
    SEED_ACADEMY_NAME_AR: 'أكاديمية الاختبار',
    SEED_ACADEMY_NAME_EN: 'T200 Academy',
    SEED_ACADEMY_TIMEZONE: 'UTC',
    SEED_ACADEMY_CURRENCY: 'USD',
    SEED_ACADEMY_LOCALE: 'ar',
  };
  const env = { ...plain, ...secrets };
  const pass_e = (names) => names.flatMap((n) => ['-e', n]);
  try {
    docker(['network', 'create', network], { allowFail: false });
    docker(
      ['create', '--name', db, '--network', network, '--network-alias', 'db', ...pass_e(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'DB_MIGRATOR_USER', 'DB_MIGRATOR_PASSWORD', 'DB_APP_USER', 'DB_APP_PASSWORD']), 'postgres:18'],
      { env, allowFail: false },
    );
    docker(['cp', join(ROOT, 'docker', 'postgres', 'initdb', '10-roles.sh'), `${db}:/docker-entrypoint-initdb.d/10-roles.sh`], { allowFail: false });
    docker(['start', db], { allowFail: false });
    const deadline = Date.now() + 90_000;
    let up = false;
    while (!up && Date.now() < deadline) {
      up = docker(['exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'articode', '-d', 'articode_academy']).code === 0;
      if (!up) await sleep(1000);
    }
    if (!up) throw new Error('PostgreSQL did not become ready within 90 s');

    const toolEnv = ['DB_HOST', 'POSTGRES_DB', 'DB_MIGRATOR_USER', 'DB_MIGRATOR_PASSWORD', 'DB_APP_USER', 'DB_APP_PASSWORD', ...Object.keys(plain).filter((k) => k.startsWith('SEED_'))];
    for (const round of [1, 2]) {
      const res = docker(['run', '--rm', '--network', network, ...pass_e(toolEnv), TOOLS], { env });
      const log = res.stdout + res.stderr;
      const applied = round === 1 ? /migrations? have been successfully applied|All migrations have been successfully applied/i.test(log) : /No pending migrations to apply/i.test(log);
      if (res.code === 0 && applied) pass(`tools migrate deploy + seed, run ${round}`, round === 1 ? 'every migration applied, seed done' : 'nothing pending, seed repeated (idempotent)');
      else {
        fail(`tools migrate deploy + seed, run ${round}`, `exit ${res.code}`);
        console.log(tail(log, 30));
      }
    }

    docker(['run', '-d', '--name', api, '--network', network, '-p', '127.0.0.1::3000', ...pass_e(['JWT_SECRET', 'DB_HOST', 'POSTGRES_DB', 'DB_APP_USER', 'DB_APP_PASSWORD']), RUNTIME], { env, allowFail: false });
    const base = `http://127.0.0.1:${hostPort(api)}/api`;
    await waitForAnswer(`${base}/health`, 60);
    const ready = await getJson(`${base}/health/ready`);
    if (ready.status === 200 && ready.body?.checks?.database?.status === 'up') pass('AC2 readiness answers 200 with the migrated database', 'application role, DB_* variables');
    else {
      fail('AC2 readiness answers 200 with the migrated database', `${ready.status} ${JSON.stringify(ready.body)}`);
      console.log(tail(docker(['logs', '--tail', '30', api]).stdout));
    }
    const academy = await getJson(`${base}/academy`);
    if (academy.status === 401) pass('runtime serves a protected route', 'GET /api/academy without a token: 401');
    else fail('runtime serves a protected route', `GET /api/academy: ${academy.status}`);
  } catch (error) {
    fail('database phase', error.message);
  } finally {
    docker(['rm', '-f', api, db]);
    docker(['network', 'rm', network]);
  }
}

// ---------------------------------------------------------------------------
async function main() {
  if (docker(['version', '--format', '{{.Server.Version}}']).code !== 0) {
    console.error('Docker is not reachable — start Docker Desktop (or the daemon) first.');
    process.exit(2);
  }
  console.log(`TEST-200 — api image (${RUNTIME}, ${TOOLS})`);
  checkCommittedContext();
  if (flag('--no-build')) skip('AC1 build', '--no-build: checking existing images');
  else build();
  if (results.includes('FAIL')) return;

  checkUser(RUNTIME);
  checkUser(TOOLS);
  checkNoEnvFiles(RUNTIME);
  checkNoEnvFiles(TOOLS);
  checkRuntimeLayout();
  checkProductionPackagesOnly();

  const { files, values } = secretValues();
  if (values.length === 0) skip('AC3 secret-value scan', files ? 'the local env files hold no secret value' : 'no local env file (CI): the .env checks above stand alone');
  else {
    const buffers = values.map((v) => Buffer.from(v, 'utf8'));
    await checkNoSecretValues(RUNTIME, buffers);
    await checkNoSecretValues(TOOLS, buffers);
  }

  await checkBootWithoutDatabase();
  if (flag('--no-db')) skip('database phase', '--no-db');
  else await checkWithDatabase();
}

await main();
const failed = results.filter((r) => r === 'FAIL').length;
console.log(`RESULT ${results.filter((r) => r === 'PASS').length} PASS / ${failed} FAIL / ${results.filter((r) => r === 'SKIP').length} SKIP`);
process.exit(failed ? 1 : 0);
