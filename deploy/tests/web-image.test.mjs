#!/usr/bin/env node
// TEST-201 — the `web` image (MOD-17-T02, roadmap §4l.5, D-R89, ADR-072).
//
// Run from the repository root with Docker running (Node >= 22, no npm install):
//
//   node deploy/tests/web-image.test.mjs                 build the image, then check it
//   node deploy/tests/web-image.test.mjs --no-build      check an image that is already built
//   node deploy/tests/web-image.test.mjs --no-cache      build without the Docker layer cache
//   node deploy/tests/web-image.test.mjs --tag t02       tags articode-web:t02 (default: test)
//   node deploy/tests/web-image.test.mjs --api-image articode-api:t01
//                                                        the API image of the real-backend phase
//                                                        (default articode-api:t01; SKIP when absent)
//
// What it proves (the acceptance criteria of MOD-17-T02):
//   AC1  the UI and the API share one origin: the page, its root-relative assets and
//        /api/* are all answered by http://localhost:<port>, and the bundle names no
//        other API base;
//   AC2  a deep path (/classes, /users/<id>, /invite/<token>) is index.html (200,
//        text/html, no-cache) while a missing /assets/ file is a plain 404;
//   AC3  /api/* reaches the upstream unchanged (path, query, Host) with
//        X-Forwarded-For / -Proto / -Host set by Caddy, and the X-Forwarded-* a client
//        sends are not trusted (a stub upstream echoes what it receives); with the real
//        API image behind it (NODE_ENV=production, TRUST_PROXY=1) /api/health is 200,
//        OriginGuard accepts the academy's own origin and refuses a foreign one — and a
//        spoofed X-Forwarded-Proto cannot turn http://localhost into an https origin;
//   AC4  `caddy adapt` gives automatic HTTPS (port 443, host matcher, redirects on)
//        for SITE_ADDRESS=https://academy.example.com and plain HTTP on port 80 for the
//        default http://localhost; the https image, run on an --internal Docker network
//        (no certificate request can leave it), redirects port 80 to https and speaks
//        TLS on 443, while the local one creates no certificate and no local CA;
//   AC5  frontend/ is built as committed — no change, no untracked file under it,
//        nothing written into it by the build;
//   plus the TEST-200 checks that apply: no .env file and no secret value of the local
//   env files in any layer, the non-root user (no capability, no-new-privileges),
//   cache and security headers, compression, the 2 MB /api body limit, the JSON access
//   log on stdout without the one-time tokens of invitation/reset links, the
//   HEALTHCHECK, and the image size.
//
// Prints PASS / FAIL / SKIP lines and, for the secret scan, counts only — never a
// value. The JWT secret and the tokens it needs are random, generated here and thrown
// away. Ports are published on 127.0.0.1 only. Exit code 1 when anything fails.

import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const WEB = `articode-web:${option('--tag', 'test')}`;
const API_IMAGE = option('--api-image', 'articode-api:t01');
// The Node of .nvmrc — the build stage's base, used here for the stub upstream and the probes.
const NODE_IMAGE = 'node:22.20.0-bookworm-slim';
const RUN_ID = randomBytes(4).toString('hex');
const HTTPS_HOST = 'academy.example.com';
const HSTS = 'max-age=31536000; includeSubDomains';

const results = [];
const report = (status, name, detail = '') => {
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
};
const pass = (name, detail) => report('PASS', name, detail);
const fail = (name, detail) => report('FAIL', name, detail);
const skip = (name, detail) => report('SKIP', name, detail);
const check = (ok, name, good, bad) => (ok ? pass(name, good) : fail(name, bad));

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

const git = (argv) => spawnSync('git', argv, { cwd: ROOT, encoding: 'utf8' });
const tail = (text, lines = 25) => text.trim().split('\n').slice(-lines).join('\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => randomBytes(32).toString('base64url'); // the shape of an invitation/reset token: 43 characters

/**
 * One HTTP request to the published port with full control of the headers (Host
 * included); the body is never decompressed, so Content-Encoding can be checked.
 */
function send(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        fn(value);
      }
    };
    const req = http.request({ host: '127.0.0.1', port, method, path, agent: false, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => settle(resolvePromise, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', (e) => settle(reject, e));
    });
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => settle(reject, e));
    req.end(body);
  });
}

const json = (res) => {
  try {
    return JSON.parse(res.body.toString('utf8'));
  } catch {
    return null;
  }
};

async function waitForAnswer(port, path, seconds, headers) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      return await send(port, { path, headers });
    } catch {
      await sleep(500);
    }
  }
  return null;
}

function hostPort(container, containerPort) {
  const out = docker(['port', container, `${containerPort}/tcp`], { allowFail: false }).stdout;
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

function ensureImage(image) {
  if (docker(['image', 'inspect', image]).code === 0) return true;
  return docker(['pull', image]).code === 0;
}

// --- AC5 ---------------------------------------------------------------------
// The paths of frontend/ that the root .dockerignore lets in (deploy/Caddyfile, the
// other path of the web block, is this task's own file).
const CONTEXT_PATHS = ['frontend/package.json', 'frontend/package-lock.json', 'frontend/index.html', 'frontend/vite.config.ts', 'frontend/tsconfig.json', 'frontend/tsconfig.app.json', 'frontend/tsconfig.node.json', 'frontend/public', 'frontend/src'];

function frontendStatus() {
  const res = git(['status', '--porcelain', '--ignored', '--untracked-files=all', '--', 'frontend/']);
  return res.status === 0 ? res.stdout : null;
}

function checkFrontendUnchanged() {
  const work = git(['diff', '--quiet', 'HEAD', '--', 'frontend/']);
  if (work.status === null || work.error) {
    skip('AC5 frontend/ is the committed tree', 'git is not available here');
    return;
  }
  const untracked = git(['status', '--porcelain', '--untracked-files=all', '--', 'frontend/'])
    .stdout.split('\n')
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(3).trim());
  const changed = work.status !== 0 ? git(['diff', '--name-only', 'HEAD', '--', 'frontend/']).stdout.trim().split('\n').filter(Boolean) : [];
  check(
    changed.length === 0 && untracked.length === 0,
    'AC5 frontend/ is the committed tree',
    '`git diff --quiet HEAD -- frontend/` clean, no untracked file under frontend/ (node_modules and dist are git-ignored)',
    [changed.length && `modified: ${changed.slice(0, 6).join(', ')}`, untracked.length && `untracked: ${untracked.slice(0, 6).join(', ')}`].filter(Boolean).join('; '),
  );

  const strays = git(['status', '--porcelain', '--ignored', '--untracked-files=all', '--', ...CONTEXT_PATHS])
    .stdout.split('\n')
    .filter((l) => l.startsWith('??') || l.startsWith('!!'))
    .map((l) => l.slice(3).trim())
    .filter((p) => !/(^|\/)(node_modules|dist)(\/|$)/.test(p) && !/(^|\/)\.env(\.|$)/.test(p) && !p.endsWith('.tsbuildinfo'));
  check(strays.length === 0, 'AC5 the frontend part of the build context is the committed tree', 'no untracked or ignored file under the frontend/ paths .dockerignore lets in', `would enter the context: ${strays.slice(0, 8).join(', ')}`);

  const base = git(['merge-base', 'HEAD', 'origin/main']);
  if (base.status !== 0) skip('AC5 this branch leaves frontend/ as on main', 'no origin/main here');
  else {
    const files = git(['diff', '--name-only', base.stdout.trim(), 'HEAD', '--', 'frontend/']).stdout.trim().split('\n').filter(Boolean);
    if (files.length === 0) pass('AC5 this branch leaves frontend/ as on main', `no commit since ${base.stdout.trim().slice(0, 7)} touches frontend/`);
    else skip('AC5 this branch leaves frontend/ as on main', `the branch itself changes ${files.length} file(s) under frontend/ — not the image's doing`);
  }
}

// --- build -------------------------------------------------------------------
function build() {
  const before = frontendStatus();
  const started = Date.now();
  const res = docker(['build', '-f', 'deploy/web.Dockerfile', '--target', 'runtime', '-t', WEB, '--progress=plain', ...(flag('--no-cache') ? ['--no-cache'] : []), '.']);
  const secs = Math.round((Date.now() - started) / 1000);
  if (res.code === 0) pass('build --target runtime', `${WEB} in ${secs} s`);
  else {
    fail('build --target runtime', `exit ${res.code}`);
    console.log(tail(res.stderr + res.stdout, 40));
  }
  const after = frontendStatus();
  if (before !== null && after !== null) check(before === after, 'AC5 the build writes nothing into frontend/', 'git status of frontend/ (ignored files included) identical before and after', 'git status of frontend/ changed during the build');
}

// --- image facts -------------------------------------------------------------
function checkImage() {
  const user = docker(['image', 'inspect', '--format', '{{.Config.User}}', WEB]).stdout.trim();
  const uid = docker(['run', '--rm', '--entrypoint', 'id', WEB, '-u']).stdout.trim();
  check(user === 'web' && uid !== '' && uid !== '0', 'the image runs as a non-root user', `USER ${user}, uid ${uid}`, `USER "${user}", uid "${uid}"`);

  const envFiles = docker(['run', '--rm', '--user', '0', '--entrypoint', 'sh', WEB, '-c', "find / -xdev \\( -name .env -o -name '.env.*' \\) -print"]);
  check(envFiles.code === 0 && envFiles.stdout.trim() === '', 'the image holds no .env file', '', envFiles.stdout.trim() || `exit ${envFiles.code}`);

  const layout = docker(['run', '--rm', '--user', '0', '--entrypoint', 'sh', WEB, '-c', [
    'ls -A /srv | tr "\\n" " "; echo',
    'find /srv -type f ! -path "/srv/assets/*" | sort | tr "\\n" " "; echo',
    'find / -xdev \\( -name "*.map" -o -name "*.tsx" -o -name node_modules -o -name package.json \\) -print | head -5 | tr "\\n" " "; echo',
    'stat -c "%U" /data /config | tr "\\n" " "; echo',
    'find /data /config -mindepth 2 | head -5 | tr "\\n" " "; echo',
  ].join('; ')]);
  const [srv = '', files = '', sources = '', owners = '', state = ''] = layout.stdout.split('\n').map((l) => l.trim());
  check(
    srv === 'assets favicon.svg index.html' && files === '/srv/favicon.svg /srv/index.html' && sources === '',
    'the image holds the Vite dist only',
    '/srv = assets, favicon.svg, index.html; no source, source map, node_modules or package.json anywhere',
    `/srv: ${srv}; files: ${files}; found: ${sources}`,
  );
  check(owners === 'web web' && state === '', '/data and /config belong to the process user and start empty', 'owner web, nothing written at build time', `owners: ${owners}; content: ${state}`);

  const size = Number(docker(['image', 'inspect', '--format', '{{.Size}}', WEB]).stdout.trim());
  const listed = docker(['images', '--format', '{{.Size}}', WEB]).stdout.trim().split('\n')[0];
  if (size > 0) pass('image size', `${(size / 1e6).toFixed(1)} MB${listed ? ` (docker images: ${listed})` : ''}`);
  else skip('image size', 'not reported by this Docker');
}

// --- secret scan (TEST-200's approach) -----------------------------------------
function secretValues() {
  const files = ['.env', 'backend/.env', 'backend/.env.local', 'frontend/.env', 'frontend/.env.local'].map((f) => join(ROOT, f)).filter(existsSync);
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

// A sentence of deploy/Caddyfile, which the image carries verbatim: finding it proves
// the scanner really read the layers, so a scan that reads nothing cannot pass.
const CONTROL = Buffer.from('The API runs with TRUST_PROXY=1', 'utf8');

async function checkNoSecretValues(values) {
  const needles = [...values, CONTROL];
  const control = needles.length - 1;
  const dir = mkdtempSync(join(tmpdir(), 'articode-t201-'));
  const file = join(dir, 'image.tar');
  try {
    const saved = docker(['save', '-o', file, WEB]);
    if (saved.code !== 0) {
      fail('the image carries no secret value', `docker save: ${tail(saved.stderr, 2)}`);
      return;
    }
    const found = new Set();
    let blobs = 0;
    for (const { start, size } of tarEntries(file)) {
      const kind = magic(file, start);
      if (kind === 'zstd' && typeof zlib.createZstdDecompress !== 'function') {
        fail('the image carries no secret value', 'a zstd layer and no zstd in this Node');
        return;
      }
      const raw = createReadStream(file, { start, end: start + size - 1, highWaterMark: 1 << 20 });
      const stream = kind === 'gzip' ? raw.pipe(zlib.createGunzip()) : kind === 'zstd' ? raw.pipe(zlib.createZstdDecompress()) : raw;
      await scan(stream, needles, found);
      blobs += 1;
    }
    const leaked = [...found].filter((i) => i !== control).length;
    if (!found.has(control)) fail('the image carries no secret value', `the control string was not found in ${blobs} blobs — the scan read nothing`);
    else if (leaked === 0) pass('the image carries no secret value', `${values.length} values × ${blobs} blobs (layers, config, manifests): 0 found; control found`);
    else fail('the image carries no secret value', `${leaked} of ${values.length} values found — inspect the build context`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- AC4 (configuration) -------------------------------------------------------
function adapt(siteAddress) {
  const res = docker(['run', '--rm', ...(siteAddress ? ['-e', `SITE_ADDRESS=${siteAddress}`] : []), WEB, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`caddy adapt: exit ${res.code} ${tail(res.stderr, 3)}`);
  }
}

const serversOf = (config) => Object.values(config?.apps?.http?.servers ?? {});
const hostsOf = (server) => (server.routes ?? []).flatMap((r) => (r.match ?? []).flatMap((m) => m.host ?? []));
const findDeep = (node, predicate) => {
  if (node === null || typeof node !== 'object') return false;
  if (predicate(node)) return true;
  return Object.values(node).some((child) => findDeep(child, predicate));
};

function checkAdapt() {
  const fmt = docker(['run', '--rm', '--entrypoint', 'caddy', WEB, 'fmt', '/etc/caddy/Caddyfile']);
  check(fmt.code === 0, 'the Caddyfile is in `caddy fmt` form', 'no "input is not formatted" warning at start', tail(fmt.stderr, 2));
  try {
    const tls = adapt(`https://${HTTPS_HOST}`);
    const site = serversOf(tls).find((s) => hostsOf(s).includes(HTTPS_HOST));
    check(
      site && JSON.stringify(site.listen) === '[":443"]' && !site.automatic_https?.disable && !site.automatic_https?.disable_redirects,
      `AC4 caddy adapt: SITE_ADDRESS=https://${HTTPS_HOST} gets automatic HTTPS`,
      `listens on :443 with host matcher ${HTTPS_HOST}, automatic HTTPS and its redirects left on`,
      JSON.stringify(site ? { listen: site.listen, automatic_https: site.automatic_https } : serversOf(tls).map((s) => s.listen)),
    );
    const hsts = findDeep(site, (n) => Array.isArray(n.routes) && n.routes.some((r) => (r.match ?? []).some((m) => m.protocol === 'https') && findDeep(r, (h) => h.handler === 'headers' && h.response?.set?.['Strict-Transport-Security']?.[0] === HSTS)));
    check(hsts, 'HSTS on the UI only for https requests', `"${HSTS}" behind a \`protocol https\` matcher (helmet's value)`, 'no HSTS route behind a protocol https matcher');

    const plain = adapt(null);
    const local = serversOf(plain).find((s) => hostsOf(s).includes('localhost'));
    const any443 = serversOf(plain).some((s) => (s.listen ?? []).some((l) => l.endsWith(':443')));
    check(
      local && JSON.stringify(local.listen) === '[":80"]' && !any443 && !plain.apps.tls && !plain.apps.pki,
      'AC4 caddy adapt: the default SITE_ADDRESS (http://localhost) is plain HTTP',
      'listens on :80 only, no tls or pki app — no certificate, no local CA',
      JSON.stringify({ listen: local?.listen, apps: Object.keys(plain.apps ?? {}) }),
    );
  } catch (error) {
    fail('AC4 caddy adapt', error.message);
  }
}

// --- AC1..AC3 with a stub upstream ---------------------------------------------
// Echoes what reaches the upstream; sets the response headers an API would, so the
// test sees whether Caddy leaves them alone. `x-stub-drop` closes the connection
// without an answer (Caddy's 502); `x-stub-cut` breaks a response half-way.
const STUB = [
  "const http=require('http');",
  "http.createServer((q,s)=>{q.on('error',()=>{});",
  "if(q.headers['x-stub-drop']){q.socket.destroy();return}",
  "if(q.headers['x-stub-cut']){s.writeHead(200,{'content-type':'application/json','content-length':'4096'});s.write('{\"partial\":');setTimeout(()=>q.socket.destroy(),100);return}",
  "let n=0;q.on('data',c=>{n+=c.length});",
  "q.on('end',()=>{s.writeHead(200,{'content-type':'application/json','x-frame-options':'SAMEORIGIN','cache-control':'no-store','x-stub':'yes'});",
  's.end(JSON.stringify({method:q.method,url:q.url,headers:q.headers,bodyLength:n}))})})',
  ".on('clientError',(e,sock)=>sock.destroy()).listen(3000,()=>console.log('stub listening'))",
].join('');

async function checkWithStub() {
  const network = `articode-t201-${RUN_ID}`;
  const stub = `articode-t201-stub-${RUN_ID}`;
  const web = `articode-t201-web-${RUN_ID}`;
  const before = results.length;
  try {
    docker(['network', 'create', network], { allowFail: false });
    docker(['run', '-d', '--name', stub, '--network', network, '--network-alias', 'api', NODE_IMAGE, 'node', '-e', STUB], { allowFail: false });
    // Hardened as the compose service may run it: no capability at all, no privilege gain.
    docker(['run', '-d', '--name', web, '--network', network, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '-p', '127.0.0.1::80', WEB], { allowFail: false });
    const port = hostPort(web, 80);
    const origin = `http://localhost:${port}`;
    const first = await waitForAnswer(port, '/', 30);
    if (!first) throw new Error('Caddy did not answer within 30 s');

    // The process: non-root, no capability, port 80 through Docker's unprivileged-port sysctl.
    const proc = docker(['exec', web, 'sh', '-c', 'id -u; grep CapEff /proc/1/status | tr -s "\\t " " "; cat /proc/sys/net/ipv4/ip_unprivileged_port_start']).stdout.trim().split('\n');
    check(
      proc[0] !== '0' && /CapEff: 0+$/.test(proc[1] ?? '') && proc[2] === '0',
      'Caddy serves port 80 as a non-root user without any capability',
      `uid ${proc[0]}, ${proc[1]}, ip_unprivileged_port_start ${proc[2]} (--cap-drop ALL, no-new-privileges)`,
      proc.join(' | '),
    );

    // AC2 + headers of the UI.
    const root = await send(port, { path: '/' });
    const indexHtml = root.body.toString('utf8');
    const securityOk = (res) => res.headers['x-content-type-options'] === 'nosniff' && res.headers['referrer-policy'] === 'strict-origin-when-cross-origin' && res.headers['x-frame-options'] === 'DENY' && !('server' in res.headers);
    check(
      root.status === 200 && /^text\/html/.test(root.headers['content-type'] ?? '') && indexHtml.includes('<div id="root"></div>') && root.headers['cache-control'] === 'no-cache' && securityOk(root) && !('strict-transport-security' in root.headers),
      'GET / is index.html, revalidated, with the security headers',
      'text/html, Cache-Control no-cache, nosniff, strict-origin-when-cross-origin, X-Frame-Options DENY, no Server, no HSTS over http',
      `${root.status} ${JSON.stringify(root.headers)}`,
    );
    const index = await send(port, { path: '/index.html' });
    check(
      index.status === 200 && index.body.equals(root.body) && index.headers['cache-control'] === 'no-cache' && securityOk(index),
      'GET /index.html is the same document with the same headers',
      'no-cache',
      `${index.status} ${index.headers['location'] ?? ''} ${JSON.stringify(index.headers)}`,
    );

    const deep = [];
    let deepOk = true;
    for (const path of ['/classes', '/users/abc', `/invite/${token()}`, '/settings/roles?tab=1']) {
      const res = await send(port, { path });
      deep.push(`${path.replace(/\/invite\/.*/, '/invite/<token>')} ${res.status}`);
      if (!(res.status === 200 && /^text\/html/.test(res.headers['content-type'] ?? '') && res.body.equals(root.body) && res.headers['cache-control'] === 'no-cache')) {
        deepOk = false;
        fail('AC2 a deep path is served with index.html', `${path} → ${res.status} ${res.headers['content-type']}`);
      }
    }
    if (deepOk) pass('AC2 a deep path is served with index.html', `${deep.join(', ')} — index.html, text/html, no-cache`);

    const missing = await send(port, { path: '/assets/does-not-exist.js' });
    check(
      missing.status === 404 && missing.body.length === 0 && !/text\/html/.test(missing.headers['content-type'] ?? '') && !/immutable/.test(missing.headers['cache-control'] ?? '') && missing.headers['x-content-type-options'] === 'nosniff' && !('server' in missing.headers),
      'AC2 a missing /assets/ file is a plain 404',
      'empty 404, not index.html, not cached as immutable, nosniff, no Server',
      `${missing.status} ${JSON.stringify(missing.headers)}`,
    );

    const assetPath = indexHtml.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    const cssPath = indexHtml.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
    if (!assetPath || !cssPath) throw new Error('index.html names no /assets/ script or stylesheet');
    const asset = await send(port, { path: assetPath });
    check(
      asset.status === 200 && /javascript/.test(asset.headers['content-type'] ?? '') && asset.headers['cache-control'] === 'public, max-age=31536000, immutable' && securityOk(asset),
      'a hashed asset is cached for a year as immutable',
      `${assetPath}: Cache-Control public, max-age=31536000, immutable, with the security headers`,
      `${asset.status} ${JSON.stringify(asset.headers)}`,
    );
    const zstd = await send(port, { path: assetPath, headers: { 'accept-encoding': 'zstd' } });
    const gzip = await send(port, { path: cssPath, headers: { 'accept-encoding': 'gzip' } });
    check(
      zstd.headers['content-encoding'] === 'zstd' && gzip.headers['content-encoding'] === 'gzip' && /accept-encoding/i.test(zstd.headers.vary ?? '') && zstd.body.length < asset.body.length,
      'responses are compressed (zstd, gzip)',
      `script ${asset.body.length} → ${zstd.body.length} bytes with zstd; stylesheet gzip; Vary: Accept-Encoding`,
      `zstd: ${zstd.headers['content-encoding']}, gzip: ${gzip.headers['content-encoding']}`,
    );

    // AC1: one origin — the bundle calls root-relative /api/... paths, and the same
    // http://localhost:<port> answers the page, its assets and the API.
    const bundle = asset.body.toString('utf8');
    const sameOriginApi = await send(port, { path: '/api/health' });
    check(
      /^\/assets\//.test(assetPath) && bundle.includes('`/api/auth/refresh`') && !bundle.includes('localhost:3000') && !bundle.includes('VITE_API_BASE_URL') && sameOriginApi.status === 200 && sameOriginApi.headers['x-stub'] === 'yes',
      'AC1 the UI and the API share one origin',
      `${origin}/ serves the page and its /assets/, the bundle calls root-relative /api/... (no other base), and ${origin}/api/* reaches the upstream`,
      `asset ${assetPath}, api ${sameOriginApi.status}`,
    );

    // AC3: what reaches the upstream.
    const spoof = await send(port, {
      path: '/api/v1/echo?x=1&y=two',
      headers: { 'x-forwarded-for': '203.0.113.66', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example' },
    });
    const seen = json(spoof);
    const xff = seen?.headers?.['x-forwarded-for'] ?? '';
    check(
      spoof.status === 200 && seen?.url === '/api/v1/echo?x=1&y=two' && seen?.headers?.host === `localhost:${port}`,
      'AC3 /api/* reaches the upstream unchanged',
      'path and query kept (no prefix stripped), Host kept',
      `${spoof.status} ${JSON.stringify(seen)}`,
    );
    check(
      /^[0-9a-f.:]+$/i.test(xff) && !xff.includes('203.0.113') && seen?.headers?.['x-forwarded-proto'] === 'http' && seen?.headers?.['x-forwarded-host'] === `localhost:${port}`,
      'AC3 Caddy sets X-Forwarded-* itself and ignores the client\'s',
      `X-Forwarded-For ${xff} (one address — the spoofed one dropped), X-Forwarded-Proto http, X-Forwarded-Host localhost:${port}`,
      JSON.stringify({ xff, proto: seen?.headers?.['x-forwarded-proto'], host: seen?.headers?.['x-forwarded-host'] }),
    );
    check(
      spoof.headers['x-frame-options'] === 'SAMEORIGIN' && spoof.headers['cache-control'] === 'no-store' && !('x-content-type-options' in spoof.headers) && !('referrer-policy' in spoof.headers) && !('server' in spoof.headers),
      'the API\'s own headers pass through untouched',
      'X-Frame-Options and Cache-Control of the upstream kept, none of the UI headers added, no Server',
      JSON.stringify(spoof.headers),
    );

    // The 2 MB request-body limit of /api/* (the API's largest JSON limit is 1 MB).
    const within = await send(port, { method: 'POST', path: '/api/lessons/x/attendance', headers: { 'content-type': 'application/json' }, body: Buffer.alloc(1_500_000, 0x20) });
    let over;
    try {
      over = await send(port, { method: 'POST', path: '/api/lessons/x/attendance', headers: { 'content-type': 'application/json' }, body: Buffer.alloc(3_000_000, 0x20) });
    } catch (error) {
      // The client may still be writing when Caddy answers 413 and closes the
      // connection (EPIPE / ECONNRESET); the access log then says what was answered.
      await sleep(500);
      const answered = docker(['logs', web]).stdout.split('\n').some((l) => l.includes('"uri":"/api/lessons/x/attendance"') && l.includes('"status":413'));
      over = { status: answered ? 413 : `error ${error.code ?? error.message}` };
    }
    check(
      within.status === 200 && json(within)?.bodyLength === 1_500_000 && over.status === 413,
      '/api/* bodies are limited to 2 MB',
      '1.5 MB reaches the upstream whole, 3 MB is 413',
      `1.5 MB: ${within.status} ${json(within)?.bodyLength}; 3 MB: ${over.status}`,
    );

    // A response Caddy writes itself (the upstream gave none): empty, no Server header.
    const tokens = { link: token(), referer: token(), api: token(), cookie: token(), bearer: token(), dropped: token(), cut: token() };
    const dropped = await send(port, { method: 'POST', path: `/api/account/password-reset/${tokens.dropped}/confirm`, headers: { 'x-stub-drop': '1', 'content-type': 'application/json' }, body: '{}' });
    check(
      dropped.status === 502 && dropped.body.length === 0 && !('server' in dropped.headers),
      'a 502 of Caddy (upstream gone) is empty and carries no Server header',
      '502, no body, no Server',
      `${dropped.status} ${JSON.stringify(dropped.headers)}`,
    );
    // A response broken half-way: Caddy reports it in its own (stderr) log.
    await send(port, { path: `/api/account/invitations/${tokens.cut}`, headers: { 'x-stub-cut': '1' } }).catch(() => null);

    // The access log: JSON on stdout, no one-time token, no cookie, no bearer token.
    const userId = randomUUID();
    await send(port, { path: `/invite/${tokens.link}`, headers: { referer: `${origin}/reset-password/${tokens.referer}`, cookie: `aca_refresh=${tokens.cookie}`, authorization: `Bearer ${tokens.bearer}` } });
    await send(port, { path: `/api/account/invitations/${tokens.api}` });
    await send(port, { path: `/api/users/${userId}?limit=5` });
    await sleep(800);
    const logs = docker(['logs', web]);
    const access = logs.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      });
    const entries = access.filter((e) => e && typeof e.request?.uri === 'string');
    const everything = logs.stdout + logs.stderr;
    const leaked = Object.entries(tokens).filter(([, value]) => everything.includes(value)).map(([name]) => name);
    const redactedLink = entries.find((e) => e.request.uri === '/invite/REDACTED' && e.request.headers?.Referer);
    const droppedEntry = entries.find((e) => e.request.uri === '/api/account/password-reset/REDACTED/confirm');
    const stderrQuotesCut = logs.stderr.includes('/api/account/invitations/REDACTED');
    check(
      access.length > 0 && access.every(Boolean) && entries.length >= 10 && entries.every((e) => /^http\.log\.access/.test(e.logger ?? '')),
      'the access log is JSON on stdout',
      `${entries.length} access entries, one JSON object per line, logger http.log.access…`,
      `${access.length} stdout lines, ${entries.length} access entries`,
    );
    check(
      leaked.length === 0 && redactedLink && entries.some((e) => e.request.uri === '/api/account/invitations/REDACTED') && entries.some((e) => e.request.uri === `/api/users/${userId}?limit=5`) && /\/reset-password\/REDACTED$/.test(redactedLink.request.headers.Referer[0] ?? ''),
      'the logs carry no one-time token, cookie or bearer token',
      `${Object.keys(tokens).length} tokens, 0 in stdout or stderr: /invite/REDACTED, /api/account/invitations/REDACTED, Referer …/reset-password/REDACTED${stderrQuotesCut ? ', the stderr report of the broken response too' : ''}; ids (uuid) and queries kept; Cookie and Authorization redacted by Caddy`,
      `found in the logs: ${leaked.join(', ') || 'none'}; Referer entry: ${JSON.stringify(redactedLink?.request?.headers?.Referer ?? null)}; uuid entry: ${entries.some((e) => e.request.uri === `/api/users/${userId}?limit=5`)}`,
    );
    check(
      droppedEntry?.status === 502 && typeof droppedEntry.error === 'string' && droppedEntry.error.length > 0,
      'the cause of a Caddy error is in its access-log entry',
      `status 502, error "${droppedEntry?.error}"`,
      JSON.stringify(droppedEntry ?? null),
    );

    const health = await waitHealthy(web, 60);
    check(health === 'healthy', 'the image HEALTHCHECK reports healthy', 'wget http://127.0.0.1:2020/ inside the container', health);

    const local = docker(['exec', web, 'sh', '-c', 'ls -A /data/caddy | tr "\\n" " "']).stdout.trim();
    check(
      !/pki|certificates|acme/.test(local) && logs.stderr.includes('server is listening only on the HTTP port, so no automatic HTTPS will be applied to this server') && !logs.stderr.includes('enabling automatic TLS certificate management'),
      'AC4 http://localhost runs without TLS',
      `Caddy: "no automatic HTTPS will be applied"; /data/caddy holds no pki or certificates (${local || 'empty'})`,
      `/data/caddy: ${local}`,
    );
  } catch (error) {
    fail('stub phase', error.message);
  } finally {
    if (results.slice(before).includes('FAIL')) {
      const logs = docker(['logs', '--tail', '15', web]);
      console.log(tail(logs.stderr, 15));
    }
    docker(['rm', '-f', web, stub]);
    docker(['network', 'rm', network]);
  }
}

// --- AC3 with the real API image ------------------------------------------------
async function checkWithApi() {
  if (docker(['image', 'inspect', API_IMAGE]).code !== 0) {
    skip('AC3 with the real API', `${API_IMAGE} is not built here (deploy/tests/api-image.test.mjs --tag t01)`);
    return;
  }
  const network = `articode-t201-api-${RUN_ID}`;
  const web = `articode-t201-web-api-${RUN_ID}`;
  const api = `articode-t201-api-${RUN_ID}`;
  const env = { JWT_SECRET: randomBytes(36).toString('base64url'), DATABASE_URL: 'postgresql://nobody:unused@127.0.0.1:9/none' };
  const before = results.length;
  try {
    docker(['network', 'create', network], { allowFail: false });
    // The upstream under another name, so API_UPSTREAM is exercised too.
    docker(['run', '-d', '--name', web, '--network', network, '-p', '127.0.0.1::80', '-e', 'API_UPSTREAM=backend:3000', WEB], { allowFail: false });
    const port = hostPort(web, 80);
    const origin = `http://localhost:${port}`;
    docker(
      ['run', '-d', '--name', api, '--network', network, '--network-alias', 'backend', '-e', 'NODE_ENV=production', '-e', 'TRUST_PROXY=1', '-e', `CORS_ORIGIN=${origin}`, '-e', 'JWT_SECRET', '-e', 'DATABASE_URL', API_IMAGE],
      { env, allowFail: false },
    );

    const deadline = Date.now() + 60_000;
    let health = null;
    while (Date.now() < deadline) {
      health = await send(port, { path: '/api/health' }).catch(() => null);
      if (health?.status === 200) break;
      await sleep(1000);
    }
    const body = health ? json(health) : null;
    check(
      health?.status === 200 && body?.status === 'ok' && body?.environment === 'production',
      'AC3 GET /api/health through Caddy',
      `200 from ${API_IMAGE} (production) via API_UPSTREAM=backend:3000`,
      health ? `${health.status} ${health.body.toString('utf8').slice(0, 200)}` : 'no answer',
    );
    check(
      health && health.headers['x-frame-options'] === 'SAMEORIGIN' && /default-src 'self'/.test(health.headers['content-security-policy'] ?? '') && health.headers['strict-transport-security'] === HSTS && !('server' in health.headers),
      'the API\'s helmet headers reach the browser unchanged',
      `X-Frame-Options SAMEORIGIN, its CSP, HSTS "${HSTS}" (the value the Caddyfile repeats for the UI over https), no Server`,
      health ? JSON.stringify(health.headers) : 'no answer',
    );
    const ready = await send(port, { path: '/api/health/ready' });
    check(ready.status === 503 && json(ready)?.status === 'not_ready', 'the readiness 503 passes through', '503 not_ready (no database)', `${ready.status}`);

    const login = (headers) =>
      send(port, { method: 'POST', path: '/api/auth/login', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ identifier: `t201-${RUN_ID}@example.com`, password: 'not-a-real-password' }) });
    const own = await login({ origin });
    const ownCode = json(own)?.code;
    check(
      !(own.status === 403 && ownCode === 'origin_forbidden'),
      'AC3 OriginGuard accepts the academy\'s own origin through Caddy',
      `POST /api/auth/login with Origin ${origin}: ${own.status}${ownCode ? ` ${ownCode}` : ''} — past the guard (no database behind it)`,
      `${own.status} ${ownCode}`,
    );
    const foreign = await login({ origin: 'https://evil.example' });
    check(
      foreign.status === 403 && json(foreign)?.code === 'origin_forbidden',
      'AC3 OriginGuard refuses a foreign origin through Caddy',
      'Origin https://evil.example: 403 origin_forbidden',
      `${foreign.status} ${json(foreign)?.code}`,
    );
    // If the API trusted a client's X-Forwarded-Proto, its own origin would become
    // https://localhost:<port> and this request would pass as same-origin.
    const spoofed = await login({ origin: `https://localhost:${port}`, 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.66' });
    check(
      spoofed.status === 403 && json(spoofed)?.code === 'origin_forbidden',
      'AC3 a client cannot spoof the scheme through Caddy',
      `Origin https://localhost:${port} + X-Forwarded-Proto https from the client: 403 origin_forbidden (Caddy sent http)`,
      `${spoofed.status} ${json(spoofed)?.code}`,
    );
  } catch (error) {
    fail('real API phase', error.message);
  } finally {
    if (results.slice(before).includes('FAIL')) {
      console.log(tail(docker(['logs', '--tail', '20', api]).stdout, 20));
      console.log(tail(docker(['logs', '--tail', '10', web]).stderr, 10));
    }
    docker(['rm', '-f', web, api]);
    docker(['network', 'rm', network]);
  }
}

// --- AC4 at run time: https on an internal network ----------------------------------
// From a container on the same --internal network (no route out, so no ACME request
// can leave): port 80 must redirect to https, port 443 must answer a TLS handshake.
const PROBE = [
  "const http=require('http'),tls=require('tls');const out={};",
  `http.get({host:'web',port:80,path:'/classes?tab=1',headers:{host:'${HTTPS_HOST}'}},r=>{out.redirect={status:r.statusCode,location:r.headers.location||null};r.resume();handshake()})`,
  ".on('error',e=>{out.redirect={error:e.code||e.message};handshake()});",
  `function handshake(){const s=tls.connect({host:'web',port:443,servername:'${HTTPS_HOST}',rejectUnauthorized:false});`,
  "s.setTimeout(5000,()=>s.destroy(new Error('timeout')));",
  "s.on('secureConnect',()=>{out.tls={handshake:'completed'};s.destroy();done()});",
  "s.on('error',e=>{out.tls={handshake:'failed',error:e.code||e.message};done()})}",
  'function done(){console.log(JSON.stringify(out))}',
].join('');

async function checkHttpsAtRunTime() {
  const network = `articode-t201-tls-${RUN_ID}`;
  const web = `articode-t201-web-tls-${RUN_ID}`;
  try {
    docker(['network', 'create', '--internal', network], { allowFail: false });
    docker(['run', '-d', '--name', web, '--network', network, '--network-alias', 'web', '-e', `SITE_ADDRESS=https://${HTTPS_HOST}`, WEB], { allowFail: false });
    let out = null;
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      const res = docker(['run', '--rm', '--network', network, NODE_IMAGE, 'node', '-e', PROBE]);
      try {
        out = JSON.parse(res.stdout.trim().split('\n').pop());
      } catch {
        out = null;
      }
      if (out?.redirect?.status && out?.tls && !/ECONNREFUSED|ENOTFOUND|timeout/.test(out.tls.error ?? '')) break;
      await sleep(1000);
    }
    check(
      out?.redirect?.status === 308 && out.redirect.location === `https://${HTTPS_HOST}/classes?tab=1`,
      'AC4 a real domain redirects http to https',
      `http://${HTTPS_HOST}/classes?tab=1 → 308 ${out?.redirect?.location}`,
      JSON.stringify(out?.redirect),
    );
    // Without a certificate (none can be obtained in here) the handshake is refused
    // with a TLS alert — still the proof that :443 speaks TLS for this host.
    check(
      out?.tls && (out.tls.handshake === 'completed' || /SSL|TLS|ECONNRESET/i.test(out.tls.error ?? '')),
      'AC4 port 443 speaks TLS for the domain',
      `TLS handshake ${out?.tls?.handshake}${out?.tls?.error ? ` (${out.tls.error} — no certificate can be obtained on an internal network)` : ''}`,
      JSON.stringify(out?.tls),
    );
    const logs = docker(['logs', web]).stderr;
    const unreachable = logs.split('\n').filter((l) => l.includes('acme-v02.api.letsencrypt.org') && /failed|error/i.test(l)).length;
    check(
      logs.includes('enabling automatic HTTP->HTTPS redirects') && logs.includes('enabling automatic TLS certificate management') && logs.includes(HTTPS_HOST),
      'AC4 Caddy manages the certificate of the domain itself',
      `"enabling automatic TLS certificate management" for ${HTTPS_HOST}, "enabling automatic HTTP->HTTPS redirects"`,
      tail(logs, 8),
    );
    check(
      !/certificate obtained successfully/i.test(logs),
      'AC4 no certificate was requested from the internet',
      `Let's Encrypt unreachable from the internal network (${unreachable} failed ACME attempt${unreachable === 1 ? '' : 's'} logged), no certificate obtained`,
      'a certificate was obtained — the network was not internal',
    );
  } catch (error) {
    fail('https phase', error.message);
  } finally {
    docker(['rm', '-f', web]);
    docker(['network', 'rm', network]);
  }
}

// ---------------------------------------------------------------------------
async function main() {
  if (docker(['version', '--format', '{{.Server.Version}}']).code !== 0) {
    console.error('Docker is not reachable — start Docker Desktop (or the daemon) first.');
    process.exit(2);
  }
  console.log(`TEST-201 — web image (${WEB})`);
  checkFrontendUnchanged();
  if (flag('--no-build')) skip('build', '--no-build: checking an existing image');
  else build();
  if (results.includes('FAIL') && docker(['image', 'inspect', WEB]).code !== 0) return;
  if (!ensureImage(NODE_IMAGE)) {
    fail('helper image', `cannot pull ${NODE_IMAGE}`);
    return;
  }

  checkImage();
  const { files, values } = secretValues();
  if (values.length === 0) skip('secret-value scan', files ? 'the local env files hold no secret value' : 'no local env file (CI): the .env check above stands alone');
  else await checkNoSecretValues(values.map((v) => Buffer.from(v, 'utf8')));

  checkAdapt();
  await checkWithStub();
  await checkWithApi();
  await checkHttpsAtRunTime();
}

await main();
const failed = results.filter((r) => r === 'FAIL').length;
console.log(`RESULT ${results.filter((r) => r === 'PASS').length} PASS / ${failed} FAIL / ${results.filter((r) => r === 'SKIP').length} SKIP`);
process.exit(failed ? 1 : 0);
