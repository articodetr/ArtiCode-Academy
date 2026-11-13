#!/usr/bin/env node
// Writes the platform's env file for deploy/compose.platform.yaml (MOD-18-T06, D-R104).
//
//   node deploy/scripts/new-platform-env.mjs --domain platform.example.com
//
//   Local trial on this machine (plain http, published on 127.0.0.1 only):
//   node deploy/scripts/new-platform-env.mjs --local [--port 8100] [--https-port 8443]
//
// Options: --out <file> (default deploy/env/platform.env), --tag <image tag> (default local),
// --probe-interval <seconds> (default 300).
//
// The database passwords and PLATFORM_JWT_SECRET are random (crypto.randomBytes), written to
// the file only (mode 600 on Linux/macOS — on Windows the mode is not applied: keep the file
// in your user profile) and NEVER printed. An existing file is never overwritten.
// The pattern of deploy/scripts/new-academy-env.mjs. Node >= 22, no npm install.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE = join(ROOT, 'deploy', 'env', 'platform.env.example');

function fail(message) {
  console.error(`new-platform-env: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) fail(`unexpected argument "${arg}"`);
    const name = arg.slice(2);
    if (name === 'local' || name === 'help') options[name] = true;
    else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value`);
      options[name] = value;
      i += 1;
    }
  }
  return options;
}

const USAGE = 'usage: node deploy/scripts/new-platform-env.mjs (--domain <host> | --local [--port <n>] [--https-port <n>]) [--probe-interval <seconds>] [--tag <image tag>] [--out <file>]';

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const KNOWN = new Set(['domain', 'local', 'port', 'https-port', 'probe-interval', 'tag', 'out']);
for (const key of Object.keys(options)) if (!KNOWN.has(key)) fail(`unknown option --${key}\n${USAGE}`);

const portOption = (name, fallback) => {
  const port = options[name] === undefined ? fallback : Number(options[name]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`--${name} is an integer 1–65535`);
  return port;
};

// --- the site -----------------------------------------------------------------
let origin;
let httpPort;
let httpsPort;
let publishAddress;
if (options.local) {
  if (options.domain) fail('--local and --domain exclude each other');
  httpPort = portOption('port', 80);
  // An http origin never serves HTTPS; the port is only published. Off 443 by default, so
  // an academy trial (deploy/scripts/new-academy-env.mjs --local publishes 443) can run next to it.
  httpsPort = portOption('https-port', 8443);
  if (httpsPort === httpPort) fail('--https-port must differ from --port');
  origin = httpPort === 80 ? 'http://localhost' : `http://localhost:${httpPort}`;
  publishAddress = '127.0.0.1';
} else {
  const domain = (options.domain ?? '').trim().toLowerCase();
  if (!domain) fail(`--domain or --local is required\n${USAGE}`);
  if (options.port !== undefined || options['https-port'] !== undefined) fail('--port and --https-port apply to --local only (a real domain uses 80 and 443)');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) fail(`"${domain}" is not a fully qualified domain name (use --local for localhost)`);
  origin = `https://${domain}`;
  httpPort = 80;
  httpsPort = 443;
  publishAddress = '0.0.0.0';
}

const interval = options['probe-interval'] === undefined ? 300 : Number(options['probe-interval']);
if (!Number.isInteger(interval) || interval < 30 || interval > 86_400) fail('--probe-interval is an integer 30–86400 (seconds)');
const tag = options.tag ?? 'local';
if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) fail('--tag is a docker image tag');

// --- write ----------------------------------------------------------------------
const out = resolve(options.out ?? join(ROOT, 'deploy', 'env', 'platform.env'));
if (existsSync(out)) fail(`${relative(process.cwd(), out) || out} exists — the platform env file is never overwritten (rotate a secret by editing it and following the runbook)`);

const secret = (bytes) => randomBytes(bytes).toString('hex');
const values = {
  PLATFORM_ORIGIN: origin,
  HTTP_PORT: String(httpPort),
  HTTPS_PORT: String(httpsPort),
  PUBLISH_ADDRESS: publishAddress,
  PLATFORM_IMAGE_TAG: tag,
  POSTGRES_PASSWORD: secret(24),
  PLATFORM_DB_MIGRATOR_PASSWORD: secret(24),
  PLATFORM_DB_APP_PASSWORD: secret(24),
  PLATFORM_JWT_SECRET: randomBytes(48).toString('base64url'),
  PLATFORM_PROBE_INTERVAL_SECONDS: String(interval),
};
const SECRET_NAMES = ['POSTGRES_PASSWORD', 'PLATFORM_DB_MIGRATOR_PASSWORD', 'PLATFORM_DB_APP_PASSWORD', 'PLATFORM_JWT_SECRET'];

const seen = new Set();
const lines = readFileSync(TEMPLATE, 'utf8')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match || !(match[1] in values)) return line;
    seen.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });
const missing = Object.keys(values).filter((k) => !seen.has(k));
if (missing.length) fail(`the template lacks ${missing.join(', ')} — deploy/env/platform.env.example and this script disagree`);

const header = [
  `# The ArtiCode platform — written by deploy/scripts/new-platform-env.mjs on ${new Date().toISOString()}.`,
  '# SECRETS: keep this file on the server only (mode 600) and an offline copy; never commit it.',
  '',
];
mkdirSync(dirname(out), { recursive: true });
// The template's own leading comment block (up to the first blank line) describes the template.
const body = lines.slice(lines.indexOf('') + 1);
writeFileSync(out, [...header, ...body].join('\n'), { mode: 0o600, flag: 'wx' });

const shown = relative(ROOT, out).replaceAll('\\', '/');
console.log(`wrote ${shown} (mode 600) for ${origin}`);
console.log(`random values (not shown): ${SECRET_NAMES.join(', ')}`);
console.log('next:');
console.log(`  docker compose -p articode-platform -f deploy/compose.platform.yaml --env-file ${shown} up -d --build`);
console.log(`  docker compose -p articode-platform -f deploy/compose.platform.yaml --env-file ${shown} run --rm -e PLATFORM_BOOTSTRAP_EMAIL=<e-mail> -e PLATFORM_BOOTSTRAP_FULL_NAME="<name>" migrate npm run platform:bootstrap-admin   # prompts for the password`);
