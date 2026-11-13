// MOD-18 acceptance journey (roadmap 4m.8) — run by the owner through accept-mod18.ps1.
// Reads ONE JSON object from stdin:
//   { academyUrl, platformUrl | null, platformPort, allowRemote, superAdmin: { email, fullName, password } }
// and walks WF-16 against the owner's DEVELOPMENT servers: the academy API that already runs (npm run start:dev)
// and the platform API — started here from backend/dist/platform/main.js on 127.0.0.1:<platformPort> and stopped
// at the end, also on a failure (or an already running one when platformUrl is given).
//
//   platform health + readiness → the first super admin (npm run platform:bootstrap-admin — only when this script
//   starts the platform; a no-op once a super admin exists) → sign-in and /me → a plan → an academy whose origin is
//   the dev academy → its primary domain → a trial subscription → activate → probe (ready, schema current, not
//   behind) → the fleet → the history → suspend and activate again → refresh and logout.
//
// Evidence rows stay in the dev PLATFORM database on purpose (like the earlier ACC-* rows): the plan and the academy
// `acc-mod18-<yyMMddHHmm>` with its domain, subscription and health check, and their platform audit events.
// Nothing is written to the academy. Never prints the password, a token or a cookie; the password reaches the
// bootstrap command through its environment only (never a command line). Never calls process.exit() after
// reading stdin (Windows libuv assertion). Prints PASS / FAIL / SKIP lines, EVIDENCE lines and a RESULT line.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

class Stop extends Error {}

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLATFORM_ENTRY = join(BACKEND, 'dist', 'platform', 'main.js');
const USER_AGENT = 'ACC-MOD18 owner journey';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let raw = Buffer.concat(chunks).toString('utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const input = JSON.parse(raw);
const ADMIN = input.superAdmin ?? {};
const academyUrl = String(input.academyUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const platformPort = Number(input.platformPort) || 3100;
const givenPlatformUrl = input.platformUrl ? String(input.platformUrl).replace(/\/+$/, '') : null;
let platformUrl = givenPlatformUrl ?? `http://127.0.0.1:${platformPort}`;

const results = [];
function record(step, ok, evidence) {
  results.push({ step, ok });
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${step}: ${evidence}`);
}
const evidence = (text) => console.log(`EVIDENCE ${text}`);
/** Replaces the password wherever a child process could have echoed it (it never should). */
const mask = (text) => (ADMIN.password ? String(text).split(ADMIN.password).join('***') : String(text));
const tail = (text, n = 12) => mask(text).trim().split(/\r?\n/).slice(-n).join('\n');
/** The server's reason for a refusal: the stable `code` and the message(s). */
const why = (r) => [r.body?.code, Array.isArray(r.body?.message) ? r.body.message.join('; ') : r.body?.message].filter(Boolean).join(': ') || `HTTP ${r.status}`;
/** `<status>` plus the server's reason when it is not the expected one. */
const got = (r, expected) => `${r.status}${r.status === expected ? '' : ` (${why(r)})`}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** One HTTP call; `cookie` is a `pla_refresh` value. Never follows a redirect. */
async function call(base, method, path, { token, body, cookie } = {}) {
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = `pla_refresh=${cookie}`;
  const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const line = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('pla_refresh='));
  const refresh = line ? line.split(';')[0].slice('pla_refresh='.length) || null : undefined;
  return { status: res.status, body: json, refresh };
}
const academy = (method, path, options) => call(academyUrl, method, path, options);
const platform = (method, path, options) => call(platformUrl, method, path, options);

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

// ------------------------------------------------------------------ the platform child process
let child = null;
let childOutput = '';
let childExit = null;

function startPlatform() {
  // The child reads backend/.env.local, backend/.env and ../.env like npm run start:platform; it never gets the password.
  child = spawn(process.execPath, [PLATFORM_ENTRY], {
    cwd: BACKEND,
    env: { ...process.env, PLATFORM_PORT: String(platformPort) },
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
  console.log('INFO  the platform API started by this script was stopped');
}

process.once('SIGINT', () => {
  if (child && !childExit) child.kill();
  process.exitCode = 130;
});

// ------------------------------------------------------------------ the journey
async function journey() {
  // 1. The academy API is up, ready and current.
  let live;
  try {
    live = await academy('GET', '/api/health');
  } catch (error) {
    record('1 academy API', false, `cannot reach ${academyUrl} (${error?.cause?.code ?? error?.message ?? 'network error'}) — start it first: in backend/ run "npm run start:dev", wait until it listens on :3000, then run this script again`);
    throw new Stop();
  }
  const ready = await academy('GET', '/api/health/ready');
  const academySchema = ready.body?.checks?.schema;
  const academyOk = live.status === 200 && live.body?.service === 'articode-academy-api' && ready.status === 200 && academySchema?.status === 'current';
  record('1 academy API', academyOk, `GET /api/health ${got(live, 200)} ${live.body?.service ?? '-'} ${live.body?.version ?? '-'}; GET /api/health/ready ${got(ready, 200)} schema=${academySchema?.status ?? '-'} applied=${academySchema?.applied ?? '-'}`);
  if (!academyOk) {
    if (academySchema?.status === 'outdated') console.log('      the academy database lacks migrations: in backend/ run "npm run prisma:deploy", restart the dev server, then run this script again');
    throw new Stop();
  }

  // 2. The platform API: started here, or the one named by -PlatformUrl.
  if (givenPlatformUrl) {
    record('2 platform API', null, `using the running platform API at ${platformUrl} (-PlatformUrl)`);
  } else {
    if (!existsSync(PLATFORM_ENTRY)) {
      record('2 platform API', false, 'backend/dist/platform/main.js is missing — it is compiled by "npm run start:dev" (the whole backend) or by "npm run build" (never while start:dev runs); compile, then run this script again');
      throw new Stop();
    }
    if (await portBusy(platformPort)) {
      record('2 platform API', false, `something already listens on 127.0.0.1:${platformPort} — stop it, or if it is your platform API rerun with -PlatformUrl http://127.0.0.1:${platformPort} (or choose another port with -PlatformPort)`);
      throw new Stop();
    }
    startPlatform();
    const deadline = Date.now() + 45_000;
    let up = false;
    while (Date.now() < deadline && !childExit) {
      try {
        if ((await platform('GET', '/api/health')).status === 200) {
          up = true;
          break;
        }
      } catch {
        // not listening yet
      }
      await sleep(500);
    }
    if (!up) {
      record('2 platform API', false, childExit ? `node dist/platform/main.js exited (code ${childExit.code}) — its last lines:\n${tail(childOutput)}` : `no answer on ${platformUrl} within 45 s — its last lines:\n${tail(childOutput)}`);
      throw new Stop();
    }
    record('2 platform API', true, `started node dist/platform/main.js (pid ${child.pid}) on ${platformUrl}`);
  }

  // 3. Platform liveness and readiness (its own database and migrations).
  const pLive = await platform('GET', '/api/health');
  const pReady = await platform('GET', '/api/health/ready');
  const platformSchema = pReady.body?.checks?.schema;
  const platformOk = pLive.status === 200 && pLive.body?.service === 'articode-platform-api' && pReady.status === 200 && platformSchema?.status === 'current';
  record('3 platform health + readiness', platformOk, `GET /api/health ${got(pLive, 200)} ${pLive.body?.service ?? '-'} ${pLive.body?.version ?? '-'} (${pLive.body?.environment ?? '-'}); GET /api/health/ready ${got(pReady, 200)} schema=${platformSchema?.status ?? '-'} applied=${platformSchema?.applied ?? '-'}`);
  if (!platformOk) {
    if (platformSchema?.status === 'outdated') console.log('      the platform database lacks migrations: in backend/ run "npm run platform:deploy", then run this script again');
    throw new Stop();
  }

  // 4. The first super admin — only when this script started the platform (the same env files as the command).
  if (givenPlatformUrl) {
    record('4 first super admin', null, 'not attempted with -PlatformUrl — the account must already exist on that platform');
  } else {
    const boot = spawnSync('npm run --silent platform:bootstrap-admin', {
      cwd: BACKEND,
      shell: true,
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PLATFORM_BOOTSTRAP_EMAIL: ADMIN.email,
        PLATFORM_BOOTSTRAP_FULL_NAME: ADMIN.fullName || 'Platform Owner',
        PLATFORM_BOOTSTRAP_PASSWORD: ADMIN.password,
      },
    });
    const out = mask(`${boot.stdout ?? ''}${boot.stderr ?? ''}`).trim();
    const first = out.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
    if (boot.status === 0 && /First platform super admin created/.test(out)) record('4 first super admin', true, `created by npm run platform:bootstrap-admin — ${first}`);
    else if (boot.status === 0 && /Already bootstrapped/.test(out)) record('4 first super admin', true, `already exists — ${first}`);
    else if (boot.status === 2 && /super admin already exists/.test(out)) record('4 first super admin', null, 'another platform super admin already exists (the bootstrap refused and changed nothing) — signing in with the account you typed');
    else {
      record('4 first super admin', false, `npm run platform:bootstrap-admin exited ${boot.status ?? boot.error?.code ?? '?'}: ${tail(out, 4) || '(no output)'}`);
      throw new Stop();
    }
  }

  // 5. Sign in and read the account: the role is super_admin.
  const login = await platform('POST', '/api/auth/login', { body: { identifier: ADMIN.email, password: ADMIN.password } });
  if (login.status !== 200 || !login.body?.accessToken) {
    record('5 sign-in', false, `POST /api/auth/login ${got(login, 200)} — stopping (an account locks after 5 failed attempts in 15 minutes)`);
    throw new Stop();
  }
  const token = login.body.accessToken;
  let cookie = login.refresh;
  const me = await platform('GET', '/api/auth/me', { token });
  const isSuper = me.status === 200 && me.body?.role === 'super_admin' && me.body?.status === 'active';
  record('5 sign-in + /me', isSuper && typeof cookie === 'string', `login 200 (access token for ${login.body.expiresIn} s, pla_refresh cookie ${cookie ? 'set' : 'MISSING'}); GET /api/auth/me ${got(me, 200)} role=${me.body?.role ?? '-'} status=${me.body?.status ?? '-'}`);
  if (!isSuper) {
    if (me.body?.role === 'support') console.log('      this account is a support operator; the journey writes, so sign in with a super admin');
    throw new Stop();
  }
  evidence(`platform super admin ${me.body.email} (${me.body.id})`);

  // yyMMddHHmm — the evidence suffix of the plan, the academy and the domain.
  const stamp = new Date().toISOString().slice(2, 16).replace(/[-T:]/g, '');
  const key = `acc-mod18-${stamp}`;
  const hostname = `acc-mod18-${stamp}.example.test`;
  const academyHost = new URL(academyUrl);
  const origin = `${academyHost.protocol}//${academyHost.hostname === '127.0.0.1' ? 'localhost' : academyHost.hostname}${academyHost.port ? `:${academyHost.port}` : ''}`;

  // 6. A plan.
  const plan = await platform('POST', '/api/plans', { token, body: { key, name: { ar: 'خطة قبول MOD-18', en: 'MOD-18 acceptance plan' }, limits: { students: 100, storageGb: null } } });
  record('6 plan', plan.status === 201 && plan.body?.key === key, `POST /api/plans ${got(plan, 201)} key=${plan.body?.key ?? key}${plan.body?.code === 'plan_key_taken' ? ' — the script ran less than a minute ago: wait a minute and run it again' : ''}`);
  if (plan.status !== 201) throw new Stop();

  // 7. The academy, pointed at the dev academy API.
  const created = await platform('POST', '/api/academies', { token, body: { slug: key, name: { ar: 'أكاديمية قبول MOD-18', en: 'MOD-18 acceptance academy' }, origin, notes: 'MOD-18 acceptance evidence (accept-mod18)' } });
  const academyId = created.body?.id;
  record('7 academy', created.status === 201 && created.body?.status === 'provisioning' && created.body?.origin === origin, `POST /api/academies ${got(created, 201)} slug=${created.body?.slug ?? key} status=${created.body?.status ?? '-'} origin=${created.body?.origin ?? origin}`);
  if (created.status !== 201) throw new Stop();

  // 8. Its primary domain.
  const domain = await platform('POST', `/api/academies/${academyId}/domains`, { token, body: { hostname, kind: 'platform_subdomain', isPrimary: true } });
  record('8 primary domain', domain.status === 201 && domain.body?.primaryDomain === hostname, `POST /api/academies/:id/domains ${got(domain, 201)} primary=${domain.body?.primaryDomain ?? '-'}`);

  // 9. A trial subscription on the plan (started a minute ago, trial for 14 days).
  const subscription = await platform('POST', `/api/academies/${academyId}/subscriptions`, {
    token,
    body: { planId: plan.body.id, status: 'trial', startsAt: new Date(Date.now() - 60_000).toISOString(), trialEndsAt: new Date(Date.now() + 14 * 86_400_000).toISOString() },
  });
  record('9 trial subscription', subscription.status === 201 && subscription.body?.status === 'trial', `POST /api/academies/:id/subscriptions ${got(subscription, 201)} status=${subscription.body?.status ?? '-'} plan=${subscription.body?.plan?.key ?? '-'} trialEndsAt=${subscription.body?.trialEndsAt ?? '-'}`);

  // 10. Activate.
  const activated = await platform('POST', `/api/academies/${academyId}/status`, { token, body: { action: 'activate' } });
  record('10 activate', activated.status === 200 && activated.body?.status === 'active', `POST /api/academies/:id/status { activate } ${got(activated, 200)} status=${activated.body?.status ?? '-'}`);
  if (activated.status !== 200) throw new Stop();

  // 11. Probe: the platform asks the academy's two public endpoints.
  const probe = await platform('POST', `/api/academies/${academyId}/probe`, { token });
  const p = probe.body ?? {};
  record(
    '11 probe',
    probe.status === 201 && p.outcome === 'ready' && p.schemaStatus === 'current' && p.behind === false,
    `POST /api/academies/:id/probe ${got(probe, 201)} outcome=${p.outcome ?? '-'} http=${p.httpStatus ?? '-'} schema=${p.schemaStatus ?? '-'} behind=${p.behind ?? '-'}${p.reason ? ` reason=${p.reason}` : ''}${p.error ? ` error=${p.error}` : ''}`,
  );
  evidence(`the academy at ${origin}: api version ${p.apiVersion ?? '-'} (${p.environment ?? '-'}), schema applied ${p.schemaApplied ?? '-'} / expected ${p.schemaExpected ?? '-'}, latency ${p.latencyMs ?? '-'} ms, check ${p.id ?? '-'}`);

  // 12. The fleet lists it.
  const fleet = await platform('GET', '/api/fleet', { token });
  const item = (fleet.body?.items ?? []).find((i) => i.academy?.id === academyId);
  record('12 fleet', fleet.status === 200 && item?.latest?.outcome === 'ready' && item?.behind === false && item?.stale === false, `GET /api/fleet ${got(fleet, 200)} academy listed=${item ? 'yes' : 'NO'} latest=${item?.latest?.outcome ?? '-'} behind=${item?.behind ?? '-'} stale=${item?.stale ?? '-'}; fleet counts ${JSON.stringify(fleet.body?.counts ?? {})}; newest academy migration ${fleet.body?.newestAcademyMigration ?? '-'}`);

  // 13. The history holds the probe.
  const history = await platform('GET', `/api/academies/${academyId}/health-checks`, { token });
  const found = (history.body?.items ?? []).some((c) => c.id === p.id);
  record('13 health-check history', history.status === 200 && found, `GET /api/academies/:id/health-checks ${got(history, 200)} items=${(history.body?.items ?? []).length} the probe ${found ? 'found' : 'MISSING'}`);

  // 14. The state machine: suspend, then activate again.
  const suspended = await platform('POST', `/api/academies/${academyId}/status`, { token, body: { action: 'suspend', reason: 'MOD-18 acceptance: the state machine' } });
  const reactivated = suspended.status === 200 ? await platform('POST', `/api/academies/${academyId}/status`, { token, body: { action: 'activate' } }) : { status: 0, body: null };
  record('14 suspend + activate', suspended.body?.status === 'suspended' && reactivated.body?.status === 'active', `suspend ${got(suspended, 200)} → ${suspended.body?.status ?? '-'}; activate ${got(reactivated, 200)} → ${reactivated.body?.status ?? '-'}`);

  // 15. The academy detail as the registry shows it now.
  const detail = await platform('GET', `/api/academies/${academyId}`, { token });
  const d = detail.body ?? {};
  record('15 academy detail', detail.status === 200 && d.status === 'active' && d.primaryDomain === hostname && d.currentSubscription?.status === 'trial' && d.latestHealthCheck?.outcome === 'ready', `GET /api/academies/:id ${got(detail, 200)} status=${d.status ?? '-'} primaryDomain=${d.primaryDomain ?? '-'} subscription=${d.currentSubscription?.planKey ?? '-'}/${d.currentSubscription?.status ?? '-'} latestCheck=${d.latestHealthCheck?.outcome ?? '-'}`);

  // 16. The session: refresh rotates the cookie, logout revokes it.
  const refreshed = await platform('POST', '/api/auth/refresh', { cookie });
  const rotated = refreshed.status === 200 && typeof refreshed.refresh === 'string' && refreshed.refresh !== cookie && typeof refreshed.body?.accessToken === 'string';
  if (rotated) cookie = refreshed.refresh;
  const logout = await platform('POST', '/api/auth/logout', { cookie });
  record('16 refresh + logout', rotated && logout.status === 204, `POST /api/auth/refresh ${got(refreshed, 200)} (cookie ${rotated ? 'rotated' : 'NOT rotated'}); POST /api/auth/logout ${got(logout, 204)}`);

  record('17 CI', null, 'manual — CI on main after the task PR is merged');
  console.log(`\nEVIDENCE plan ${key} (${plan.body.id}); academy ${key} (${academyId}) origin ${origin}, domain ${hostname}, subscription ${subscription.body?.id ?? '-'} (trial), health check ${p.id ?? '-'}. The rows and their platform audit events stay in the dev platform database on purpose.`);
}

// Dev-only tooling: it signs in with a real password and writes rows, so it targets loopback servers only unless the
// launcher passes allowRemote (an explicit owner decision).
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const remote = [academyUrl, ...(givenPlatformUrl ? [givenPlatformUrl] : [])].filter((url) => {
  try {
    return !LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return true;
  }
});
if (!ADMIN.email || !ADMIN.password) {
  console.log('FAIL  input: the launcher sent no e-mail or no password — run accept-mod18.ps1');
  process.exitCode = 2;
} else if (remote.length > 0 && input.allowRemote !== true) {
  console.log(`FAIL  target: ${remote.join(', ')} is not a local server — this script runs against the development APIs only (pass -AllowRemote to the launcher to override on purpose)`);
  process.exitCode = 2;
} else {
  try {
    await journey();
  } catch (error) {
    if (!(error instanceof Stop)) {
      console.error('Unexpected error:', mask(error instanceof Error ? error.message : error));
      results.push({ step: 'run', ok: false });
    }
  } finally {
    await stopPlatform();
  }
  const failed = results.filter((r) => r.ok === false).length;
  const passed = results.filter((r) => r.ok === true).length;
  console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL / ${results.length - passed - failed} SKIP-or-manual`);
  process.exitCode = failed > 0 ? 1 : 0;
}
