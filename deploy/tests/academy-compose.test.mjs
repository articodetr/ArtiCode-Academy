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
// KI-087: the first-admin command runs in a service of its own, `account` — the tools image
// under the `tools` profile (`up` never creates it), hardened, with the `none` log driver (a
// `run` container has no Docker log), the application role only, and a default command that
// only prints its usage; `migrate` carries no AUTH_MFA_ENCRYPTION_KEY and no JWT_SECRET.
// The homepage images (Settings → Homepage Images): the `media` volume is mounted on `api`
// only, at MEDIA_STORAGE_DIR=/var/lib/articode/media (a fixed value, on `api` only), owned by
// `node` and writable by the API's user without any capability; a picture uploaded through
// the web origin is published (API-205, the media route) and a body over the API's 5 MiB
// gets the API's own 413 image_too_large through Caddy; the picture and a file written on
// the volume survive the replacement of the api container (AC3 recreates it).
// Then: backup and maintenance are running, the maintenance loop printed its first line.
// The project, its volumes and its network are removed at the end (never another project's).

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

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
  return { code: res.status ?? 1, out: (res.stdout ?? '') + (res.stderr ?? '') + (res.error ? String(res.error) : ''), stdout: res.stdout ?? '' };
}

/** The variable names of a container's environment (the values hold secrets and are never read out). */
function containerEnvNames(id) {
  try {
    return (JSON.parse(run('docker', ['inspect', '--format', '{{json .Config.Env}}', id]).out.trim()) ?? []).map((e) => e.split('=')[0]);
  } catch {
    return [];
  }
}

/** The containers of this project that `service` has, `run` containers included (even outside the active profiles). */
const containersOfService = (service) => run('docker', ['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--filter', `label=com.docker.compose.service=${service}`]).out.trim();

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

/** A raw GET through the web origin: the status, the headers and the bytes. */
async function bytesOf(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  return { status: res.status, type: res.headers.get('content-type') ?? '', cache: res.headers.get('cache-control') ?? '', bytes: Buffer.from(await res.arrayBuffer()) };
}

const MEDIA_DIR = '/var/lib/articode/media';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A well-formed RGBA PNG of `width` × `height` (a gradient with a transparent edge), no metadata chunk. */
function pngImage(width, height) {
  const chunk = (type, data) => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per sample, RGBA, deflate, adaptive filtering, no interlace
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4); // filter type 0 (None)
    for (let x = 0; x < width; x += 1) row.set([Math.floor((x * 255) / width), Math.floor((y * 255) / height), 160, x < 4 ? 0 : 255], 1 + x * 4);
    rows.push(row);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

/** The volume mounts of a container: [{ name, destination, rw }]. */
function volumeMountsOf(id) {
  try {
    return (JSON.parse(run('docker', ['inspect', '--format', '{{json .Mounts}}', id]).out.trim()) ?? []).filter((m) => m.Type === 'volume').map((m) => ({ name: m.Name ?? '', destination: m.Destination, rw: m.RW }));
  } catch {
    return [];
  }
}

async function main() {
  if (run('docker', ['version', '--format', '{{.Server.Version}}']).code !== 0) {
    console.error('Docker is not reachable — start Docker Desktop (or the daemon) first.');
    process.exit(2);
  }
  console.log(`TEST-202 — academy compose project ${PROJECT} on ${ORIGIN} (images :${TAG})`);

  const gen = run(process.execPath, ['deploy/scripts/new-academy-env.mjs', `t202-${RUN}`, '--local', '--port', String(PORT), '--name-ar', 'أكاديمية الاختبار', '--name-en', 'T202 Academy', '--timezone', 'UTC', '--currency', 'USD', '--tag', TAG, '--out', envFile]);
  const secretNames = ['POSTGRES_PASSWORD', 'DB_MIGRATOR_PASSWORD', 'DB_APP_PASSWORD', 'JWT_SECRET', 'AUTH_MFA_ENCRYPTION_KEY'];
  const secrets = secretNames.map(envValue);
  if (gen.code === 0 && secrets.every((v) => v.length >= 32) && !secrets.some((v) => gen.out.includes(v))) pass('the env generator writes random secrets without printing them', secretNames.join(', '));
  else return fail('the env generator writes random secrets without printing them', tail(gen.out, 5));

  const config = compose(['config', '--quiet']);
  if (config.code === 0) pass('compose config is valid with the generated env file');
  else return fail('compose config is valid with the generated env file', tail(config.out, 10));

  // --- KI-087: the first-admin command runs in `account`, which keeps no Docker log ---------
  // The rendered file holds the env file's secrets: it is parsed here and never printed.
  const rendered = compose(['--profile', 'tools', 'config', '--format', 'json']);
  let services = {};
  let volumes = {};
  try {
    ({ services = {}, volumes = {} } = JSON.parse(rendered.stdout));
  } catch {
    // reported by the checks below
  }
  const account = services.account ?? {};
  if (rendered.code === 0 && account.logging?.driver === 'none' && account.profiles?.includes('tools') && account.build?.target === 'tools' && account.image === services.migrate?.image && account.restart === 'no' && account.cap_drop?.includes('ALL') && account.security_opt?.includes('no-new-privileges:true'))
    pass('account: the tools image under the `tools` profile, hardened, with the `none` log driver (KI-087)', `image ${account.image}, profiles ${account.profiles.join(',')}, logging ${account.logging.driver}`);
  else fail('account: the tools image under the `tools` profile, hardened, with the `none` log driver (KI-087)', `config exit ${rendered.code}; ${JSON.stringify({ logging: account.logging, profiles: account.profiles, target: account.build?.target, image: account.image, restart: account.restart })}`);
  const accountEnv = Object.keys(account.environment ?? {}).sort();
  const appDb = ['DB_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'DB_APP_USER', 'DB_APP_PASSWORD'];
  if (accountEnv.length === appDb.length && appDb.every((n) => accountEnv.includes(n))) pass('account: the application role only (no migrator, superuser, JWT secret or MFA key)', accountEnv.join(', '));
  else fail('account: the application role only (no migrator, superuser, JWT secret or MFA key)', accountEnv.join(', '));
  const migrateEnv = Object.keys(services.migrate?.environment ?? {}).sort();
  if (migrateEnv.includes('DB_MIGRATOR_PASSWORD') && !migrateEnv.some((n) => n === 'AUTH_MFA_ENCRYPTION_KEY' || n === 'JWT_SECRET')) pass('migrate carries no AUTH_MFA_ENCRYPTION_KEY and no JWT_SECRET', migrateEnv.join(', '));
  else fail('migrate carries no AUTH_MFA_ENCRYPTION_KEY and no JWT_SECRET', migrateEnv.join(', '));
  const listed = compose(['config', '--services']);
  const defaultServices = listed.stdout.trim().split(/\r?\n/);
  if (listed.code === 0 && defaultServices.includes('migrate') && !defaultServices.includes('account')) pass('account is outside the default profile', `up starts ${defaultServices.join(', ')}`);
  else fail('account is outside the default profile', `exit ${listed.code}: ${defaultServices.join(', ')}`);

  // --- the homepage images: the `media` volume and MEDIA_STORAGE_DIR on api only -------------
  // Every service, `account` included (rendered with the tools profile); only this one
  // variable's value is read.
  const mediaMounts = Object.entries(services).flatMap(([name, s]) => (s.volumes ?? []).filter((v) => v.type === 'volume' && v.source === 'media').map((v) => `${name}:${v.target}${v.read_only ? ':ro' : ''}`));
  const mediaEnv = Object.entries(services).filter(([, s]) => 'MEDIA_STORAGE_DIR' in (s.environment ?? {})).map(([name, s]) => `${name}=${s.environment.MEDIA_STORAGE_DIR}`);
  if (volumes.media?.name === `${PROJECT}_media` && mediaMounts.join() === `api:${MEDIA_DIR}` && mediaEnv.join() === `api=${MEDIA_DIR}`)
    pass('media: a named volume mounted on api only, at MEDIA_STORAGE_DIR (set on api only)', `volume ${volumes.media.name}; mounts ${mediaMounts.join(', ')}; ${mediaEnv.join(', ')}`);
  else fail('media: a named volume mounted on api only, at MEDIA_STORAGE_DIR (set on api only)', `volume ${JSON.stringify(volumes.media ?? null)}; mounts ${mediaMounts.join(', ') || 'none'}; env ${mediaEnv.join(', ') || 'none'}`);

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
  const createdAccounts = containersOfService('account');
  const migrateNames = containerEnvNames(containerOf('migrate'));
  if (createdAccounts === '' && migrateNames.length > 0 && !migrateNames.includes('AUTH_MFA_ENCRYPTION_KEY')) pass('`up` creates no account container, and the migrate container carries no AUTH_MFA_ENCRYPTION_KEY');
  else fail('`up` creates no account container, and the migrate container carries no AUTH_MFA_ENCRYPTION_KEY', `account containers: ${createdAccounts.split('\n').filter(Boolean).length}; migrate variables: ${migrateNames.length}`);

  // The media directory at run time: the project's own volume on api (read-write) and on no
  // other running service; a new volume starts owned by node (the image's directory), so the
  // API's user writes there with cap_drop ALL.
  const apiMounts = volumeMountsOf(containerOf('api')).filter((m) => m.destination === MEDIA_DIR);
  const elsewhere = ['db', 'web', 'backup', 'maintenance'].filter((s) => volumeMountsOf(containerOf(s)).some((m) => m.name === `${PROJECT}_media` || m.destination === MEDIA_DIR));
  const owner = compose(['exec', '-T', 'api', 'sh', '-c', 'id -un; stat -c "%U:%G %a" "$0"; f="$0/.t202-write-probe"; : > "$f" && rm "$f" && echo writable', MEDIA_DIR]);
  const [whoami, ownership, writable] = owner.out.trim().split('\n');
  if (apiMounts.length === 1 && apiMounts[0].name === `${PROJECT}_media` && apiMounts[0].rw && elsewhere.length === 0 && whoami === 'node' && ownership === 'node:node 755' && writable === 'writable')
    pass('media: the volume is on api only, owned by node and writable by the API\'s user', `${apiMounts[0].name} at ${MEDIA_DIR} (rw); ${ownership}; the api process (${whoami}) creates and deletes a file there`);
  else fail('media: the volume is on api only, owned by node and writable by the API\'s user', `api mounts ${JSON.stringify(apiMounts)}; also on ${elsewhere.join(', ') || 'nothing else'}; exec exit ${owner.code}: ${tail(owner.out, 3)}`);

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
  const boot = compose(['run', '--rm', '-T', '-e', 'BOOTSTRAP_ADMIN_EMAIL', '-e', 'BOOTSTRAP_ADMIN_FULL_NAME', '-e', 'BOOTSTRAP_ADMIN_PASSWORD', 'account', 'npm', 'run', '--silent', 'auth:bootstrap-admin'], { env: { BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_FULL_NAME: 'T202 Admin', BOOTSTRAP_ADMIN_PASSWORD: password } });
  if (boot.code === 0 && /First academy admin created/.test(boot.out) && !boot.out.includes(password) && containersOfService('account') === '') pass('AC1 the first admin is created with the documented command', 'compose run --rm account npm run auth:bootstrap-admin; its output reached the caller, no container left');
  else fail('AC1 the first admin is created with the documented command', tail(boot.out.replaceAll(password, '***'), 8));

  // KI-087 at run time: a `run` container of account (kept here, without --rm, to be inspected).
  const usageName = `${PROJECT}-account-usage`;
  const usage = compose(['run', '-T', '--name', usageName, 'account']);
  const [logType, capDrop, securityOpt, user, usageExit] = run('docker', ['inspect', '--format', '{{.HostConfig.LogConfig.Type}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{.Config.User}}|{{.State.ExitCode}}', usageName]).out.trim().split('|');
  const usageLogs = run('docker', ['logs', usageName]);
  run('docker', ['rm', '-f', usageName]);
  if (usage.code === 0 && /account npm run auth:bootstrap-admin/.test(usage.out) && logType === 'none' && usageExit === '0' && !usageLogs.out.includes('auth:bootstrap-admin') && /"ALL"/.test(capDrop) && /no-new-privileges:true/.test(securityOpt) && user === 'node')
    pass('a `run` container of account keeps no Docker log; its default command only prints the usage', `LogConfig.Type none; docker logs: ${tail(usageLogs.out, 1) || 'nothing'}; user node, cap_drop ALL, no-new-privileges; exit 0`);
  else fail('a `run` container of account keeps no Docker log; its default command only prints the usage', `run exit ${usage.code}, LogConfig.Type ${logType}, exit ${usageExit}, user ${user}, docker logs: ${tail(usageLogs.out, 3)}; output: ${tail(usage.out, 4)}`);

  const login = await http('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ identifier: email, password }) });
  const token = login.body?.accessToken;
  const me = token ? await http('/api/auth/me', { headers: { authorization: `Bearer ${token}` } }) : { status: 0 };
  if (login.status === 200 && me.status === 200 && (me.body?.email ?? me.body?.user?.email) === email) pass('AC1 the first admin signs in through the web origin', 'POST /api/auth/login 200, GET /api/auth/me 200');
  else fail('AC1 the first admin signs in through the web origin', `login ${login.status} ${login.body?.code ?? ''}, me ${me.status}`);

  // --- the homepage images through the web origin ------------------------------------------
  const picture = pngImage(96, 128);
  const upload = token ? await http('/api/academy/homepage-images/heroStudent', { method: 'PUT', headers: { 'content-type': 'image/png', origin: ORIGIN, authorization: `Bearer ${token}` }, body: picture }) : { status: 0, body: null };
  const uploaded = upload.body?.items?.find((item) => item.key === 'heroStudent');
  const mediaUrl = uploaded?.url ?? '';
  const mediaFile = mediaUrl.split('/').pop();
  const publicAcademy = await http('/api/academy/public');
  const served = /^\/api\/academy\/media\/[0-9a-f]{32}\.png$/.test(mediaUrl) ? await bytesOf(mediaUrl) : { status: 0, type: '', cache: '', bytes: Buffer.alloc(0) };
  const onVolume = compose(['exec', '-T', 'api', 'ls', '-A', MEDIA_DIR]).out.trim().split('\n');
  if (upload.status === 200 && uploaded?.custom === true && uploaded.width === 96 && uploaded.height === 128 && publicAcademy.body?.homepageImages?.heroStudent === mediaUrl && served.status === 200 && served.type.startsWith('image/png') && served.bytes.subarray(0, 8).equals(PNG_SIGNATURE) && served.bytes.length === uploaded.bytes && /immutable/.test(served.cache) && onVolume.includes(mediaFile))
    pass('media: a picture uploaded through the web origin is published from the volume', `PUT /api/academy/homepage-images/heroStudent 200 (96 × 128, ${uploaded.bytes} bytes); API-205 names ${mediaUrl}; GET it 200 image/png, ${served.cache}; ${mediaFile} is on the volume`);
  else fail('media: a picture uploaded through the web origin is published from the volume', `PUT ${upload.status} ${upload.body?.code ?? ''}; item ${JSON.stringify(uploaded ?? null)}; API-205 ${JSON.stringify(publicAcademy.body?.homepageImages ?? null)}; GET ${served.status} ${served.type} ${served.bytes.length} bytes; volume: ${onVolume.join(' ') || 'empty'}`);

  // Over the API's 5 MiB, under Caddy's 6 MB: the API's own answer reaches the browser.
  const tooLarge = token
    ? await http('/api/academy/homepage-images/aboutLearners', { method: 'PUT', headers: { 'content-type': 'image/png', origin: ORIGIN, authorization: `Bearer ${token}` }, body: Buffer.concat([PNG_SIGNATURE, Buffer.alloc(5_400_000)]) }).catch((error) => ({ status: `error ${error.cause?.code ?? error.message}`, body: null }))
    : { status: 0, body: null };
  if (tooLarge.status === 413 && tooLarge.body?.code === 'image_too_large') pass('media: a body over 5 MiB passes Caddy and gets the API\'s 413 image_too_large', `maxBytes ${tooLarge.body.maxBytes ?? tooLarge.body.details?.maxBytes ?? '?'}`);
  else fail('media: a body over 5 MiB passes Caddy and gets the API\'s 413 image_too_large', `${tooLarge.status} ${JSON.stringify(tooLarge.body ?? null).slice(0, 200)}`);

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
  // (It removes the api container: the media volume must outlive it — checked after the next up.)
  const apiBefore = containerOf('api');
  const marker = randomBytes(16).toString('hex');
  const wrote = compose(['exec', '-T', 'api', 'sh', '-c', 'printf %s "$1" > "$0/.t202-marker"', MEDIA_DIR, marker]);
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

  const apiAfter = containerOf('api');
  const kept = compose(['exec', '-T', 'api', 'cat', `${MEDIA_DIR}/.t202-marker`]);
  if (wrote.code === 0 && apiAfter && apiAfter !== apiBefore && kept.code === 0 && kept.out.trim() === marker)
    pass('media: the volume survives the replacement of the api container', `a new api container (${apiAfter.slice(0, 12)}, was ${apiBefore.slice(0, 12)}) reads the file the old one wrote`);
  else fail('media: the volume survives the replacement of the api container', `write exit ${wrote.code}; container ${apiBefore.slice(0, 12)} → ${apiAfter.slice(0, 12)}; marker ${kept.code === 0 && kept.out.trim() === marker ? 'kept' : `lost (${tail(kept.out, 2)})`}`);
  let servedAgain = { status: 0, bytes: Buffer.alloc(0) };
  // web was stopped with api: it answers again within seconds of the up.
  if (mediaFile) await waitFor(async () => (servedAgain = await bytesOf(mediaUrl).catch(() => servedAgain)).status === 200, 30, 1000);
  if (servedAgain.status === 200 && served.bytes.length > 0 && servedAgain.bytes.equals(served.bytes)) pass('media: the new api container still serves the uploaded picture', `${mediaUrl}: 200, the same ${servedAgain.bytes.length} bytes`);
  else fail('media: the new api container still serves the uploaded picture', `${mediaUrl || 'no picture was uploaded'}: ${servedAgain.status}, ${servedAgain.bytes.length} bytes`);

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
