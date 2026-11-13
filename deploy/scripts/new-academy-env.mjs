#!/usr/bin/env node
// Writes one academy's env file for deploy/compose.academy.yaml (MOD-17-T03, ADR-072, D-R95).
//
//   node deploy/scripts/new-academy-env.mjs <slug> --domain academy.example.com \
//        --name-ar "أكاديمية ..." [--name-en "..."] --timezone Europe/Istanbul --currency USD [--locale ar]
//
//   Local trial on this machine (plain http, published on 127.0.0.1 only):
//   node deploy/scripts/new-academy-env.mjs demo --local [--port 8080] --name-ar "تجربة" --timezone UTC --currency USD
//
// Options: --out <file> (default deploy/env/<slug>.env), --tag <image tag> (default local).
//
// The database passwords and JWT_SECRET are random (crypto.randomBytes), written to the
// file only (mode 600 on Linux/macOS — on Windows the mode is not applied: keep the
// file in your user profile) and NEVER printed. An existing file is never overwritten.
// Node >= 22, no npm install.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE = join(ROOT, 'deploy', 'env', 'academy.env.example');

function fail(message) {
  console.error(`new-academy-env: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [slug, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) fail(`unexpected argument "${arg}"`);
    const name = arg.slice(2);
    if (name === 'local' || name === 'help') options[name] = true;
    else {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value`);
      options[name] = value;
      i += 1;
    }
  }
  return { slug, options };
}

const USAGE = 'usage: node deploy/scripts/new-academy-env.mjs <slug> (--domain <host> | --local [--port <n>]) --name-ar <name> --timezone <IANA zone|UTC> --currency <ISO 4217> [--name-en <name>] [--locale ar|en|tr] [--tag <image tag>] [--out <file>]';

const { slug, options } = parseArgs(process.argv.slice(2));
if (!slug || options.help) {
  console.log(USAGE);
  process.exit(slug ? 0 : 1);
}
if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(slug)) fail('the slug is 1–32 characters of a-z, 0-9 and inner hyphens (it names the compose project academy-<slug>)');

const KNOWN = new Set(['domain', 'local', 'port', 'name-ar', 'name-en', 'timezone', 'currency', 'locale', 'tag', 'out']);
for (const key of Object.keys(options)) if (!KNOWN.has(key)) fail(`unknown option --${key}\n${USAGE}`);

// --- the site -----------------------------------------------------------------
let origin;
let httpPort;
let publishAddress;
if (options.local) {
  if (options.domain) fail('--local and --domain exclude each other');
  const port = options.port === undefined ? 80 : Number(options.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('--port is an integer 1–65535');
  origin = port === 80 ? 'http://localhost' : `http://localhost:${port}`;
  httpPort = port;
  publishAddress = '127.0.0.1';
} else {
  const domain = (options.domain ?? '').trim().toLowerCase();
  if (!domain) fail(`--domain or --local is required\n${USAGE}`);
  if (options.port !== undefined) fail('--port applies to --local only (a real domain uses 80 and 443)');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) fail(`"${domain}" is not a fully qualified domain name (use --local for localhost)`);
  origin = `https://${domain}`;
  httpPort = 80;
  publishAddress = '0.0.0.0';
}

// --- the seed -------------------------------------------------------------------
const nameAr = (options['name-ar'] ?? '').trim();
if (!nameAr) fail('--name-ar is required (the academy name in Arabic)');
const nameEn = (options['name-en'] ?? '').trim();
const timezone = (options.timezone ?? '').trim();
if (!timezone) fail('--timezone is required (an IANA zone such as Europe/Istanbul, or UTC)');
if (timezone !== 'UTC' && !Intl.supportedValuesOf('timeZone').includes(timezone)) fail(`unknown time zone "${timezone}"`);
const currency = (options.currency ?? '').trim().toUpperCase();
if (!/^[A-Z]{3}$/.test(currency)) fail('--currency is a 3-letter ISO 4217 code such as USD');
const locale = options.locale ?? 'ar';
if (!['ar', 'en', 'tr'].includes(locale)) fail('--locale is ar, en or tr');
const tag = options.tag ?? 'local';
if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) fail('--tag is a docker image tag');
for (const [name, value] of [['--name-ar', nameAr], ['--name-en', nameEn]]) {
  if (/[\r\n#"'$`\\]/.test(value)) fail(`${name} may not contain line breaks, #, quotes, $, backticks or backslashes`);
}

// --- write ----------------------------------------------------------------------
const out = resolve(options.out ?? join(ROOT, 'deploy', 'env', `${slug}.env`));
if (existsSync(out)) fail(`${relative(process.cwd(), out) || out} exists — an academy env file is never overwritten (rotate a secret by editing it and following the runbook)`);

const secret = (bytes) => randomBytes(bytes).toString('hex');
const values = {
  ACADEMY_ORIGIN: origin,
  HTTP_PORT: String(httpPort),
  HTTPS_PORT: '443',
  PUBLISH_ADDRESS: publishAddress,
  ACADEMY_IMAGE_TAG: tag,
  POSTGRES_PASSWORD: secret(24),
  DB_MIGRATOR_PASSWORD: secret(24),
  DB_APP_PASSWORD: secret(24),
  JWT_SECRET: randomBytes(48).toString('base64url'),
  SEED_ACADEMY_SLUG: slug,
  SEED_ACADEMY_NAME_AR: nameAr,
  SEED_ACADEMY_NAME_EN: nameEn,
  SEED_ACADEMY_TIMEZONE: timezone,
  SEED_ACADEMY_CURRENCY: currency,
  SEED_ACADEMY_LOCALE: locale,
};
const SECRET_NAMES = ['POSTGRES_PASSWORD', 'DB_MIGRATOR_PASSWORD', 'DB_APP_PASSWORD', 'JWT_SECRET'];

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
if (missing.length) fail(`the template lacks ${missing.join(', ')} — deploy/env/academy.env.example and this script disagree`);

const header = [
  `# Academy "${slug}" — written by deploy/scripts/new-academy-env.mjs on ${new Date().toISOString()}.`,
  '# SECRETS: keep this file on the server only (mode 600) and an offline copy; never commit it.',
  '',
];
mkdirSync(dirname(out), { recursive: true });
// The template's own leading comment block (up to the first blank line) describes the template.
const body = lines.slice(lines.indexOf('') + 1);
writeFileSync(out, [...header, ...body].join('\n'), { mode: 0o600, flag: 'wx' });

console.log(`wrote ${relative(ROOT, out).replaceAll('\\', '/')} (mode 600) for ${origin}`);
console.log(`random values (not shown): ${SECRET_NAMES.join(', ')}`);
console.log('next:');
console.log(`  docker compose -p academy-${slug} -f deploy/compose.academy.yaml --env-file ${relative(ROOT, out).replaceAll('\\', '/')} up -d --build`);
