// MFA acceptance journey (roadmap 4n, MFA-T05 — two-step verification, D-R105..D-R112) — run by the owner through
// accept-mfa.ps1. Reads ONE JSON object from stdin: { baseUrl, admin: { identifier, password }, student, allowRemote }
// and calls the real endpoints exactly as a browser would: the access token as a Bearer header, the refresh cookie
// `aca_refresh` kept by hand per account and sent to every /api/auth route (its cookie Path), no Origin header (a
// non-browser client — OriginGuard lets it through, like the earlier acceptance scripts).
//
// The journey runs on the STUDENT account: setup → enable → sign-in with the second step → a replayed challenge → a
// recovery code → new recovery codes → disable → MFA on again and the admin's reset (API-212) → a password-only
// sign-in. No phone is needed: the script computes the RFC 6238 codes (SHA-1, 6 digits, 30 s) from the secret the
// server returns, with node:crypto only.
//
// It always leaves the student WITHOUT MFA: a `finally` reads the user detail as the admin and, when MFA is still on
// and the journey turned it on, resets it with API-212 and says so. A student who already had MFA at the start is
// refused before any write and left as found.
//
// Never prints a password, a TOTP secret, a TOTP code, a recovery code, a challenge, an access token or a cookie:
// every value of that kind is remembered as it arrives and masked out of every printed line. Never calls
// process.exit() after reading stdin (Windows libuv assertion). Prints PASS / FAIL / SKIP lines, EVIDENCE lines and a
// RESULT line.
//
// Side effects on the student account: every other session of st@ ends (enabling MFA keeps only the current session,
// the admin's reset ends all of them), st@ signs in six times (the sign-in limit is 10 per 15 minutes per account and
// IP — wait 15 minutes, or restart the dev server, before a second run), and the journey types a wrong password once
// and three wrong codes on purpose (the account locks after 5 failures in 15 minutes; every successful sign-in resets
// the counter). The audit events stay in the dev database.
import { createHmac } from 'node:crypto';

class Stop extends Error {}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let raw = Buffer.concat(chunks).toString('utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
/** The launcher's JSON, or null — a parse error is never printed: its message can quote the input (the passwords). */
let input = null;
try {
  input = JSON.parse(raw);
} catch {
  input = null;
}
raw = null;
const validInput = input !== null && typeof input === 'object';
if (!validInput) input = {};
const baseUrl = String(input.baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const USER_AGENT = 'ACC-MFA owner journey';
const COOKIE = 'aca_refresh';
const STEP_MS = 30_000;
const RECOVERY_SHAPE = /^[0-9A-Z]{5}-[0-9A-Z]{5}$/;

/** One account of the journey: what the owner typed, plus the session the script holds for it. */
const account = (label, given) => ({
  label,
  identifier: String(given?.identifier ?? ''),
  password: String(given?.password ?? ''),
  token: null,
  cookie: null,
});
const admin = account('ADMIN', input.admin);
const student = account('STUDENT', input.student);

// ------------------------------------------------------------------ output that never carries a secret
/** Every secret value seen so far (passwords, secrets, otpauth URIs, recovery codes, challenges, tokens, cookies). */
const hidden = new Set();
/** The TOTP codes sent: checked against the audit metadata, never printed. */
const sentCodes = new Set();
function hide(value) {
  if (typeof value === 'string' && value.length >= 6) hidden.add(value);
  return value;
}
hide(admin.password);
hide(student.password);
function mask(text) {
  let out = String(text);
  // Longest first, so a value that contains another one is masked whole.
  for (const value of [...hidden].sort((a, b) => b.length - a.length)) out = out.split(value).join('***');
  return out;
}
const say = (text) => console.log(mask(text));

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
  rate_limited:
    'the sign-in routes allow 10 requests per 15 minutes per account and IP and this journey signs st@ in 6 times — wait 15 minutes (or restart the dev server: the limit lives in its memory) and run it again',
  account_locked: 'the account is locked after 5 failures in 15 minutes — wait until the lock ends and run it again',
  mfa_unavailable: 'the server has no AUTH_MFA_ENCRYPTION_KEY — set it in backend/.env and restart the dev server',
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
/** The `aca_refresh` value a response sets: undefined = untouched, null = cleared, else the new value. */
function refreshCookieOf(res) {
  const line = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${COOKIE}=`));
  if (line === undefined) return undefined;
  const value = line.split(';')[0].slice(COOKIE.length + 1);
  const expired = /;\s*max-age=0(;|$)/i.test(line) || /;\s*expires=thu, 01 jan 1970/i.test(line);
  return value && !expired ? value : null;
}

/**
 * One request. With `who`, the account's Bearer token is sent (unless `token` overrides it), its cookie goes to the
 * /api/auth routes, and whatever the response sets — a new access token, a rotated or cleared cookie — becomes the
 * account's, as in a browser. Every secret value of the answer is remembered for masking before anything is printed.
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
  const res = await fetch(`${baseUrl}${path}`, init);
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

/** An admin request; an access token that expired during the journey is renewed once through the admin's cookie. */
async function asAdmin(method, path, body) {
  let r = await call(method, path, { who: admin, body });
  if (r.status === 401 && r.body?.code === 'token_expired' && admin.cookie) {
    const renewed = await call('POST', '/api/auth/refresh', { who: admin, token: null });
    if (renewed.status === 200) r = await call(method, path, { who: admin, body });
  }
  return r;
}

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
 * (`users.mfa_last_step`), so: the CURRENT step when the journey has not used it; else the NEXT step (current + 1,
 * still inside the server's window — no waiting); when that one is used too, WAIT until the clock reaches it and use
 * the step after it. The script and the server share one clock (127.0.0.1).
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

// ------------------------------------------------------------------ the student's account, by the admin
async function userOf(who) {
  const r = await asAdmin('GET', `/api/users?q=${encodeURIComponent(who.identifier)}&limit=20`);
  const hit = (r.body?.items ?? []).find((u) => u.email === who.identifier.toLowerCase() || u.username === who.identifier.toLowerCase());
  if (!hit) {
    record(`resolve ${who.label}`, false, `account not found through GET /api/users?q= (HTTP ${r.status})`);
    throw new Stop();
  }
  return hit;
}

/** Leaf values of an audit metadata object. */
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

// ------------------------------------------------------------------ the journey
let studentId = null;
/** The newest audit event of the student before the journey: evidence counts only what is newer (UUIDv7 ids). */
let auditMark;
/** True from the first setup on: only then may the cleanup reset the student's MFA (never one the journey met). */
let touched = false;
let stoppedBeforeWrites = false;

// Dev-only tooling: the journey signs in with real passwords and changes the student's security settings, so it only
// ever targets a loopback server unless the launcher passes allowRemote (an explicit owner decision).
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
let targetHost = '';
try {
  targetHost = new URL(baseUrl).hostname;
} catch {
  targetHost = '';
}
if (!validInput || !admin.identifier || !admin.password || !student.identifier || !student.password) {
  console.log('FAIL  input: run this script through accept-mfa.ps1 — it expects one JSON object with the admin and student accounts on stdin');
  process.exitCode = 2;
} else if (!targetHost) {
  console.log('FAIL  target: the base URL is not a URL');
  process.exitCode = 2;
} else if (!LOOPBACK_HOSTS.has(targetHost) && input.allowRemote !== true) {
  console.log(`FAIL  target: ${baseUrl} is not a local server — this script runs against the development API only (pass -AllowRemote to the launcher to override on purpose)`);
  process.exitCode = 2;
} else {
  try {
    let ready;
    try {
      ready = await call('GET', '/api/health/ready');
    } catch (error) {
      record('readiness', false, `cannot reach ${baseUrl} (${error?.cause?.code ?? error?.message ?? 'network error'}) — start the API first: in backend/ run "npm run start:dev", wait until it listens on :3000, then run this script again`);
      stoppedBeforeWrites = true;
      throw new Stop();
    }
    if (ready.status !== 200) {
      record('readiness', false, `GET /api/health/ready -> HTTP ${ready.status} ${why(ready)}`);
      stoppedBeforeWrites = true;
      throw new Stop();
    }
    record('readiness', true, `GET /api/health/ready -> 200 (${baseUrl})`);

    // Preconditions — nothing is written before every one of them holds.
    stoppedBeforeWrites = true;
    const adminIn = await signIn(admin);
    if (adminIn.body?.mfaRequired === true) {
      record('preconditions', false, `${admin.identifier} answers mfaRequired: the journey needs an admin session from the password alone (its cleanup resets the student's MFA with it) — use an admin account without two-step verification and run it again. Nothing was changed.`);
      throw new Stop();
    }
    if (!hasSession(adminIn)) {
      record('preconditions', false, `admin sign-in ${got(adminIn, 200)} — stopping before any write`);
      throw new Stop();
    }
    const availability = await asAdmin('GET', '/api/auth/mfa');
    if (availability.status === 404) {
      record('preconditions', false, 'GET /api/auth/mfa -> 404: this server has no MFA routes — pull main with the MFA tasks merged, restart "npm run start:dev" and run it again. Nothing was changed.');
      throw new Stop();
    }
    if (availability.body?.code === 'mfa_unavailable' || (availability.status === 200 && availability.body?.available === false)) {
      record(
        'preconditions',
        false,
        'two-step verification is not available on this server (available: false): AUTH_MFA_ENCRYPTION_KEY is not set. Put a 32-byte key in backend/.env — e.g. AUTH_MFA_ENCRYPTION_KEY=<the output of: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))">, keep it secret and never change it once secrets are stored — then restart "npm run start:dev" and run this script again. Nothing was changed.',
      );
      throw new Stop();
    }
    if (availability.status !== 200 || availability.body?.available !== true) {
      record('preconditions', false, `GET /api/auth/mfa ${got(availability, 200)} available=${availability.body?.available} — stopping before any write`);
      throw new Stop();
    }
    const studentRow = await userOf(student);
    studentId = studentRow.id;
    const detail0 = await asAdmin('GET', `/api/users/${studentId}`);
    if (detail0.status === 200 && isInstant(detail0.body?.mfaEnabledAt)) {
      record('preconditions', false, `${student.identifier} already has two-step verification on (user detail mfaEnabledAt ${detail0.body.mfaEnabledAt}): the journey starts from an account without it — turn it off in the profile, or reset it as the admin (POST /api/users/${studentId}/mfa/reset), and run it again. Nothing was changed.`);
      throw new Stop();
    }
    const mark = await asAdmin('GET', `/api/audit-logs?entityType=users&entityId=${studentId}&limit=1`);
    auditMark = mark.status === 200 && Array.isArray(mark.body?.items) ? (mark.body.items[0]?.id ?? null) : undefined;
    record(
      'preconditions',
      true,
      `admin signed in with the password only; MFA available on the server; ${student.identifier} = ${studentId}, user detail ${got(detail0, 200)} mfaEnabledAt=${detail0.body?.mfaEnabledAt === undefined ? 'MISSING FROM THE DETAIL' : detail0.body.mfaEnabledAt}; audit watermark ${auditMark === undefined ? `not read (${mark.status})` : (auditMark ?? 'none — no earlier event')}`,
    );

    // 1. The student signs in with the password only.
    const in1 = await signIn(student);
    if (in1.body?.mfaRequired === true) {
      record('1 STUDENT signs in (password only)', false, `${student.identifier} answers mfaRequired: two-step verification is already on for this account — the journey starts from an account without it. Turn it off in the profile or reset it as the admin (POST /api/users/${studentId}/mfa/reset) and run it again. Nothing was changed.`);
      throw new Stop();
    }
    if (!verdict('1 STUDENT signs in (password only)', { 'HTTP 200 + access token': in1.status === 200 && typeof in1.body?.accessToken === 'string', 'aca_refresh cookie set': typeof in1.refresh === 'string', 'the user is the student': in1.body?.user?.id === studentId }, `POST /api/auth/login ${got(in1, 200)} — a session (access token and aca_refresh cookie, not shown) for ${in1.body?.user?.id ?? '-'}`)) throw new Stop();

    // 2. Status: off.
    const s2 = await call('GET', '/api/auth/mfa', { who: student });
    if (!verdict('2 status: off', { 'HTTP 200': s2.status === 200, 'available: true': s2.body?.available === true, 'enabled: false': s2.body?.enabled === false, 'enabledAt: null': s2.body?.enabledAt === null }, `GET /api/auth/mfa ${got(s2, 200)} available=${s2.body?.available} enabled=${s2.body?.enabled} enabledAt=${s2.body?.enabledAt} recoveryCodesLeft=${s2.body?.recoveryCodesLeft} pendingSetup=${s2.body?.pendingSetup}`)) throw new Stop();
    stoppedBeforeWrites = false;

    // 3. Setup with a wrong password: refused, no secret.
    const s3 = await call('POST', '/api/auth/mfa/setup', { who: student, body: { password: `${student.password}-not-the-password` } });
    verdict('3 setup with a wrong password', { 'HTTP 400': s3.status === 400, 'code password_invalid': s3.body?.code === 'password_invalid', 'no secret in the answer': s3.body?.secret === undefined }, `POST /api/auth/mfa/setup ${got(s3, 400)} code=${s3.body?.code ?? '-'}`);

    // 4. Setup: a Base32 secret and an otpauth URI, once. Only their shape is printed.
    touched = true;
    const s4 = await call('POST', '/api/auth/mfa/setup', { who: student, body: { password: student.password } });
    const secret = typeof s4.body?.secret === 'string' ? s4.body.secret : null;
    const app = authenticator(secret);
    const uri = parseOtpauth(s4.body?.otpauthUri);
    const setupLeftMs = isInstant(s4.body?.expiresAt) ? Date.parse(s4.body.expiresAt) - Date.now() : NaN;
    verdict(
      '4 setup',
      {
        '2xx': is2xx(s4),
        'a Base32 secret': app !== null,
        'at least 128 bits': (app?.key.length ?? 0) >= 16,
        'an otpauth://totp URI': uri !== null,
        'the URI carries the same secret': uri !== null && uri.secret === secret,
        'SHA1, 6 digits, 30 s': uri?.algorithm === 'SHA1' && uri?.digits === '6' && uri?.period === '30',
        'expires within 15 minutes': setupLeftMs > 0 && setupLeftMs <= 15 * 60_000,
      },
      `POST /api/auth/mfa/setup ${got(s4, 200)}: a secret was received (${secret?.length ?? 0} Base32 characters, ${app?.key.length ?? 0} bytes — not shown) and an otpauth URI (issuer ${uri?.issuer ?? '-'}, not shown); the setup expires at ${s4.body?.expiresAt ?? '-'}`,
    );
    if (!app) throw new Stop();

    // 5. Enable with a wrong code: refused (wrong factor 1 of 3).
    const s5 = await call('POST', '/api/auth/mfa/enable', { who: student, body: { code: wrongCode(app) } });
    verdict('5 enable with a wrong code', { 'HTTP 400': s5.status === 400, 'code mfa_code_invalid': s5.body?.code === 'mfa_code_invalid', 'no recovery codes': s5.body?.recoveryCodes === undefined }, `POST /api/auth/mfa/enable with six wrong digits ${got(s5, 400)} code=${s5.body?.code ?? '-'}`);

    // 6. Enable: ten recovery codes, once.
    const c6 = await freshCode(app);
    const s6 = await call('POST', '/api/auth/mfa/enable', { who: student, body: { code: c6.code } });
    if (is2xx(s6)) accepted(app, c6);
    const codes = Array.isArray(s6.body?.recoveryCodes) ? s6.body.recoveryCodes : [];
    verdict(
      '6 enable',
      {
        '2xx': is2xx(s6),
        '10 recovery codes': codes.length === 10,
        'all different': new Set(codes).size === codes.length,
        'shaped XXXXX-XXXXX': codes.length > 0 && codes.every((c) => typeof c === 'string' && RECOVERY_SHAPE.test(c)),
        'enabledAt': isInstant(s6.body?.enabledAt),
        'revokedSessions is a count': Number.isInteger(s6.body?.revokedSessions),
      },
      `POST /api/auth/mfa/enable ${got(s6, 200)}: ${codes.length} recovery codes received (not shown), enabledAt=${s6.body?.enabledAt ?? '-'}, revokedSessions=${s6.body?.revokedSessions ?? '-'} (every OTHER session of st@ ended; this one stays)`,
    );
    if (!is2xx(s6) || codes.length < 2) throw new Stop();

    // 7. Status: on with 10 codes; the current session survived the change; the admin sees mfaEnabledAt.
    const s7 = await call('GET', '/api/auth/mfa', { who: student });
    const d7 = await asAdmin('GET', `/api/users/${studentId}`);
    verdict(
      '7 status: on, 10 codes left',
      {
        'HTTP 200 (this session still works)': s7.status === 200,
        'enabled: true': s7.body?.enabled === true,
        'enabledAt set': isInstant(s7.body?.enabledAt),
        'recoveryCodesLeft: 10': s7.body?.recoveryCodesLeft === 10,
        'pendingSetup: false': s7.body?.pendingSetup === false,
        'user detail mfaEnabledAt set': d7.status === 200 && isInstant(d7.body?.mfaEnabledAt),
      },
      `GET /api/auth/mfa ${got(s7, 200)} enabled=${s7.body?.enabled} enabledAt=${s7.body?.enabledAt} recoveryCodesLeft=${s7.body?.recoveryCodesLeft} pendingSetup=${s7.body?.pendingSetup}; GET /api/users/:id (admin) ${got(d7, 200)} mfaEnabledAt=${d7.body?.mfaEnabledAt}`,
    );

    // 8. Sign out, sign in: the password alone gives a challenge — no session, no cookie.
    const out8 = await signOut(student);
    const in8 = await signIn(student);
    const challenge = typeof in8.body?.challenge === 'string' ? in8.body.challenge : null;
    verdict(
      '8 sign-in asks for the second step',
      {
        'logout 204': out8.status === 204,
        'HTTP 200': in8.status === 200,
        'mfaRequired: true': in8.body?.mfaRequired === true,
        'a challenge': challenge !== null && challenge.length >= 32,
        'expiresAt': isInstant(in8.body?.expiresAt),
        'no access token': in8.body?.accessToken === undefined,
        'no user': in8.body?.user === undefined,
        'no aca_refresh cookie': typeof in8.refresh !== 'string',
      },
      `POST /api/auth/logout ${got(out8, 204)}; POST /api/auth/login ${got(in8, 200)} mfaRequired=${in8.body?.mfaRequired} — a challenge (not shown) until ${in8.body?.expiresAt ?? '-'}, cookie ${typeof in8.refresh === 'string' ? 'SET' : 'not set'}`,
    );
    if (!challenge) throw new Stop();

    // 9. The second step with a wrong code (wrong factor 2 of 3 — counted as a failed sign-in; step 10 resets it).
    const s9 = await secondStep(student, challenge, { code: wrongCode(app) });
    verdict('9 second step with a wrong code', { 'HTTP 401': s9.status === 401, 'code mfa_code_invalid': s9.body?.code === 'mfa_code_invalid', 'no session': s9.body?.accessToken === undefined }, `POST /api/auth/login/mfa with six wrong digits ${got(s9, 401)} code=${s9.body?.code ?? '-'}`);

    // 10. The same challenge with the right code: a session.
    const c10 = await freshCode(app);
    const s10 = await secondStep(student, challenge, { code: c10.code });
    if (s10.status === 200) accepted(app, c10);
    const me10 = s10.status === 200 ? await call('GET', '/api/auth/me', { who: student }) : { status: 0 };
    if (
      !verdict(
        '10 second step with the right code',
        { 'HTTP 200 + access token': s10.status === 200 && typeof s10.body?.accessToken === 'string', 'aca_refresh cookie set': typeof s10.refresh === 'string', 'the user is the student': s10.body?.user?.id === studentId, 'GET /api/auth/me 200 as the student': me10.status === 200 && me10.body?.id === studentId },
        `POST /api/auth/login/mfa ${got(s10, 200)} — a session (not shown); GET /api/auth/me ${got(me10, 200)} ${me10.body?.id ?? '-'}`,
      )
    )
      throw new Stop();

    // 11. The same challenge again, with a code that would be valid: refused — a challenge opens one session. No
    // account is passed, so a session the server must not open would not replace the student's.
    const c11 = await freshCode(app);
    const s11 = await call('POST', '/api/auth/login/mfa', { body: { challenge, code: c11.code } });
    if (s11.status === 200) accepted(app, c11);
    verdict('11 the same challenge again', { 'HTTP 401': s11.status === 401, 'code mfa_challenge_invalid': s11.body?.code === 'mfa_challenge_invalid', 'no session': s11.body?.accessToken === undefined }, `POST /api/auth/login/mfa with the challenge of step 10 and a fresh valid code ${got(s11, 401)} code=${s11.body?.code ?? '-'}`);

    // 12. Sign in again and finish with a recovery code: a session, 9 codes left.
    const out12 = await signOut(student);
    const in12 = await signIn(student);
    const s12 = typeof in12.body?.challenge === 'string' ? await secondStep(student, in12.body.challenge, { recoveryCode: codes[0] }) : { status: 0 };
    const st12 = s12.status === 200 ? await call('GET', '/api/auth/mfa', { who: student }) : { status: 0 };
    if (
      !verdict(
        '12 sign-in with a recovery code',
        { 'logout 204': out12.status === 204, 'mfaRequired': in12.body?.mfaRequired === true, 'HTTP 200 + session': hasSession(s12), 'recoveryCodesLeft: 9': st12.status === 200 && st12.body?.recoveryCodesLeft === 9 },
        `POST /api/auth/login ${got(in12, 200)} mfaRequired=${in12.body?.mfaRequired}; POST /api/auth/login/mfa with recovery code 1 of 10 (not shown) ${got(s12, 200)}; GET /api/auth/mfa ${got(st12, 200)} recoveryCodesLeft=${st12.body?.recoveryCodesLeft ?? '-'}`,
      )
    )
      throw new Stop();

    // 13. New recovery codes with a code; then an OLD, still unused code is refused on the next sign-in (wrong factor
    // 3 of 3, counted as a failed sign-in) and the same challenge is finished with a valid code (the counter resets).
    const c13 = await freshCode(app);
    const r13 = await call('POST', '/api/auth/mfa/recovery-codes', { who: student, body: { password: student.password, code: c13.code } });
    if (is2xx(r13)) accepted(app, c13);
    const fresh = Array.isArray(r13.body?.recoveryCodes) ? r13.body.recoveryCodes : [];
    const out13 = await signOut(student);
    const in13 = await signIn(student);
    const challenge13 = typeof in13.body?.challenge === 'string' ? in13.body.challenge : null;
    const old13 = challenge13 ? await secondStep(student, challenge13, { recoveryCode: codes[1] }) : { status: 0 };
    const c13b = challenge13 ? await freshCode(app) : null;
    const fin13 = challenge13 ? await secondStep(student, challenge13, { code: c13b.code }) : { status: 0 };
    if (fin13.status === 200) accepted(app, c13b);
    if (
      !verdict(
        '13 new recovery codes; an old one is refused',
        {
          'regenerate 2xx': is2xx(r13),
          '10 new codes, all different': fresh.length === 10 && new Set(fresh).size === 10,
          'none of the old codes': fresh.length > 0 && fresh.every((c) => !codes.includes(c)),
          'logout 204': out13.status === 204,
          'mfaRequired': in13.body?.mfaRequired === true,
          'old code: 401 mfa_code_invalid': old13.status === 401 && old13.body?.code === 'mfa_code_invalid',
          'finished with a valid code: session': hasSession(fin13),
        },
        `POST /api/auth/mfa/recovery-codes ${got(r13, 200)} (${fresh.length} new codes, not shown); sign-in ${got(in13, 200)}: an unused OLD recovery code ${got(old13, 401)}, then the same challenge with a valid code ${got(fin13, 200)}`,
      )
    )
      throw new Stop();

    // 14. Disable with the password and a code: off, the codes gone, this session kept.
    const c14 = await freshCode(app);
    const s14 = await call('POST', '/api/auth/mfa/disable', { who: student, body: { password: student.password, code: c14.code } });
    if (is2xx(s14)) accepted(app, c14);
    const st14 = await call('GET', '/api/auth/mfa', { who: student });
    if (
      !verdict(
        '14 disable',
        { '2xx': is2xx(s14), 'revokedSessions is a count': Number.isInteger(s14.body?.revokedSessions), 'status HTTP 200 (this session kept)': st14.status === 200, 'enabled: false': st14.body?.enabled === false, 'enabledAt: null': st14.body?.enabledAt === null, 'recoveryCodesLeft: null (off)': st14.body?.recoveryCodesLeft === null },
        `POST /api/auth/mfa/disable ${got(s14, 200)} revokedSessions=${s14.body?.revokedSessions ?? '-'}; GET /api/auth/mfa ${got(st14, 200)} enabled=${st14.body?.enabled} enabledAt=${st14.body?.enabledAt} recoveryCodesLeft=${st14.body?.recoveryCodesLeft}`,
      )
    )
      throw new Stop();

    // 15. Sign in: a normal session, no second step.
    const out15 = await signOut(student);
    const in15 = await signIn(student);
    if (!verdict('15 sign-in without a second step', { 'logout 204': out15.status === 204, 'no mfaRequired': in15.body?.mfaRequired !== true, 'HTTP 200 + session': hasSession(in15) }, `POST /api/auth/logout ${got(out15, 204)}; POST /api/auth/login ${got(in15, 200)} — a session with its cookie (not shown)`)) throw new Stop();

    // 16. MFA on again (a new secret), then the admin resets it (API-212): every session of the student ends.
    const setup16 = await call('POST', '/api/auth/mfa/setup', { who: student, body: { password: student.password } });
    const app16 = authenticator(setup16.body?.secret);
    const c16 = app16 ? await freshCode(app16) : null;
    const enable16 = c16 ? await call('POST', '/api/auth/mfa/enable', { who: student, body: { code: c16.code } }) : { status: 0 };
    if (is2xx(enable16)) accepted(app16, c16);
    const reset16 = await asAdmin('POST', `/api/users/${studentId}/mfa/reset`, { reason: 'accept-mfa: the owner acceptance journey, step 16' });
    const refresh16 = await call('POST', '/api/auth/refresh', { who: student, token: null });
    const d16 = await asAdmin('GET', `/api/users/${studentId}`);
    verdict(
      '16 on again, then the admin resets it',
      {
        'setup 2xx + secret': is2xx(setup16) && app16 !== null,
        'enable 2xx': is2xx(enable16),
        'reset 2xx': is2xx(reset16),
        'reset: true': reset16.body?.reset === true,
        'userId is the student': reset16.body?.userId === studentId,
        'revokedSessions >= 1': Number.isInteger(reset16.body?.revokedSessions) && reset16.body.revokedSessions >= 1,
        'the old session no longer refreshes (401)': refresh16.status === 401,
        'user detail mfaEnabledAt: null': d16.status === 200 && d16.body?.mfaEnabledAt === null,
      },
      `setup ${got(setup16, 200)}, enable ${got(enable16, 200)} (revokedSessions=${enable16.body?.revokedSessions ?? '-'}); POST /api/users/:id/mfa/reset (admin, with a reason) ${got(reset16, 200)} reset=${reset16.body?.reset} revokedSessions=${reset16.body?.revokedSessions ?? '-'}; POST /api/auth/refresh with the student's cookie ${got(refresh16, 401)} code=${refresh16.body?.code ?? '-'}; GET /api/users/:id ${got(d16, 200)} mfaEnabledAt=${d16.body?.mfaEnabledAt}`,
    );

    // 17. The student signs in with the password only — and signs out.
    const in17 = await signIn(student);
    const ok17 = in17.body?.mfaRequired !== true && hasSession(in17);
    const out17 = ok17 ? await signOut(student) : { status: 0 };
    verdict('17 STUDENT signs in with the password only', { 'no mfaRequired': in17.body?.mfaRequired !== true, 'HTTP 200 + session': hasSession(in17), 'logout 204': out17.status === 204 }, `POST /api/auth/login ${got(in17, 200)} mfaRequired=${in17.body?.mfaRequired ?? false}; POST /api/auth/logout ${got(out17, 204)}`);

    record('18 CI', null, 'manual — CI on main after the MFA PRs are merged');
  } catch (error) {
    if (!(error instanceof Stop)) {
      say(`Unexpected error: ${error instanceof Error ? error.message : error}`);
      results.push({ step: 'run', ok: false });
    }
  } finally {
    await finish();
  }

  const failed = results.filter((r) => r.ok === false).length;
  const passed = results.filter((r) => r.ok === true).length;
  console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL / ${results.length - passed - failed} SKIP`);
  process.exitCode = failed > 0 ? 1 : 0;
}

/** Leaves the student without MFA (never touching an MFA the journey did not turn on), prints the evidence, signs out. */
async function finish() {
  console.log('');
  let endState = 'unknown';
  try {
    if (studentId && admin.token) endState = await ensureStudentWithoutMfa();
    else if (stoppedBeforeWrites) endState = 'unchanged (the journey stopped before any write)';
  } catch (error) {
    say(`CLEANUP could not check the student's MFA: ${error instanceof Error ? error.message : error}`);
  }
  try {
    if (studentId && admin.token) await printEvidence(endState);
  } catch (error) {
    say(`EVIDENCE could not be read: ${error instanceof Error ? error.message : error}`);
  }
  for (const who of [student, admin]) {
    try {
      if (who.cookie) await signOut(who);
    } catch {
      // The session ends on its own; nothing secret is left behind.
    }
  }
}

/** Reads the student's MFA as the admin and resets it when the journey left it on. Returns the end state as text. */
async function ensureStudentWithoutMfa() {
  const stateOf = async () => {
    const detail = await asAdmin('GET', `/api/users/${studentId}`);
    if (detail.status === 200 && detail.body && 'mfaEnabledAt' in detail.body) return detail.body.mfaEnabledAt === null ? 'off' : 'on';
    if (student.token) {
      const own = await call('GET', '/api/auth/mfa', { who: student });
      if (own.status === 200 && typeof own.body?.enabled === 'boolean') return own.body.enabled ? 'on' : 'off';
    }
    return 'unknown';
  };
  const before = await stateOf();
  if (before === 'off') {
    say(`CLEANUP not needed: ${student.identifier} has no two-step verification (user detail mfaEnabledAt: null)`);
    return 'WITHOUT MFA';
  }
  if (!touched) {
    say(`CLEANUP skipped: the journey changed nothing — ${student.identifier}'s two-step verification is ${before} as it was found`);
    return `${before === 'on' ? 'WITH MFA (as found — the journey refused to start)' : 'unknown'}`;
  }
  const reset = await asAdmin('POST', `/api/users/${studentId}/mfa/reset`, { reason: 'accept-mfa cleanup: the journey stopped with two-step verification on' });
  // API-212 answers `200 { reset: false }` (no write, no event) when nothing was on — the answer to rely on when the detail lacks the field.
  const nothingToReset = reset.status === 200 && reset.body?.reset === false;
  const after = nothingToReset ? 'off' : await stateOf();
  if (after === 'off' && nothingToReset) {
    say(`CLEANUP not needed: ${student.identifier}'s two-step verification is off (POST /api/users/:id/mfa/reset 200 reset=false)`);
    return 'WITHOUT MFA';
  }
  if (after === 'off') {
    say(`CLEANUP the journey stopped with ${student.identifier}'s two-step verification ${before}: the admin reset it — POST /api/users/:id/mfa/reset ${reset.status}${is2xx(reset) ? ` reset=${reset.body?.reset} revokedSessions=${reset.body?.revokedSessions ?? '-'}` : ` (${why(reset)})`}; now off`);
    return 'WITHOUT MFA (after the cleanup reset)';
  }
  record('cleanup', false, `${student.identifier} may STILL have two-step verification on (${after}): POST /api/users/${studentId}/mfa/reset ${got(reset, 200)} — sign in as the admin and reset it from the user drawer or with that request`);
  return `STILL WITH MFA (${after}) — reset it by hand`;
}

/** The student's audit events newer than the watermark, oldest first. */
async function eventsSince(mark) {
  const items = [];
  let cursor = '';
  for (let page = 0; page < 20; page += 1) {
    const r = await asAdmin('GET', `/api/audit-logs?entityType=users&entityId=${studentId}&limit=50${cursor}`);
    if (r.status !== 200 || !Array.isArray(r.body?.items)) return { status: r.status, items };
    const fresh = r.body.items.filter((event) => mark === null || event.id > mark);
    items.push(...fresh);
    if (fresh.length < r.body.items.length || !r.body.nextCursor) break;
    cursor = `&cursor=${encodeURIComponent(r.body.nextCursor)}`;
  }
  return { status: 200, items: items.reverse() };
}

async function printEvidence(endState) {
  say(`EVIDENCE ${student.identifier}: user id ${studentId}`);
  if (auditMark === undefined) {
    say(stoppedBeforeWrites && !touched ? 'EVIDENCE audit events: none listed — the journey stopped before its first step' : 'EVIDENCE audit events: not read (the watermark could not be taken at the start)');
  } else {
    const { status, items } = await eventsSince(auditMark);
    if (status !== 200) say(`EVIDENCE audit events: GET /api/audit-logs -> ${status}`);
    else {
      const named = (event) => {
        const m = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
        const via = m.via !== undefined ? `via ${m.via}` : event.action === 'auth.login.succeeded' ? 'password only' : null;
        const parts = [via,m.stage !== undefined ? `stage ${m.stage}` : null, m.revokedSessions !== undefined ? `revokedSessions ${m.revokedSessions}` : null, m.recoveryCodesLeft !== undefined ? `recoveryCodesLeft ${m.recoveryCodesLeft}` : null].filter(Boolean);
        return parts.length ? `${event.action} (${parts.join(', ')})` : event.action;
      };
      const isJourneyEvent = (event) => event.action.startsWith('auth.mfa.') || event.action === 'users.mfa.reset' || event.action.startsWith('auth.login.');
      const journey = items.filter(isJourneyEvent);
      const others = {};
      for (const event of items.filter((e) => !isJourneyEvent(e))) others[event.action] = (others[event.action] ?? 0) + 1;
      say(`EVIDENCE audit events of the student newer than the start (${items.length}, oldest first):`);
      for (const event of journey) say(`EVIDENCE   ${event.id}  ${named(event)}`);
      const rest = Object.entries(others).map(([action, n]) => `${action} ×${n}`).join(', ');
      if (rest) say(`EVIDENCE   other events: ${rest}`);
      // No secret, code, recovery code, challenge or token in any metadata, and no metadata key matching /token/i.
      const leaks = [];
      for (const event of items) {
        for (const leaf of leaves(event.metadata)) {
          if (leaf.key !== undefined && /token/i.test(leaf.key)) leaks.push(`${event.action}: key "${leaf.key}"`);
          if (typeof leaf.value === 'string' && (sentCodes.has(leaf.value) || [...hidden].some((value) => leaf.value.includes(value)))) leaks.push(`${event.action}: a secret value`);
        }
      }
      if (leaks.length > 0) record('audit metadata', false, `secret material in the audit metadata: ${leaks.join('; ')}`);
      else say('EVIDENCE   metadata: no secret, TOTP code, recovery code, challenge or token in any of them, no key matching /token/i');
    }
  }
  say(`EVIDENCE ${student.identifier} ends ${endState}`);
}
