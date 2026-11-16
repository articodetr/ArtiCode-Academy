// Platform MFA acceptance journey (roadmap 4o, PMFA-T05 — two-step verification of platform accounts,
// D-R113..D-R120) — run by the owner through accept-platform-mfa.ps1. Reads ONE JSON object from stdin:
//   { platformUrl | null, platformPort, allowRemote }
// (no password: nothing secret travels on stdin) and walks the platform MFA journey against the owner's DEVELOPMENT
// platform API — started here from backend/dist/platform/main.js on 127.0.0.1:<platformPort> and stopped at the end,
// also on a failure (or an already running one when platformUrl is given).
//
// It needs NO password from the owner: it creates its own throwaway `support` account with
// `npm run platform:create-user` (e-mail acc-pmfa-<yyMMddHHmm>@example.test, a random 20-character password handed to
// the command through PLATFORM_NEW_USER_PASSWORD in the child's environment only — never printed, never on a command
// line) and walks: sign-in → status off → setup (a wrong password first) → enable (a wrong code first) → status on →
// the two-step sign-in (a wrong code, the right code, the same challenge again) → a recovery code → new recovery
// codes (an old one refused) → disable → a plain sign-in → MFA on again and `npm run platform:reset-mfa` → a
// password-only sign-in. No phone is needed: the RFC 6238 codes (SHA-1, 6 digits, 30 s) are computed from the secret
// the server returns, with node:crypto only.
//
// The platform API needs PLATFORM_MFA_ENCRYPTION_KEY. When this script starts the API itself and the variable is set
// neither in its environment nor in backend/.env.local, backend/.env or ../.env, it generates a random 32-byte key for
// that child process only (never printed, never written anywhere): the secrets sealed during the run open only in
// that process, and the journey ends with MFA off. With platformUrl it relies on the running server and fails
// clearly when GET /api/auth/mfa answers `available: false`.
//
// It always leaves the throwaway account WITHOUT MFA: a `finally` runs `npm run platform:reset-mfa -- --email <it>
// --reason "accept-platform-mfa cleanup"` whenever the journey touched MFA and did not see it off at the end (the
// command needs no key and is a no-op when nothing is on), then reads the account's end state from the platform
// database. The account row stays as evidence (v1 has no way to delete a platform account), with its audit events.
//
// The CLI commands and the evidence read (a tiny query through the platform Prisma client, run as a child process
// with tsx — the platform API has no audit-log route) use the platform database named by PLATFORM_DATABASE_URL or the
// PLATFORM_DB_APP_* variables of the env files: with platformUrl, that API must use the same database.
//
// Never prints a password, the key, a TOTP secret, a TOTP code, a recovery code, a challenge, an access token or a
// cookie: every value of that kind is remembered as it arrives and masked out of every printed line, child output
// included. Never calls process.exit() after reading stdin (Windows libuv assertion). Prints PASS / FAIL / SKIP lines,
// EVIDENCE lines and a RESULT line.
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

class Stop extends Error {}

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLATFORM_ENTRY = join(BACKEND, 'dist', 'platform', 'main.js');
/** The env files the platform API and the CLI commands read (src/config/env-files.ts), first definition wins. */
const ENV_FILES = [
  [join(BACKEND, '.env.local'), 'backend/.env.local'],
  [join(BACKEND, '.env'), 'backend/.env'],
  [join(BACKEND, '..', '.env'), 'the repository root .env'],
];
const KEY_VARIABLE = 'PLATFORM_MFA_ENCRYPTION_KEY';
const USER_AGENT = 'ACC-PMFA platform journey';
const COOKIE = 'pla_refresh';
const STEP_MS = 30_000;
const RECOVERY_SHAPE = /^[0-9A-Z]{5}-[0-9A-Z]{5}$/;
const CLEANUP_REASON = 'accept-platform-mfa cleanup';
const JOURNEY_REASON = 'accept-platform-mfa journey step 17';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let raw = Buffer.concat(chunks).toString('utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
/** The launcher's JSON, or null. */
let input = null;
try {
  input = JSON.parse(raw);
} catch {
  input = null;
}
raw = null;
const validInput = input !== null && typeof input === 'object';
if (!validInput) input = {};
const platformPort = Number(input.platformPort) || 3100;
const givenPlatformUrl = input.platformUrl ? String(input.platformUrl).replace(/\/+$/, '') : null;
const platformUrl = givenPlatformUrl ?? `http://127.0.0.1:${platformPort}`;

// ------------------------------------------------------------------ output that never carries a secret
/** Every secret value seen so far (password, key, secrets, otpauth URIs, recovery codes, challenges, tokens, cookies). */
const hidden = new Set();
/** The TOTP codes sent: checked against the audit metadata, never printed. */
const sentCodes = new Set();
function hide(value) {
  if (typeof value === 'string' && value.length >= 6) hidden.add(value);
  return value;
}
function mask(text) {
  let out = String(text);
  // Longest first, so a value that contains another one is masked whole.
  for (const value of [...hidden].sort((a, b) => b.length - a.length)) out = out.split(value).join('***');
  return out;
}
const say = (text) => console.log(mask(text));
const tail = (text, n = 12) => mask(text).trim().split(/\r?\n/).slice(-n).join('\n');

const results = [];
function record(step, ok, evidence) {
  results.push({ step, ok });
  say(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${step}: ${evidence}`);
}
/** A step passes when every named check holds; its FAIL line names the checks that do not. */
function verdict(step, checks, evidence) {
  const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
  record(step, failed.length === 0, failed.length === 0 ? evidence : `${evidence} — NOT as expected: ${failed.join('; ')}`);
  return failed.length === 0;
}

/** What to do about a refusal that stops the journey for a reason outside the code under test. */
const HINTS = {
  rate_limited: givenPlatformUrl
    ? 'the platform allows 10 second-step requests per 15 minutes per IP and this journey sends 6 — wait 15 minutes (or restart that platform API: the limit lives in its memory) and run it again'
    : 'a platform rate limit was reached although this script started a fresh platform API — run it again in 15 minutes',
  account_locked: 'the account is locked after 5 failures in 15 minutes — run the script again (it creates a new account each minute)',
  mfa_unavailable: `the platform API has no ${KEY_VARIABLE} — set it (32 random bytes, base64) where that server reads its environment and restart it`,
};
/** The server's reason for a refusal: the stable `code` and the validation message(s), for FAIL lines. */
const why = (r) => {
  const text = [r.body?.code, Array.isArray(r.body?.message) ? r.body.message.join('; ') : r.body?.message].filter(Boolean).join(': ') || `HTTP ${r.status}`;
  const hint = HINTS[r.body?.code];
  return hint ? `${text} — ${hint}` : text;
};
/** `<status>` plus the server's reason when the status is not the expected one. */
const got = (r, expected) => `${r.status}${r.status === expected ? '' : ` (${why(r)})`}`;
const is2xx = (r) => r.status >= 200 && r.status < 300;
const isInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ------------------------------------------------------------------ HTTP with a hand-kept refresh cookie
/** The `pla_refresh` value a response sets: undefined = untouched, null = cleared, else the new value. */
function refreshCookieOf(res) {
  const line = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${COOKIE}=`));
  if (line === undefined) return undefined;
  const value = line.split(';')[0].slice(COOKIE.length + 1);
  const expired = /;\s*max-age=0(;|$)/i.test(line) || /;\s*expires=thu, 01 jan 1970/i.test(line);
  return value && !expired ? value : null;
}

/**
 * One request to the platform API. With `who`, the account's Bearer token is sent (unless `token` overrides it), its
 * cookie goes to the /api/auth routes (the cookie's Path), and whatever the response sets — a new access token, a
 * rotated or cleared cookie — becomes the account's, as in a browser. Every secret value of the answer is remembered
 * for masking before anything is printed. No Origin header (a non-browser client — OriginGuard lets it through).
 */
async function call(method, path, { who = null, token = who?.token, body } = {}) {
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (who?.cookie && path.startsWith('/api/auth')) headers.Cookie = `${COOKIE}=${who.cookie}`;
  const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${platformUrl}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const refresh = refreshCookieOf(res);
  hide(refresh);
  if (json && typeof json === 'object') {
    for (const key of ['accessToken', 'challenge', 'secret', 'otpauthUri']) hide(json[key]);
    if (Array.isArray(json.recoveryCodes)) json.recoveryCodes.forEach(hide);
  }
  if (who) {
    if (refresh !== undefined) who.cookie = refresh;
    if (typeof json?.accessToken === 'string') who.token = json.accessToken;
  }
  return { status: res.status, body: json, refresh };
}

/** The throwaway account: created by this script, its password never leaves this process and the CLI's environment. */
const operator = { identifier: '', password: '', token: null, cookie: null };
const signIn = (who) => call('POST', '/api/auth/login', { who, token: null, body: { identifier: who.identifier, password: who.password } });
async function signOut(who) {
  const r = await call('POST', '/api/auth/logout', { who, token: null });
  who.token = null;
  return r;
}
/** The second sign-in step with a TOTP `code` or a `recoveryCode`. */
const secondStep = (who, challenge, factor) => call('POST', '/api/auth/login/mfa', { who, token: null, body: { challenge, ...factor } });
const hasSession = (r) => r.status === 200 && typeof r.body?.accessToken === 'string' && typeof r.refresh === 'string';

// ------------------------------------------------------------------ RFC 6238 TOTP on node:crypto
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** RFC 4648 Base32 (either case, padding and whitespace ignored) → bytes; null for any other character. */
function base32Decode(text) {
  const clean = String(text).replace(/[\s=]/g, '').toUpperCase();
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE32.indexOf(char);
    if (value < 0) return null;
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}
/** RFC 4226 HOTP: HMAC-SHA-1 over the 8-byte big-endian counter, dynamic truncation, `digits` decimal digits. */
function hotp(key, counter, digits = 6) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}
const stepAt = (ms) => Math.floor(ms / STEP_MS);
/** The journey's authenticator for one secret: the key and the last step it had the server accept. */
function authenticator(secret) {
  const key = typeof secret === 'string' ? base32Decode(secret) : null;
  return key && key.length > 0 ? { key, lastStep: null } : null;
}
/**
 * A code the server will accept now. The server takes the current 30-second step ±1 and accepts each step once
 * (`platform_users.mfa_last_step`), so: the CURRENT step when the journey has not used it; else the NEXT step
 * (current + 1, still inside the server's window — no waiting); when that one is used too, WAIT until the clock
 * reaches it and use the step after it. The script and the server share one clock (a loopback server).
 */
async function freshCode(app) {
  for (;;) {
    const now = stepAt(Date.now());
    const step = app.lastStep === null ? now : Math.max(now, app.lastStep + 1);
    if (step <= now + 1) {
      const code = hotp(app.key, step);
      sentCodes.add(code);
      return { step, code };
    }
    const waitMs = Math.max((step - 1) * STEP_MS - Date.now() + 500, 100);
    say(`      … waiting ${Math.ceil(waitMs / 1000)} s for the next 30-second step (the journey used the current and the next code already)`);
    await sleep(waitMs);
  }
}
/** Marks the code's step as used once the server accepted it. */
const accepted = (app, picked) => {
  app.lastStep = Math.max(app.lastStep ?? -1, picked.step);
};
/** Six digits that are none of the codes around now — a wrong code, never a malformed one. */
function wrongCode(app) {
  const now = stepAt(Date.now());
  const valid = new Set();
  for (let step = now - 3; step <= now + 3; step += 1) valid.add(hotp(app.key, step));
  for (let n = 0; ; n += 1) {
    const candidate = String((123456 + n * 111111) % 1_000_000).padStart(6, '0');
    if (!valid.has(candidate)) return candidate;
  }
}
/** The parts of an `otpauth://totp/<label>?…` URI the checks need, or null. */
function parseOtpauth(text) {
  try {
    const uri = new URL(String(text));
    if (uri.protocol !== 'otpauth:' || uri.host !== 'totp') return null;
    const q = uri.searchParams;
    return { secret: q.get('secret'), issuer: q.get('issuer'), algorithm: q.get('algorithm') ?? 'SHA1', digits: q.get('digits') ?? '6', period: q.get('period') ?? '30' };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the platform child process
let child = null;
let childOutput = '';
let childExit = null;
/** How the started platform API got its PLATFORM_MFA_ENCRYPTION_KEY (for the INFO line), or null. */
let keySource = null;

/** True when something accepts TCP connections on 127.0.0.1:<port>. */
function portBusy(port) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(1500);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

/**
 * Where PLATFORM_MFA_ENCRYPTION_KEY is set for a platform API started here: 'environment', the env file's name, or
 * null (then the script hands the child a throwaway key). The value found is only remembered for masking.
 */
async function configuredKeySource() {
  const own = process.env[KEY_VARIABLE];
  if (own !== undefined) {
    // A process variable beats every file, even an empty one — which means "no key" for the server.
    if (own.trim() === '') return null;
    hide(own.trim());
    return 'environment';
  }
  let parse = null;
  try {
    ({ parse } = await import('dotenv'));
  } catch {
    parse = null;
  }
  for (const [file, label] of ENV_FILES) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    let value;
    if (parse) value = parse(text)[KEY_VARIABLE];
    else {
      const line = text.split(/\r?\n/).find((l) => new RegExp(`^\\s*(?:export\\s+)?${KEY_VARIABLE}\\s*=`).test(l));
      value = line === undefined ? undefined : line.slice(line.indexOf('=') + 1).replace(/^\s*["']?|["']?\s*$/g, '');
    }
    // The first file that defines the variable wins (src/config/env-files.ts), even with an empty value.
    if (value !== undefined) {
      if (value.trim() === '') return null;
      hide(value.trim());
      return label;
    }
  }
  return null;
}

function startPlatform(env) {
  // The child reads backend/.env.local, backend/.env and ../.env like npm run start:platform; process variables win.
  child = spawn(process.execPath, [PLATFORM_ENTRY], {
    cwd: BACKEND,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const collect = (data) => {
    childOutput = (childOutput + data.toString('utf8')).slice(-20_000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
  });
}

async function stopPlatform() {
  if (!child || childExit) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill();
  await Promise.race([exited, sleep(5000)]);
  if (!childExit) child.kill('SIGKILL');
  console.log('INFO  the platform API started by this script was stopped (its throwaway key, if any, is gone with it)');
}

process.once('SIGINT', () => {
  if (child && !childExit) child.kill();
  process.exitCode = 130;
});

// ------------------------------------------------------------------ the CLI commands and the database read
/** A double-quoted argument; only the script's own fixed texts and stamps reach here. */
function quoted(value) {
  if (!/^[\w@.:\- ]+$/.test(value)) throw new Error(`unsafe command-line argument: ${value}`);
  return `"${value}"`;
}
/** `npm run --silent <script> -- <args>` in backend/; extra variables go to the child's environment only. */
function runNpm(script, args, extraEnv = {}) {
  const r = spawnSync(['npm run --silent', script, '--', ...args].join(' '), {
    cwd: BACKEND,
    shell: true,
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });
  const out = mask(`${r.stdout ?? ''}${r.stderr ?? ''}`).trim();
  return { status: r.status, error: r.error?.code ?? null, out, first: out.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '' };
}

/**
 * The account's state and audit events from the platform database: a child process
 * `node --import tsx --input-type=module --eval <reader>` in backend/ that loads the env files and the platform Prisma
 * client like the CLI commands, prints ONE JSON line on its stdout (captured, never shown) with booleans and counts
 * for the MFA columns — never their values — and the user's `platform_users` audit events.
 */
const DATABASE_READER = [
  "import { resolve } from 'node:path';",
  "import { pathToFileURL } from 'node:url';",
  'const at = (p) => pathToFileURL(resolve(p)).href;',
  'const out = (value) => process.stdout.write(JSON.stringify(value));',
  'try {',
  "  const { config } = await import('dotenv');",
  "  const { ENV_FILE_PATHS } = await import(at('src/config/env-files.ts'));",
  '  config({ path: [...ENV_FILE_PATHS], quiet: true });',
  "  const { platformPostgresUrlFromEnv } = await import(at('src/config/database-url.ts'));",
  "  const url = process.env.PLATFORM_DATABASE_URL || platformPostgresUrlFromEnv(process.env, 'app');",
  "  if (!url) out({ ok: false, error: 'no platform database URL (PLATFORM_DATABASE_URL or PLATFORM_DB_APP_PASSWORD)' });",
  '  else {',
  "    const { PrismaPg } = await import('@prisma/adapter-pg');",
  "    const { PrismaClient } = await import(at('src/generated/platform/client.ts'));",
  '    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });',
  '    try {',
  '      const id = process.env.ACC_PMFA_USER_ID;',
  '      const users = await db.$queryRaw`SELECT email, role::text AS role, status::text AS status, mfa_secret IS NOT NULL AS "secretSet", mfa_enabled_at IS NOT NULL AS "enabled", mfa_last_step IS NOT NULL AS "lastStepSet", mfa_pending_secret IS NOT NULL AS "pendingSet" FROM platform_users WHERE id = ${id}::uuid`;',
  '      const codes = await db.$queryRaw`SELECT count(*)::int AS "total", (count(*) FILTER (WHERE used_at IS NULL))::int AS "unused" FROM platform_mfa_recovery_codes WHERE user_id = ${id}::uuid`;',
  '      const challenges = await db.$queryRaw`SELECT count(*)::int AS "open" FROM platform_mfa_challenges WHERE user_id = ${id}::uuid AND consumed_at IS NULL AND expires_at > now()`;',
  '      const sessions = await db.$queryRaw`SELECT count(*)::int AS "live" FROM platform_refresh_tokens WHERE user_id = ${id}::uuid AND revoked_at IS NULL AND expires_at > now()`;',
  `      const events = await db.$queryRaw\`SELECT id::text AS "id", action, actor_platform_user_id::text AS "actor", metadata, created_at AS "createdAt" FROM platform_audit_logs WHERE entity_type = 'platform_users' AND entity_id = \${id}::uuid ORDER BY id\`;`,
  '      out({ ok: true, user: users[0] ?? null, codes: codes[0], challenges: challenges[0], sessions: sessions[0], events });',
  '    } finally {',
  '      await db.$disconnect();',
  '    }',
  '  }',
  '} catch (error) {',
  "  out({ ok: false, error: String(error && error.message ? error.message : error).split('\\n')[0].slice(0, 300) });",
  '}',
].join('\n');

function readDatabase(userId) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', DATABASE_READER], {
    cwd: BACKEND,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ACC_PMFA_USER_ID: userId },
  });
  const line = String(r.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // reported below
  }
  return { ok: false, error: `the reader exited ${r.status ?? r.error?.code ?? '?'}: ${tail(`${r.stdout ?? ''}${r.stderr ?? ''}`, 4) || '(no output)'}` };
}

// ------------------------------------------------------------------ the journey
let userId = null;
/** True once platform:create-user exited 0: the account exists even when its id could not be read. */
let accountCreated = false;
/** True from the first setup on: only then may the cleanup reset the account's MFA. */
let touched = false;
/** True once the journey saw MFA off and no setup pending at the end (step 18). */
let verifiedOff = false;
/** True once step 18 ran: the audit trail of a complete journey can be checked exactly. */
let completed = false;
/** The `platform.users.mfa_reset` events the journey expects: step 17, plus one when the cleanup reset something. */
let expectedResets = 0;

async function journey() {
  // 0. The build and the platform API: started here, or the one named by -PlatformUrl.
  if (givenPlatformUrl) {
    record('0 build + start', null, `using the running platform API at ${platformUrl} (-PlatformUrl) — its database must be the one backend/.env names (the CLI commands write there)`);
  } else {
    if (!existsSync(PLATFORM_ENTRY)) {
      record('0 build + start', false, 'backend/dist/platform/main.js is missing — compile the backend once: in backend/ run "npm run start:dev" (it compiles the platform too; stop it afterwards if you like) or "npx nest build" (never while start:dev runs), then run this script again');
      throw new Stop();
    }
    if (await portBusy(platformPort)) {
      record('0 build + start', false, `something already listens on 127.0.0.1:${platformPort} — stop it, or if it is your platform API rerun with -PlatformUrl http://127.0.0.1:${platformPort} (or choose another port with -PlatformPort)`);
      throw new Stop();
    }
    const env = { ...process.env, PLATFORM_PORT: String(platformPort) };
    keySource = await configuredKeySource();
    if (keySource === null) {
      // A throwaway key for this child only: never printed, never stored; different from AUTH_MFA_ENCRYPTION_KEY.
      env[KEY_VARIABLE] = hide(randomBytes(32).toString('base64'));
    }
    startPlatform(env);
    const deadline = Date.now() + 45_000;
    let up = false;
    while (Date.now() < deadline && !childExit) {
      try {
        if ((await call('GET', '/api/health')).status === 200) {
          up = true;
          break;
        }
      } catch {
        // not listening yet
      }
      await sleep(500);
    }
    if (!up) {
      record('0 build + start', false, childExit ? `node dist/platform/main.js exited (code ${childExit.code}) — its last lines:\n${tail(childOutput)}` : `no answer on ${platformUrl} within 45 s — its last lines:\n${tail(childOutput)}`);
      throw new Stop();
    }
    record(
      '0 build + start',
      true,
      `started node dist/platform/main.js (pid ${child.pid}) on ${platformUrl}; ${KEY_VARIABLE} ${keySource === null ? 'generated for this process only (a throwaway key, not shown)' : `from ${keySource === 'environment' ? 'the environment' : keySource} (not shown)`}`,
    );
  }

  // 0. Readiness: liveness, readiness with the schema current, and the MFA routes compiled into this build.
  let live;
  try {
    live = await call('GET', '/api/health');
  } catch (error) {
    record('0 readiness', false, `cannot reach ${platformUrl} (${error?.cause?.code ?? error?.message ?? 'network error'}) — start the platform API or drop -PlatformUrl`);
    throw new Stop();
  }
  const ready = await call('GET', '/api/health/ready');
  const routes = await call('GET', '/api/auth/mfa');
  const schema = ready.body?.checks?.schema;
  const readyOk = verdict(
    '0 readiness',
    {
      'GET /api/health 200 articode-platform-api': live.status === 200 && live.body?.service === 'articode-platform-api',
      'GET /api/health/ready 200': ready.status === 200,
      'schema current': schema?.status === 'current',
      'the MFA routes exist (GET /api/auth/mfa without a token = 401)': routes.status === 401,
    },
    `GET /api/health ${got(live, 200)} ${live.body?.service ?? '-'} ${live.body?.version ?? '-'} (${live.body?.environment ?? '-'}); GET /api/health/ready ${got(ready, 200)} schema=${schema?.status ?? '-'} applied=${schema?.applied ?? '-'}; GET /api/auth/mfa without a token ${got(routes, 401)}`,
  );
  if (!readyOk) {
    if (schema?.status === 'outdated') say('      the platform database lacks migrations (the PMFA migration): in backend/ run "npm run platform:deploy", then run this script again');
    if (routes.status === 404) say('      this build has no platform MFA routes: dist/ is older than the PMFA code — recompile ("npm run start:dev" or "npx nest build", never while start:dev runs), then run this script again');
    throw new Stop();
  }

  // 1. The throwaway support account, through the existing CLI; its password goes through the child's environment only.
  const stamp = new Date().toISOString().slice(2, 16).replace(/[-T:]/g, '');
  operator.identifier = `acc-pmfa-${stamp}@example.test`;
  operator.password = hide(randomBytes(15).toString('base64url'));
  const created = runNpm('platform:create-user', ['--role', 'support', '--email', quoted(operator.identifier), '--name', quoted(`ACC PMFA ${stamp}`)], { PLATFORM_NEW_USER_PASSWORD: operator.password });
  const createdId = /\(user ([0-9a-f-]{36})\)/i.exec(created.out)?.[1] ?? null;
  if (created.status !== 0) {
    const again = created.status === 2 ? ' — the script ran less than a minute ago (the e-mail carries the minute): wait a minute and run it again' : '';
    record('1 throwaway support account', false, `npm run platform:create-user exited ${created.status ?? created.error ?? '?'}: ${tail(created.out, 4) || '(no output)'}${again}`);
    throw new Stop();
  }
  userId = createdId;
  accountCreated = true;
  // Exit 0 without the "(user <id>)" of its output: the account exists; step 2 takes the id from the sign-in.
  record('1 throwaway support account', createdId !== null, `npm run platform:create-user -- --role support: ${created.first || '(no output)'} (e-mail ${operator.identifier}, a random 20-character password — not shown)${createdId ? '' : ' — NOT as expected: the output names no user id'}`);

  // 2. Sign in with the password.
  const in2 = await signIn(operator);
  if (userId === null && typeof in2.body?.user?.id === 'string') userId = in2.body.user.id;
  const me2 = in2.status === 200 ? await call('GET', '/api/auth/me', { who: operator }) : { status: 0, body: null };
  if (
    !verdict(
      '2 sign-in (password)',
      {
        'HTTP 200 + access token': in2.status === 200 && typeof in2.body?.accessToken === 'string',
        'pla_refresh cookie set': typeof in2.refresh === 'string',
        'no mfaRequired': in2.body?.mfaRequired !== true,
        'the user is the new account': in2.body?.user?.id === userId,
        'GET /api/auth/me: support, active': me2.status === 200 && me2.body?.id === userId && me2.body?.role === 'support' && me2.body?.status === 'active',
      },
      `POST /api/auth/login ${got(in2, 200)} — a session (not shown); GET /api/auth/me ${got(me2, 200)} role=${me2.body?.role ?? '-'} status=${me2.body?.status ?? '-'}${in2.body?.code === 'invalid_credentials' && givenPlatformUrl ? ' — the account was created in the database of backend/.env: the platform API at -PlatformUrl uses another one' : ''}`,
    )
  )
    throw new Stop();

  // 3. Status: off (and MFA available on this server).
  const s3 = await call('GET', '/api/auth/mfa', { who: operator });
  if (s3.status === 200 && s3.body?.available === false) {
    record(
      '3 status: off',
      false,
      `GET /api/auth/mfa 200 available=false: the platform API at ${platformUrl} has no ${KEY_VARIABLE}. Put a 32-byte key where that server reads its environment — e.g. ${KEY_VARIABLE}=<the output of: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))">, different from AUTH_MFA_ENCRYPTION_KEY, kept secret and never changed once secrets are stored — restart it and run this script again (or drop -PlatformUrl: the script then starts its own platform API with a throwaway key)`,
    );
    throw new Stop();
  }
  if (
    !verdict(
      '3 status: off',
      { 'HTTP 200': s3.status === 200, 'available: true': s3.body?.available === true, 'enabled: false': s3.body?.enabled === false, 'enabledAt: null': s3.body?.enabledAt === null, 'recoveryCodesLeft: null': s3.body?.recoveryCodesLeft === null, 'pendingSetup: false': s3.body?.pendingSetup === false },
      `GET /api/auth/mfa ${got(s3, 200)} available=${s3.body?.available} enabled=${s3.body?.enabled} enabledAt=${s3.body?.enabledAt} recoveryCodesLeft=${s3.body?.recoveryCodesLeft} pendingSetup=${s3.body?.pendingSetup}`,
    )
  )
    throw new Stop();

  // 4. Setup with a wrong password: refused, no secret.
  const s4 = await call('POST', '/api/auth/mfa/setup', { who: operator, body: { password: `${operator.password}-not-the-password` } });
  verdict('4 setup with a wrong password', { 'HTTP 400': s4.status === 400, 'code password_invalid': s4.body?.code === 'password_invalid', 'no secret in the answer': s4.body?.secret === undefined }, `POST /api/auth/mfa/setup ${got(s4, 400)} code=${s4.body?.code ?? '-'}`);

  // 5. Setup: a Base32 secret and an otpauth URI, once. Only their shape is printed.
  touched = true;
  const s5 = await call('POST', '/api/auth/mfa/setup', { who: operator, body: { password: operator.password } });
  const secret = typeof s5.body?.secret === 'string' ? s5.body.secret : null;
  const app = authenticator(secret);
  const uri = parseOtpauth(s5.body?.otpauthUri);
  const setupLeftMs = isInstant(s5.body?.expiresAt) ? Date.parse(s5.body.expiresAt) - Date.now() : NaN;
  verdict(
    '5 setup',
    {
      '2xx': is2xx(s5),
      'a Base32 secret': app !== null,
      'at least 128 bits': (app?.key.length ?? 0) >= 16,
      'an otpauth://totp URI': uri !== null,
      'the URI carries the same secret': uri !== null && uri.secret === secret,
      'SHA1, 6 digits, 30 s': uri?.algorithm === 'SHA1' && uri?.digits === '6' && uri?.period === '30',
      'expires within 15 minutes': setupLeftMs > 0 && setupLeftMs <= 15 * 60_000,
    },
    `POST /api/auth/mfa/setup ${got(s5, 200)}: a secret was received (${secret?.length ?? 0} Base32 characters, ${app?.key.length ?? 0} bytes — not shown) and an otpauth URI (issuer ${uri?.issuer ?? '-'}, not shown); the setup expires at ${s5.body?.expiresAt ?? '-'}`,
  );
  if (!app) throw new Stop();

  // 6. Enable with a wrong code: refused.
  const s6 = await call('POST', '/api/auth/mfa/enable', { who: operator, body: { code: wrongCode(app) } });
  verdict('6 enable with a wrong code', { 'HTTP 400': s6.status === 400, 'code mfa_code_invalid': s6.body?.code === 'mfa_code_invalid', 'no recovery codes': s6.body?.recoveryCodes === undefined }, `POST /api/auth/mfa/enable with six wrong digits ${got(s6, 400)} code=${s6.body?.code ?? '-'}`);

  // 7. Enable: ten recovery codes, once.
  const c7 = await freshCode(app);
  const s7 = await call('POST', '/api/auth/mfa/enable', { who: operator, body: { code: c7.code } });
  if (is2xx(s7)) accepted(app, c7);
  const codes = Array.isArray(s7.body?.recoveryCodes) ? s7.body.recoveryCodes : [];
  verdict(
    '7 enable',
    {
      '2xx': is2xx(s7),
      '10 recovery codes': codes.length === 10,
      'all different': new Set(codes).size === codes.length,
      'shaped XXXXX-XXXXX': codes.length > 0 && codes.every((c) => typeof c === 'string' && RECOVERY_SHAPE.test(c)),
      'enabledAt': isInstant(s7.body?.enabledAt),
      'revokedSessions is a count': Number.isInteger(s7.body?.revokedSessions),
    },
    `POST /api/auth/mfa/enable ${got(s7, 200)}: ${codes.length} recovery codes received (not shown), enabledAt=${s7.body?.enabledAt ?? '-'}, revokedSessions=${s7.body?.revokedSessions ?? '-'} (every OTHER session ended; this one stays)`,
  );
  if (!is2xx(s7) || codes.length < 2) throw new Stop();

  // 8. Status: on with 10 codes; the current session survived the change.
  const s8 = await call('GET', '/api/auth/mfa', { who: operator });
  verdict(
    '8 status: on, 10 codes left',
    { 'HTTP 200 (this session still works)': s8.status === 200, 'enabled: true': s8.body?.enabled === true, 'enabledAt set': isInstant(s8.body?.enabledAt), 'recoveryCodesLeft: 10': s8.body?.recoveryCodesLeft === 10, 'pendingSetup: false': s8.body?.pendingSetup === false },
    `GET /api/auth/mfa ${got(s8, 200)} enabled=${s8.body?.enabled} enabledAt=${s8.body?.enabledAt} recoveryCodesLeft=${s8.body?.recoveryCodesLeft} pendingSetup=${s8.body?.pendingSetup}`,
  );

  // 9. Sign out, sign in: the password alone gives a challenge — no session, no cookie.
  const out9 = await signOut(operator);
  const in9 = await signIn(operator);
  const challenge = typeof in9.body?.challenge === 'string' ? in9.body.challenge : null;
  verdict(
    '9 sign-in asks for the second step',
    {
      'logout 204': out9.status === 204,
      'HTTP 200': in9.status === 200,
      'mfaRequired: true': in9.body?.mfaRequired === true,
      'a challenge': challenge !== null && challenge.length >= 32,
      'expiresAt': isInstant(in9.body?.expiresAt),
      'no access token': in9.body?.accessToken === undefined,
      'no user': in9.body?.user === undefined,
      'no pla_refresh cookie': typeof in9.refresh !== 'string',
    },
    `POST /api/auth/logout ${got(out9, 204)}; POST /api/auth/login ${got(in9, 200)} mfaRequired=${in9.body?.mfaRequired} — a challenge (not shown) until ${in9.body?.expiresAt ?? '-'}, cookie ${typeof in9.refresh === 'string' ? 'SET' : 'not set'}`,
  );
  if (!challenge) throw new Stop();

  // 10. The second step with a wrong code (counted as a failed sign-in; step 11 resets the counter).
  const s10 = await secondStep(operator, challenge, { code: wrongCode(app) });
  verdict('10 second step with a wrong code', { 'HTTP 401': s10.status === 401, 'code mfa_code_invalid': s10.body?.code === 'mfa_code_invalid', 'no session': s10.body?.accessToken === undefined }, `POST /api/auth/login/mfa with six wrong digits ${got(s10, 401)} code=${s10.body?.code ?? '-'}`);

  // 11. The same challenge with the right code: a session.
  const c11 = await freshCode(app);
  const s11 = await secondStep(operator, challenge, { code: c11.code });
  if (s11.status === 200) accepted(app, c11);
  const me11 = s11.status === 200 ? await call('GET', '/api/auth/me', { who: operator }) : { status: 0, body: null };
  if (
    !verdict(
      '11 second step with the right code',
      { 'HTTP 200 + access token': s11.status === 200 && typeof s11.body?.accessToken === 'string', 'pla_refresh cookie set': typeof s11.refresh === 'string', 'the user is the new account': s11.body?.user?.id === userId, 'GET /api/auth/me 200 as the account': me11.status === 200 && me11.body?.id === userId },
      `POST /api/auth/login/mfa ${got(s11, 200)} — a session (not shown); GET /api/auth/me ${got(me11, 200)} ${me11.body?.id ?? '-'}`,
    )
  )
    throw new Stop();

  // 12. The same challenge again, with a code that would be valid: refused — a challenge opens one session. No account
  // is passed, so a session the server must not open would not replace the journey's.
  const c12 = await freshCode(app);
  const s12 = await call('POST', '/api/auth/login/mfa', { body: { challenge, code: c12.code } });
  if (s12.status === 200) {
    accepted(app, c12);
    hide(s12.body?.accessToken);
  }
  verdict('12 the same challenge again', { 'HTTP 401': s12.status === 401, 'code mfa_challenge_invalid': s12.body?.code === 'mfa_challenge_invalid', 'no session': s12.body?.accessToken === undefined }, `POST /api/auth/login/mfa with the challenge of step 11 and a fresh valid code ${got(s12, 401)} code=${s12.body?.code ?? '-'}`);

  // 13. Sign in again and finish with a recovery code: a session, 9 codes left.
  const out13 = await signOut(operator);
  const in13 = await signIn(operator);
  const s13 = typeof in13.body?.challenge === 'string' ? await secondStep(operator, in13.body.challenge, { recoveryCode: codes[0] }) : { status: 0, body: null };
  const st13 = s13.status === 200 ? await call('GET', '/api/auth/mfa', { who: operator }) : { status: 0, body: null };
  if (
    !verdict(
      '13 sign-in with a recovery code',
      { 'logout 204': out13.status === 204, 'mfaRequired': in13.body?.mfaRequired === true, 'HTTP 200 + session': hasSession(s13), 'recoveryCodesLeft: 9': st13.status === 200 && st13.body?.recoveryCodesLeft === 9 },
      `POST /api/auth/login ${got(in13, 200)} mfaRequired=${in13.body?.mfaRequired}; POST /api/auth/login/mfa with recovery code 1 of 10 (not shown) ${got(s13, 200)}; GET /api/auth/mfa ${got(st13, 200)} recoveryCodesLeft=${st13.body?.recoveryCodesLeft ?? '-'}`,
    )
  )
    throw new Stop();

  // 14. New recovery codes with a code; then an OLD, still unused code is refused on the next sign-in (counted as a
  // failed sign-in) and the same challenge is finished with a valid code (the counter resets).
  const c14 = await freshCode(app);
  const r14 = await call('POST', '/api/auth/mfa/recovery-codes', { who: operator, body: { password: operator.password, code: c14.code } });
  if (is2xx(r14)) accepted(app, c14);
  const fresh = Array.isArray(r14.body?.recoveryCodes) ? r14.body.recoveryCodes : [];
  const out14 = await signOut(operator);
  const in14 = await signIn(operator);
  const challenge14 = typeof in14.body?.challenge === 'string' ? in14.body.challenge : null;
  const old14 = challenge14 ? await secondStep(operator, challenge14, { recoveryCode: codes[1] }) : { status: 0, body: null };
  const c14b = challenge14 ? await freshCode(app) : null;
  const fin14 = challenge14 ? await secondStep(operator, challenge14, { code: c14b.code }) : { status: 0, body: null };
  if (fin14.status === 200) accepted(app, c14b);
  if (
    !verdict(
      '14 new recovery codes; an old one is refused',
      {
        'regenerate 2xx': is2xx(r14),
        '10 new codes, all different': fresh.length === 10 && new Set(fresh).size === 10,
        'none of the old codes': fresh.length > 0 && fresh.every((c) => !codes.includes(c)),
        'logout 204': out14.status === 204,
        'mfaRequired': in14.body?.mfaRequired === true,
        'old code: 401 mfa_code_invalid': old14.status === 401 && old14.body?.code === 'mfa_code_invalid',
        'finished with a valid code: session': hasSession(fin14),
      },
      `POST /api/auth/mfa/recovery-codes ${got(r14, 200)} (${fresh.length} new codes, not shown); sign-in ${got(in14, 200)}: an unused OLD recovery code ${got(old14, 401)}, then the same challenge with a valid code ${got(fin14, 200)}`,
    )
  )
    throw new Stop();

  // 15. Disable with the password and a code: off, the codes gone, this session kept.
  const c15 = await freshCode(app);
  const s15 = await call('POST', '/api/auth/mfa/disable', { who: operator, body: { password: operator.password, code: c15.code } });
  if (is2xx(s15)) accepted(app, c15);
  const st15 = await call('GET', '/api/auth/mfa', { who: operator });
  if (
    !verdict(
      '15 disable with a code',
      { '2xx': is2xx(s15), 'revokedSessions is a count': Number.isInteger(s15.body?.revokedSessions), 'status HTTP 200 (this session kept)': st15.status === 200, 'enabled: false': st15.body?.enabled === false, 'enabledAt: null': st15.body?.enabledAt === null, 'recoveryCodesLeft: null (off)': st15.body?.recoveryCodesLeft === null },
      `POST /api/auth/mfa/disable ${got(s15, 200)} revokedSessions=${s15.body?.revokedSessions ?? '-'}; GET /api/auth/mfa ${got(st15, 200)} enabled=${st15.body?.enabled} enabledAt=${st15.body?.enabledAt} recoveryCodesLeft=${st15.body?.recoveryCodesLeft}`,
    )
  )
    throw new Stop();

  // 16. Sign in: a normal session, no second step.
  const out16 = await signOut(operator);
  const in16 = await signIn(operator);
  if (!verdict('16 plain sign-in', { 'logout 204': out16.status === 204, 'no mfaRequired': in16.body?.mfaRequired !== true, 'HTTP 200 + session': hasSession(in16) }, `POST /api/auth/logout ${got(out16, 204)}; POST /api/auth/login ${got(in16, 200)} — a session with its cookie (not shown)`)) throw new Stop();

  // 17. MFA on again (a new secret), then the server operator's reset (npm run platform:reset-mfa): every session ends.
  const setup17 = await call('POST', '/api/auth/mfa/setup', { who: operator, body: { password: operator.password } });
  const app17 = authenticator(setup17.body?.secret);
  const c17 = app17 ? await freshCode(app17) : null;
  const enable17 = c17 ? await call('POST', '/api/auth/mfa/enable', { who: operator, body: { code: c17.code } }) : { status: 0, body: null };
  if (is2xx(enable17)) accepted(app17, c17);
  const heldCookie = operator.cookie;
  const reset17 = runNpm('platform:reset-mfa', ['--email', quoted(operator.identifier), '--reason', quoted(JOURNEY_REASON)]);
  const resetDone = reset17.status === 0 && /\bwas reset\b/i.test(reset17.out) && !/nothing to reset/i.test(reset17.out);
  if (resetDone) expectedResets += 1;
  const revoked17 = Number(/(\d+) session/i.exec(reset17.out)?.[1] ?? NaN);
  const refresh17 = await call('POST', '/api/auth/refresh', { who: operator, token: null });
  verdict(
    '17 on again, then platform:reset-mfa',
    {
      'setup 2xx + secret': is2xx(setup17) && app17 !== null,
      'enable 2xx': is2xx(enable17),
      'a session cookie was held': typeof heldCookie === 'string',
      'reset-mfa exit 0': reset17.status === 0,
      'its output says reset': resetDone,
      'it names the account': reset17.out.includes(userId),
      'at least one session ended': Number.isInteger(revoked17) && revoked17 >= 1,
      'the old cookie no longer refreshes (401)': refresh17.status === 401,
    },
    `setup ${got(setup17, 200)}, enable ${got(enable17, 200)} (revokedSessions=${enable17.body?.revokedSessions ?? '-'}); npm run platform:reset-mfa -- --email <it> --reason "${JOURNEY_REASON}" exited ${reset17.status ?? reset17.error ?? '?'}: ${reset17.first || '(no output)'}; POST /api/auth/refresh with the held cookie ${got(refresh17, 401)} code=${refresh17.body?.code ?? '-'}`,
  );
  if (reset17.status !== 0 && /missing script/i.test(reset17.out)) say('      npm has no "platform:reset-mfa" script: pull main with PMFA-T04 merged (backend/package.json), then run this script again');

  // 18. A password-only sign-in: MFA is off and no setup pending — then sign out.
  const in18 = await signIn(operator);
  const st18 = hasSession(in18) ? await call('GET', '/api/auth/mfa', { who: operator }) : { status: 0, body: null };
  const ok18 = in18.body?.mfaRequired !== true && hasSession(in18);
  const out18 = ok18 ? await signOut(operator) : { status: 0 };
  verifiedOff = st18.status === 200 && st18.body?.enabled === false && st18.body?.pendingSetup === false;
  completed = true;
  verdict(
    '18 password-only sign-in',
    { 'no mfaRequired': in18.body?.mfaRequired !== true, 'HTTP 200 + session': hasSession(in18), 'status: enabled false, no setup pending': verifiedOff, 'logout 204': out18.status === 204 },
    `POST /api/auth/login ${got(in18, 200)} mfaRequired=${in18.body?.mfaRequired ?? false}; GET /api/auth/mfa ${got(st18, 200)} enabled=${st18.body?.enabled} pendingSetup=${st18.body?.pendingSetup}; POST /api/auth/logout ${got(out18, 204)}`,
  );

  record('19 CI', null, 'manual — CI on main after the PMFA PRs are merged');
}

// ------------------------------------------------------------------ cleanup and evidence
/** Leaves the account without MFA (only when the journey touched it), signs out, prints the evidence. */
async function finish() {
  console.log('');
  if (userId && touched && !verifiedOff) {
    const reset = runNpm('platform:reset-mfa', ['--email', quoted(operator.identifier), '--reason', quoted(CLEANUP_REASON)]);
    if (reset.status === 0 && /\bwas reset\b/i.test(reset.out) && !/nothing to reset/i.test(reset.out)) {
      expectedResets += 1;
      say(`CLEANUP the journey stopped before it saw two-step verification off: npm run platform:reset-mfa -- --email ${operator.identifier} --reason "${CLEANUP_REASON}" — ${reset.first}`);
    } else if (reset.status === 0) say(`CLEANUP not needed: ${reset.first || 'npm run platform:reset-mfa exited 0'}`);
    else record('cleanup', false, `npm run platform:reset-mfa exited ${reset.status ?? reset.error ?? '?'}: ${tail(reset.out, 4) || '(no output)'} — run it by hand: in backend/ npm run platform:reset-mfa -- --email ${operator.identifier} --reason "${CLEANUP_REASON}"`);
  } else if (userId && !touched) say('CLEANUP not needed: the journey stopped before it touched two-step verification');
  else if (userId) say('CLEANUP not needed: the journey saw two-step verification off at the end');
  if (operator.cookie) {
    try {
      await signOut(operator);
    } catch {
      // The session ends on its own; nothing secret is left behind.
    }
  }
  if (!userId) {
    say(accountCreated ? `EVIDENCE the throwaway account ${operator.identifier} was created, but its id could not be read (no MFA was touched)` : 'EVIDENCE nothing was created (the journey stopped before the throwaway account)');
    return;
  }
  printEvidence(readDatabase(userId));
}

/** Leaf keys and values of an audit metadata object. */
function leaves(value, out = []) {
  if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      out.push({ key });
      leaves(inner, out);
    }
  } else {
    out.push({ value });
  }
  return out;
}

/** The fields of an event worth printing: never a secret by construction, and printed through mask() anyway. */
function named(event) {
  const m = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata : {};
  const parts = [];
  for (const key of ['via', 'reason', 'role', 'scope', 'revokedSessions', 'recoveryCodesLeft', 'count', 'failedAttempts', 'locked']) {
    if (m[key] !== undefined && (typeof m[key] !== 'object' || m[key] === null)) parts.push(`${key} ${m[key]}`);
  }
  if (event.action === 'platform.users.mfa_reset' || event.action === 'platform.users.created') parts.push(`actor ${event.actor ? 'set' : 'none (the server)'}`);
  const keys = Object.keys(m).sort();
  return `${event.action} (${parts.join(', ')}${parts.length ? '; ' : ''}keys: ${keys.length ? keys.join(', ') : 'none'})`;
}

function printEvidence(db) {
  say(`EVIDENCE throwaway platform account ${operator.identifier} (${userId}), role support — the row stays in the dev platform database (v1 cannot delete a platform account)`);
  if (!db.ok) {
    say(`EVIDENCE the platform database could not be read: ${db.error}`);
    say('EVIDENCE   read the events by hand: SELECT action, metadata FROM platform_audit_logs WHERE entity_id = \'<the id above>\' ORDER BY id');
    return;
  }
  const events = Array.isArray(db.events) ? db.events : [];
  const isJourneyEvent = (e) => e.action.startsWith('platform.auth.mfa.') || e.action === 'platform.users.mfa_reset' || e.action.startsWith('platform.auth.login.') || e.action === 'platform.users.created';
  say(`EVIDENCE platform audit events of the account (${events.length}, oldest first):`);
  for (const event of events.filter(isJourneyEvent)) say(`EVIDENCE   ${event.id}  ${named(event)}`);
  const others = {};
  for (const event of events.filter((e) => !isJourneyEvent(e))) others[event.action] = (others[event.action] ?? 0) + 1;
  const rest = Object.entries(others).map(([action, n]) => `${action} ×${n}`).join(', ');
  if (rest) say(`EVIDENCE   other events: ${rest}`);

  // No secret, code, recovery code, challenge, key or token in any metadata, and no metadata key matching /token/i.
  const leaks = [];
  for (const event of events) {
    for (const leaf of leaves(event.metadata)) {
      if (leaf.key !== undefined && /token/i.test(leaf.key)) leaks.push(`${event.action}: key "${leaf.key}"`);
      if (typeof leaf.value === 'string' && (sentCodes.has(leaf.value) || [...hidden].some((value) => leaf.value.includes(value)))) leaks.push(`${event.action}: a secret value`);
    }
  }
  if (leaks.length > 0) record('audit metadata', false, `secret material in the platform audit metadata: ${[...new Set(leaks)].join('; ')}`);
  else say('EVIDENCE   metadata: no secret, TOTP code, recovery code, challenge, key or token in any of them, no key matching /token/i');

  // A complete journey writes an exact trail: one event per effective write, none for a refusal.
  if (completed) {
    const count = (action, where = () => true) => events.filter((e) => e.action === action && where(e.metadata ?? {})).length;
    const resets = events.filter((e) => e.action === 'platform.users.mfa_reset');
    verdict(
      'audit trail',
      {
        'platform.users.created ×1': count('platform.users.created') === 1,
        'platform.auth.mfa.enabled ×2 (steps 7, 17)': count('platform.auth.mfa.enabled') === 2,
        'platform.auth.mfa.disabled ×1 (step 15)': count('platform.auth.mfa.disabled') === 1,
        'platform.auth.mfa.recovery_codes.regenerated ×1 (step 14)': count('platform.auth.mfa.recovery_codes.regenerated') === 1,
        [`platform.users.mfa_reset ×${expectedResets} without an actor`]: resets.length === expectedResets && resets.every((e) => !e.actor),
        'login.succeeded via password ×3 (steps 2, 16, 18)': count('platform.auth.login.succeeded', (m) => m.via === 'password') === 3,
        'login.succeeded via mfa ×2 (steps 11, 14)': count('platform.auth.login.succeeded', (m) => m.via === 'mfa') === 2,
        'login.succeeded via recovery_code ×1 (step 13)': count('platform.auth.login.succeeded', (m) => m.via === 'recovery_code') === 1,
        'login.failed invalid_mfa_code ×2 (steps 10, 14)': count('platform.auth.login.failed', (m) => m.reason === 'invalid_mfa_code') === 2,
      },
      `${events.length} events of the account: the counts above`,
    );
  }

  const u = db.user;
  const sessions = db.sessions?.live ?? '-';
  if (!u) {
    record('end state', false, 'the account row was not found in the platform database the CLI commands use');
    return;
  }
  const mfaOff = u.secretSet === false && u.enabled === false && u.pendingSet === false && u.lastStepSet === false;
  const state = `mfa_secret ${u.secretSet ? 'SET' : 'null'}, mfa_enabled_at ${u.enabled ? 'SET' : 'null'}, mfa_last_step ${u.lastStepSet ? 'SET' : 'null'}, pending setup ${u.pendingSet ? 'SET' : 'none'}; recovery codes ${db.codes?.total ?? '-'} (${db.codes?.unused ?? '-'} unused); open challenges ${db.challenges?.open ?? '-'}; live sessions ${sessions}`;
  if (mfaOff) say(`EVIDENCE end state (platform database): ${state}`);
  else record('end state', false, `the account may STILL have two-step verification (${state}) — in backend/ run: npm run platform:reset-mfa -- --email ${operator.identifier} --reason "${CLEANUP_REASON}"`);
  say(`EVIDENCE ${operator.identifier} ends ${mfaOff ? 'WITHOUT MFA' : 'WITH MFA — reset it by hand (above)'}`);
}

// ------------------------------------------------------------------ run
// Dev-only tooling: it creates a platform account and changes its security settings, so it only ever targets a
// loopback platform API unless the launcher passes allowRemote (an explicit owner decision).
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
let targetHost = '';
try {
  targetHost = new URL(platformUrl).hostname;
} catch {
  targetHost = '';
}
if (!validInput) {
  console.log('FAIL  input: run this script through accept-platform-mfa.ps1 — it expects one JSON object on stdin');
  process.exitCode = 2;
} else if (!targetHost) {
  console.log('FAIL  target: the platform URL is not a URL');
  process.exitCode = 2;
} else if (!LOOPBACK_HOSTS.has(targetHost) && input.allowRemote !== true) {
  console.log(`FAIL  target: ${platformUrl} is not a local server — this script runs against the development platform API only (pass -AllowRemote to the launcher to override on purpose)`);
  process.exitCode = 2;
} else {
  try {
    await journey();
  } catch (error) {
    if (!(error instanceof Stop)) {
      say(`Unexpected error: ${error instanceof Error ? error.message : error}`);
      results.push({ step: 'run', ok: false });
    }
  } finally {
    try {
      await finish();
    } catch (error) {
      say(`CLEANUP/EVIDENCE failed: ${error instanceof Error ? error.message : error}`);
      results.push({ step: 'cleanup', ok: false });
    }
    await stopPlatform();
  }
  const failed = results.filter((r) => r.ok === false).length;
  const passed = results.filter((r) => r.ok === true).length;
  console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL / ${results.length - passed - failed} SKIP-or-manual`);
  process.exitCode = failed > 0 ? 1 : 0;
}
