// PORTAL-03/04 (#207) — student self-registration through the API. `POST /api/account/register` is the DIRECT
// registration: it creates an ACTIVE student account (address not confirmed) and signs the visitor in at once — no
// e-mail, no link, no approval. `GET /api/account/register/:token` and `POST /api/account/register/:token/complete`
// are LEGACY: they complete the pending accounts the earlier e-mailed flow left behind, which this suite creates as
// Prisma fixtures (the registration no longer does). The mail transport stays `none` (vitest.config.e2e.ts) — the
// routes are open without one — and the transport provider is replaced by a recording fake anyway, so any e-mail the
// routes tried to send would be seen. `TRUST_PROXY=1` lets each test speak from its own `X-Forwarded-For` address,
// so the per-IP limits of one test never spend another's. The academy's `settings.selfRegistration` is switched on
// for the suite and restored afterwards. Skipped when no database is reachable.
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import type { MailDeliveryResult, MailMessage, MailTransport } from '../src/mail/mail.transport.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
const PREVIOUS_ENV = { TRUST_PROXY: process.env['TRUST_PROXY'] };
process.env['TRUST_PROXY'] = '1';

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');
const { MAIL_TRANSPORT } = await import('../src/mail/mail.transport.js');
const { REGISTRATION_PASSWORD_ATTEMPTS } = await import('../src/account/registration.service.js');
const { COMPLETE_CLIENT_LIMIT, COMPLETE_IP_LIMIT, REGISTER_CLIENT_LIMIT, REGISTER_IP_LIMIT } = await import('../src/account/registration.throttle.js');

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PREFIX = `R${RUN.toUpperCase()}`;
/** The password of the fixture accounts. */
const PASSWORD = 'Correct-Horse-Battery-9';
/** The password a visitor chooses on /register. */
const CHOSEN = `Chosen-At-Register-${RUN}`;
const OTHER = `Another-Choice-${RUN}`;
const REGISTER = '/api/account/register';
const linkPath = (token: string) => `/api/account/register/${token}`;
const completePath = (token: string) => `/api/account/register/${token}/complete`;

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 3000 }) });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const passwords = new PasswordService();

/** Records every message instead of sending it. */
class RecordingTransport implements MailTransport {
  readonly name = 'recording';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.sent.push(message);
    return { transport: this.name, status: 'sent', messageId: `rec-${this.sent.length}` };
  }
}

function refreshCookieOf(res: SupertestResponse): string | undefined {
  const header = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(header) ? header : header ? [header] : [];
  return cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

/** `aca_refresh=<value>` of a response, ready for a Cookie header. */
function cookiePair(res: SupertestResponse): string {
  const line = refreshCookieOf(res);
  if (!line) throw new Error('no refresh cookie');
  return line.split(';')[0]!;
}

describe.skipIf(!available)('PORTAL-03/04 student self-registration — direct registration and the legacy completion (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let originalSettings: Prisma.JsonValue = null;
  let studentRoleId = '';
  let markId = '00000000-0000-0000-0000-000000000000';
  let ipCounter = 0;
  const mailbox = new RecordingTransport();
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  /** A fresh client address for each caller (TRUST_PROXY=1). */
  const freshIp = () => {
    ipCounter += 1;
    return `10.${77 + Math.floor(ipCounter / 65_000)}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
  };
  const from = (ip: string) => ({ 'X-Forwarded-For': ip });
  /** Any body, as sent. */
  const register = (body: unknown, ip = freshIp()) => api().post(REGISTER).set(from(ip)).send(body as object);
  /** A valid registration: the chosen password unless the fields say otherwise. */
  const registerAs = (fields: Record<string, unknown>, ip = freshIp()) => register({ password: CHOSEN, ...fields }, ip);
  const complete = (token: string, body: unknown = { password: CHOSEN }, ip = freshIp()) => api().post(completePath(token)).set(from(ip)).send(body as object);
  const accountOf = (address: string) =>
    prisma.user.findUnique({
      where: { email: address },
      select: {
        id: true,
        status: true,
        fullName: true,
        locale: true,
        passwordHash: true,
        passwordChangedAt: true,
        mustChangePassword: true,
        emailVerifiedAt: true,
        selfRegisteredAt: true,
        failedLoginCount: true,
        deletedAt: true,
        updatedAt: true,
        roles: { select: { role: { select: { key: true } } } },
        studentProfile: { select: { userId: true } },
      },
    });
  const tokenRows = (userId: string) =>
    prisma.verificationToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { id: true, purpose: true, tokenHash: true, metadata: true, consumedAt: true } });
  const events = (entityId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, entityId }, orderBy: { id: 'asc' }, select: { action: true, actorUserId: true, metadata: true } });
  const mailsTo = (address: string) => mailbox.sent.filter((message) => message.to === address);
  /** True when the account's stored hash is the hash of `plain`. */
  const holdsPassword = async (address: string, plain: string) => {
    const hash = (await accountOf(address))?.passwordHash;
    return typeof hash === 'string' && (await passwords.verify(hash, plain));
  };

  async function settingsWith(enabled: boolean | null): Promise<void> {
    const base = originalSettings && typeof originalSettings === 'object' && !Array.isArray(originalSettings) ? originalSettings : {};
    await prisma.academy.updateMany({ data: { settings: { ...base, selfRegistration: { enabled } } as Prisma.InputJsonValue } });
  }

  async function fixtureUser(name: string, data: Partial<Prisma.UserUncheckedCreateInput> = {}, roleIds: string[] = []): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Fixture ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        ...data,
        roles: roleIds.length > 0 ? { create: roleIds.map((roleId) => ({ roleId })) } : undefined,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  /**
   * A LEGACY pending self-registration, as the e-mailed flow (contract v3) left it: `pending`, marked
   * `self_registered_at`, the password chosen at registration, the `student` role and a profile, and one open link
   * (`{ via: 'self_registration', email }`). Returns the account id and the raw token of its link.
   */
  async function legacyPending(name: string, password = CHOSEN, expiresAt = new Date(Date.now() + 3_600_000)): Promise<{ id: string; token: string }> {
    const id = await fixtureUser(
      name,
      {
        status: 'pending',
        selfRegisteredAt: new Date(),
        passwordHash: await passwords.hash(password),
        passwordChangedAt: new Date(),
        fullName: `Legacy ${name}`,
        studentProfile: { create: {} },
      },
      [studentRoleId],
    );
    const token = randomToken();
    await prisma.verificationToken.create({
      data: { userId: id, purpose: 'email_verification', tokenHash: sha256(token), expiresAt, metadata: { via: 'self_registration', email: email(name) } },
    });
    return { id, token };
  }

  /** Not async on purpose: the returned supertest Test keeps its `.expect()` chain. */
  function signIn(identifier: string, password = PASSWORD) {
    return api().post('/api/auth/login').set(from(freshIp())).send({ identifier, password });
  }

  /** Registers a new address directly; returns the new account's id and the session the registration opened. */
  async function registeredStudent(name: string): Promise<{ id: string; accessToken: string }> {
    const res = await registerAs({ fullName: `Student ${name}`, email: email(name) }).expect(201);
    return { id: res.body.user.id as string, accessToken: res.body.accessToken as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MAIL_TRANSPORT).useValue(mailbox).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    const academy = await prisma.academy.findFirstOrThrow({ select: { settings: true } });
    originalSettings = academy.settings;
    studentRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
    await settingsWith(true);
    markId = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? markId;

    // An office account that lists users (with their contact fields) and changes their status.
    const office = await prisma.role.create({
      data: {
        key: `test_reg_${RUN}`,
        label: { ar: 'دور اختبار التسجيل' },
        permissions: { create: ['users.read', 'users.read_contact', 'users.deactivate'].map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(office.id);
    await fixtureUser('office', {}, [office.id]);
    tokens['office'] = (await signIn(email('office')).expect(200)).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const created = await prisma.user.findMany({ where: { email: { endsWith: `-${RUN}@example.test` } }, select: { id: true } });
        const userIds = [...new Set([...createdUserIds, ...created.map((row) => row.id)])];
        await prisma.enrollment.deleteMany({ where: { studentUserId: { in: userIds } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
        await prisma.academy.updateMany({ data: { settings: (originalSettings ?? Prisma.DbNull) as Prisma.InputJsonValue } });
      }
    } finally {
      await prisma?.$disconnect();
      await app?.close();
      for (const [key, value] of Object.entries(PREVIOUS_ENV)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  // ------------------------------------------------------------------ the direct registration

  it('is closed on all three routes while the academy does not take registrations — before any token or body is read', async () => {
    await settingsWith(false);
    try {
      const token = randomToken();
      for (const res of [
        await registerAs({ fullName: 'Closed Visitor', email: email('closed') }),
        await register({ fullName: 'C', email: 'nope', password: 'short' }),
        await api().get(linkPath(token)).set(from(freshIp())),
        await complete(token),
        await api().get(linkPath('not-a-token')).set(from(freshIp())),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('registration_disabled');
        expect(refreshCookieOf(res)).toBeUndefined();
      }
      expect(await accountOf(email('closed'))).toBeNull();
    } finally {
      await settingsWith(true);
    }
  });

  it('answers registration_invalid with the problems under each field and the unexpected fields in unknown — a role or a status is never accepted', async () => {
    const cases: Array<[unknown, Record<string, string[]>, string[]]> = [
      [{}, { fullName: ['required'], email: ['required'], password: ['required'] }, []],
      [{ fullName: ' ', email: '  ', password: CHOSEN }, { fullName: ['blank'], email: ['blank'] }, []],
      [
        { fullName: 'S', email: 'nope', password: 12345678901, locale: 'fr' },
        { fullName: ['too_short'], email: ['invalid_format'], password: ['invalid_format'], locale: ['invalid_format'] },
        [],
      ],
      [{ fullName: 'x'.repeat(201), email: `${'a'.repeat(320)}@x.test`, password: 'p'.repeat(129) }, { fullName: ['too_long'], email: ['too_long'], password: ['too_long'] }, []],
      [{ fullName: 'Sara Visitor', email: email('invalid'), password: CHOSEN, roleKeys: ['academy_admin'] }, {}, ['roleKeys']],
      [{ fullName: 'Sara Visitor', email: email('invalid'), password: CHOSEN, roleKeys: ['academy_admin'], status: 'active', academyId: 'x' }, {}, ['academyId', 'roleKeys', 'status']],
      // A body problem comes before the password policy.
      [{ fullName: 'S', email: email('invalid'), password: 'short' }, { fullName: ['too_short'] }, []],
      [[], { fullName: ['required'], email: ['required'], password: ['required'] }, []],
    ];
    for (const [body, fields, unknown] of cases) {
      const res = await register(body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body).toMatchObject({ statusCode: 400, code: 'registration_invalid', fields, unknown });
      expect(Object.keys(res.body.fields).sort()).toEqual(Object.keys(fields).sort());
      expect(refreshCookieOf(res)).toBeUndefined();
    }
    expect(await accountOf(email('invalid'))).toBeNull();
  });

  it('answers password_weak before looking at the address — the same answer for an address that has an account — and creates nothing', async () => {
    const holderId = await fixtureUser('weak-holder', { emailVerifiedAt: new Date() });
    for (const [address, password] of [
      [email('weak'), 'short'],
      [email('weak'), ' '.repeat(12)],
      [email('weak-holder'), 'short'],
    ] as const) {
      const res = await registerAs({ fullName: 'Weak Visitor', email: address, password }).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, code: 'password_weak', problems: expect.any(Array) });
    }
    const short = await registerAs({ fullName: 'Weak Visitor', email: email('weak'), password: 'short' }).expect(400);
    expect(short.body.problems).toEqual(expect.arrayContaining(['at least 10 characters']));
    expect(await accountOf(email('weak'))).toBeNull();
    expect(await events(holderId)).toEqual([]);
  });

  it('creates an ACTIVE student with an unconfirmed address and signs the visitor in at once (201 + session + cookie), with exactly two events and no e-mail', async () => {
    const address = email('newcomer');
    const typedName = `Visitor ${RUN} Newcomer`;
    const res = await registerAs({ fullName: `  ${typedName} `, email: `  ${address.toUpperCase()} `, locale: 'en' }).expect(201);

    // The session body of every sign-in: no password hash, refresh token or token hash ever.
    const account = await accountOf(address);
    expect(account).not.toBeNull();
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      accessToken: expect.any(String),
      expiresIn: expect.any(Number),
      user: { id: account!.id, email: address, status: 'active', roles: ['student'], emailVerifiedAt: null, mustChangePassword: false },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshToken|tokenHash|\$argon2/);
    expect(JSON.stringify(res.body)).not.toContain(CHOSEN);
    const cookie = refreshCookieOf(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);

    expect(account).toMatchObject({ status: 'active', fullName: typedName, locale: 'en', emailVerifiedAt: null, mustChangePassword: false, deletedAt: null, failedLoginCount: 0 });
    expect(account!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await holdsPassword(address, CHOSEN)).toBe(true);
    expect(account!.passwordChangedAt).toBeInstanceOf(Date);
    expect(account!.selfRegisteredAt).toBeInstanceOf(Date);
    expect(account!.roles.map((grant) => grant.role.key)).toEqual(['student']);
    expect(account!.studentProfile).not.toBeNull();
    // No confirmation link, no e-mail.
    expect(await tokenRows(account!.id)).toEqual([]);
    expect(mailsTo(address)).toEqual([]);

    // Exactly the two events: the registration (actor = the new account, as for Google) and the sign-in.
    const trail = await events(account!.id);
    expect(trail.map((event) => event.action)).toEqual(['users.self_registered', 'auth.login.succeeded']);
    expect(trail[0]).toMatchObject({ actorUserId: account!.id, metadata: { via: 'email' } });
    expect(trail[1]).toMatchObject({ actorUserId: account!.id, metadata: { via: 'self_registration' } });

    // The access token is a real session.
    const me = await api().get('/api/auth/me').set({ Authorization: `Bearer ${res.body.accessToken as string}` }).expect(200);
    expect(me.body).toMatchObject({ id: account!.id, status: 'active', emailVerifiedAt: null });

    // The refresh cookie rotates like any session's.
    const refreshed = await api().post('/api/auth/refresh').set('Cookie', cookiePair(res)).expect(200);
    expect(refreshed.body.user).toMatchObject({ id: account!.id, roles: ['student'], status: 'active' });

    // Sign out, then sign in again with the chosen password: no `email_not_verified` for a directly registered account.
    await api().post('/api/auth/logout').set('Cookie', cookiePair(refreshed)).expect(204);
    expect((await api().post('/api/auth/refresh').set('Cookie', cookiePair(refreshed))).status).toBe(401);
    const again = await signIn(address, CHOSEN).expect(200);
    expect(again.body.user).toMatchObject({ id: account!.id, status: 'active', roles: ['student'] });
    expect(refreshCookieOf(again)).toBeDefined();
    expect(mailsTo(address)).toEqual([]);
  });

  it('answers 409 email_in_use for any address an account already has — active, invited, suspended, legacy pending or soft-deleted — and changes nothing about it', async () => {
    const holderId = await fixtureUser('holder', { locale: 'ar', emailVerifiedAt: new Date() });
    const invitedId = await fixtureUser('invitee', { status: 'invited', passwordHash: null });
    const suspendedId = await fixtureUser('suspended', { status: 'suspended' });
    const deletedId = await fixtureUser('gone', { status: 'archived', deletedAt: new Date() });
    const legacy = await legacyPending('legacy-holder');
    const ids: Record<string, string> = { holder: holderId, invitee: invitedId, suspended: suspendedId, gone: deletedId, 'legacy-holder': legacy.id };

    for (const [name, id] of Object.entries(ids)) {
      const before = await accountOf(email(name));
      const tokensBefore = await tokenRows(id);
      // Upper case and padded: the address as it will be stored decides.
      const res = await registerAs({ fullName: 'Someone Else', email: ` ${email(name).toUpperCase()} `, locale: 'en', password: OTHER });
      expect(res.status, name).toBe(409);
      expect(res.body, name).toEqual({ statusCode: 409, error: 'Conflict', code: 'email_in_use', message: 'This e-mail address already has an account', field: 'email' });
      expect(refreshCookieOf(res), name).toBeUndefined();
      expect(await accountOf(email(name)), name).toEqual(before);
      expect(await tokenRows(id), name).toEqual(tokensBefore);
      expect(await events(id), name).toEqual([]);
      expect(mailsTo(email(name)), name).toEqual([]);
    }
    // The holder's password is still the old one; the visitor's never reached any account.
    expect(await holdsPassword(email('holder'), PASSWORD)).toBe(true);
    expect(await holdsPassword(email('holder'), OTHER)).toBe(false);
    expect(await holdsPassword(email('legacy-holder'), CHOSEN)).toBe(true);
    expect((await accountOf(email('invitee')))!.passwordHash).toBeNull();
    expect(await prisma.user.count({ where: { email: { in: Object.keys(ids).map(email) } } })).toBe(5);
  });

  it('ends two registrations of one new address at once with exactly one 201 and one 409, and one account', async () => {
    const address = email('twice');
    const [a, b] = await Promise.all([registerAs({ fullName: 'Twin One', email: address }), registerAs({ fullName: 'Twin Two', email: address, password: OTHER })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const [winner, loser] = a.status === 201 ? [a, b] : [b, a];
    expect(loser.body).toMatchObject({ code: 'email_in_use', field: 'email' });
    expect(refreshCookieOf(loser)).toBeUndefined();
    expect(refreshCookieOf(winner)).toBeDefined();
    expect(await prisma.user.count({ where: { email: address } })).toBe(1);
    const account = (await accountOf(address))!;
    expect(account.id).toBe(winner.body.user.id);
    expect(account.fullName).toBe(winner === a ? 'Twin One' : 'Twin Two');
    expect(await holdsPassword(address, winner === a ? CHOSEN : OTHER)).toBe(true);
    expect((await events(account.id)).map((event) => event.action)).toEqual(['users.self_registered', 'auth.login.succeeded']);
  });

  it('shows the new student to the office as an active student with an unconfirmed address', async () => {
    const student = await registeredStudent('listed');
    const res = await api()
      .get('/api/users')
      .query({ role: 'student', q: email('listed') })
      .set({ Authorization: `Bearer ${tokens['office']}` })
      .expect(200);
    const items = res.body.items as Array<{ id: string; status: string; roles: string[]; emailVerifiedAt: string | null; email: string | null }>;
    expect(items.map((item) => item.id)).toEqual([student.id]);
    expect(items[0]).toMatchObject({ status: 'active', roles: ['student'], emailVerifiedAt: null, email: email('listed') });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$argon2/);
  });

  it('lets the new student enroll in a free open self-service class with the session of the registration, and see it in «my classes»', async () => {
    const student = await registeredStudent('learner');
    const course = await prisma.course.create({ data: { code: `${PREFIX}-FREE`, name: { ar: 'دورة مجانية' }, status: 'published' }, select: { id: true } });
    const klass = await prisma.class.create({
      data: { courseId: course.id, code: `${PREFIX}-FREE-A`, name: { ar: 'فصل مفتوح' }, capacity: 5, status: 'open', selfEnrollment: true },
      select: { id: true },
    });
    const bearer = { Authorization: `Bearer ${student.accessToken}` };

    const enrolled = await api().post(`/api/catalog/classes/${klass.id}/enroll`).set(bearer).send({}).expect(201);
    expect(enrolled.body).toMatchObject({ outcome: 'enrolled', enrollment: { status: 'active' } });
    const mine = await api().get('/api/me/classes').set(bearer).expect(200);
    expect((mine.body.items as Array<{ class: { id: string } }>).map((item) => item.class.id)).toContain(klass.id);
    expect(await prisma.enrollment.count({ where: { studentUserId: student.id, classId: klass.id, status: 'active' } })).toBe(1);
    // A later sign-in with the chosen password works too.
    await signIn(email('learner'), CHOSEN).expect(200);
  });

  // ------------------------------------------------------------------ the legacy completion

  it('LEGACY — previews and completes a pending account of the e-mailed flow; before it a sign-in is email_not_verified once the password matched', async () => {
    const address = email('signin');
    const legacy = await legacyPending('signin');

    const preview = await api().get(linkPath(legacy.token)).set(from(freshIp())).expect(200);
    expect(preview.body).toEqual({ fullName: 'Legacy signin', maskedEmail: 's***@example.test', expiresAt: expect.any(String) });

    // A wrong password: the usual answer, counted like any failed sign-in — nothing about the pending state leaks.
    const wrong = await signIn(address, 'Not-The-Chosen-One').expect(401);
    const unknown = await signIn(email('nobody-at-all'), CHOSEN).expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expect((await accountOf(address))!.failedLoginCount).toBe(1);
    // The right password: the address must be confirmed first.
    const unverified = await signIn(address, CHOSEN).expect(403);
    expect(unverified.body).toMatchObject({ statusCode: 403, code: 'email_not_verified' });
    expect(refreshCookieOf(unverified)).toBeUndefined();

    const done = await complete(legacy.token).expect(200);
    expect(done.body).toMatchObject({
      tokenType: 'Bearer',
      accessToken: expect.any(String),
      user: { id: legacy.id, email: address, status: 'active', roles: ['student'], emailVerifiedAt: expect.any(String), mustChangePassword: false },
    });
    expect(JSON.stringify(done.body)).not.toMatch(/passwordHash|refreshToken|tokenHash|\$argon2/);
    expect(refreshCookieOf(done)).toMatch(/HttpOnly/i);

    const active = await accountOf(address);
    expect(active).toMatchObject({ status: 'active', failedLoginCount: 0 });
    expect(active!.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await tokenRows(legacy.id)).every((row) => row.consumedAt !== null)).toBe(true);

    // Used: the link is dead on both routes.
    expect((await api().get(linkPath(legacy.token)).set(from(freshIp())).expect(404)).body.code).toBe('registration_link_invalid');
    expect((await complete(legacy.token).expect(404)).body.code).toBe('registration_link_invalid');
    await signIn(address, CHOSEN).expect(200);

    const trail = await events(legacy.id);
    expect(trail.map((event) => event.action)).toEqual([
      'auth.login.failed',
      'auth.login.rejected',
      'users.self_registration.completed',
      'auth.login.succeeded',
      'auth.login.succeeded',
    ]);
    expect(trail[2]).toMatchObject({ actorUserId: legacy.id, metadata: { verificationId: expect.any(String) } });
    expect(trail[3]).toMatchObject({ actorUserId: legacy.id, metadata: { via: 'self_registration' } });
    expect(mailsTo(address)).toEqual([]);
  });

  it('LEGACY — checks a completion: the link before the body, then the password chosen at registration — five wrong ones retire the link', async () => {
    const address = email('policy');
    const legacy = await legacyPending('policy');

    expect((await complete(legacy.token, {}).expect(400)).body).toMatchObject({ code: 'registration_invalid', fields: { password: ['required'] }, unknown: [] });
    expect((await complete(legacy.token, { password: CHOSEN, fullName: 'Renamed', email: 'other@example.test' }).expect(400)).body).toMatchObject({
      code: 'registration_invalid',
      fields: {},
      unknown: ['email', 'fullName'],
    });
    // A dead link wins over a bad body.
    expect((await complete(randomToken(), {}).expect(404)).body.code).toBe('registration_link_invalid');
    expect((await complete('malformed', {}).expect(404)).body.code).toBe('registration_link_invalid');
    expect(await accountOf(address)).toMatchObject({ status: 'pending', emailVerifiedAt: null });

    const answers: unknown[] = [];
    for (const attempt of ['Wrong-Password-1', 'short', OTHER, CHOSEN.toUpperCase(), ` ${CHOSEN}`]) {
      const res = await complete(legacy.token, { password: attempt }).expect(400);
      expect(refreshCookieOf(res)).toBeUndefined();
      answers.push([res.body.code, res.body.attemptsLeft]);
    }
    expect(answers).toEqual([4, 3, 2, 1, 0].map((left) => ['registration_password_incorrect', left]));
    expect(REGISTRATION_PASSWORD_ATTEMPTS).toBe(5);
    // Retired: even the right password is refused now, and the preview is dead.
    expect((await complete(legacy.token).expect(404)).body.code).toBe('registration_link_invalid');
    expect((await api().get(linkPath(legacy.token)).set(from(freshIp())).expect(404)).body.code).toBe('registration_link_invalid');
    expect(await accountOf(address)).toMatchObject({ status: 'pending', emailVerifiedAt: null });
    expect((await tokenRows(legacy.id)).map((row) => [row.consumedAt !== null, (row.metadata as { attempts?: number }).attempts])).toEqual([[true, 5]]);
    expect(await events(legacy.id)).toEqual([]);
  });

  it('LEGACY — answers 410 for an expired link and never accepts another kind of token, nor a registration token at API-166', async () => {
    const expired = await legacyPending('expired', CHOSEN, new Date(Date.now() - 60_000));
    const gone = await api().get(linkPath(expired.token)).set(from(freshIp())).expect(410);
    expect(gone.body).toMatchObject({ code: 'registration_link_expired', expiresAt: expect.any(String) });
    expect((await complete(expired.token).expect(410)).body.code).toBe('registration_link_expired');

    // An API-165 confirmation token (via self) and an invitation of a pending account are not registration links.
    const confirmation = randomToken();
    const invitation = randomToken();
    await prisma.verificationToken.createMany({
      data: [
        { userId: expired.id, purpose: 'email_verification', tokenHash: sha256(confirmation), expiresAt: new Date(Date.now() + 3_600_000), metadata: { via: 'self', email: email('expired') } },
        { userId: expired.id, purpose: 'invitation', tokenHash: sha256(invitation), expiresAt: new Date(Date.now() + 3_600_000), metadata: { via: 'self_registration', email: email('expired') } },
      ],
    });
    for (const token of [confirmation, invitation]) {
      expect((await api().get(linkPath(token)).set(from(freshIp())).expect(404)).body.code).toBe('registration_link_invalid');
      expect((await complete(token).expect(404)).body.code).toBe('registration_link_invalid');
    }
    expect(await prisma.user.findUniqueOrThrow({ where: { id: expired.id }, select: { status: true } })).toEqual({ status: 'pending' });

    // A v2 registration never finished (pending, marked, no password) can never be completed: its link is dead.
    const legacyId = await fixtureUser('v2-link', { status: 'pending', passwordHash: null, selfRegisteredAt: new Date() });
    const v2 = randomToken();
    await prisma.verificationToken.create({
      data: { userId: legacyId, purpose: 'email_verification', tokenHash: sha256(v2), expiresAt: new Date(Date.now() + 3_600_000), metadata: { via: 'self_registration', email: email('v2-link') } },
    });
    expect((await api().get(linkPath(v2)).set(from(freshIp())).expect(404)).body.code).toBe('registration_link_invalid');
    expect((await complete(v2, { password: PASSWORD }).expect(404)).body.code).toBe('registration_link_invalid');

    // A live registration link is refused by the e-mail confirmation route (API-166).
    const live = await legacyPending('crosskind');
    const crossed = await api().post(`/api/account/email-verification/${live.token}/confirm`).set(from(freshIp())).expect(404);
    expect(crossed.body.code).toBe('verification_invalid');
    await api().get(linkPath(live.token)).set(from(freshIp())).expect(200);
    expect(await accountOf(email('crosskind'))).toMatchObject({ status: 'pending', emailVerifiedAt: null });
  });

  it('LEGACY — refuses the admin activate on a pending self-registered account; the admin delete removes it for good and frees the address for a direct registration', async () => {
    const address = email('squatted');
    const squatted = await legacyPending('squatted', `Squatter-Choice-${RUN}`);
    const refused = await api()
      .post(`/api/users/${squatted.id}/status`)
      .set({ Authorization: `Bearer ${tokens['office']}` })
      .send({ action: 'activate' })
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'invalid_transition', from: 'pending', action: 'activate', allowed: ['delete'] });
    expect(await accountOf(address)).toMatchObject({ status: 'pending' });
    // While it waits, the address is taken.
    expect((await registerAs({ fullName: 'Real Owner', email: address, password: OTHER }).expect(409)).body.code).toBe('email_in_use');

    const res = await api()
      .delete(`/api/users/${squatted.id}`)
      .set({ Authorization: `Bearer ${tokens['office']}` })
      .send({ reason: 'Not ours' })
      .expect(200);
    expect(res.body).toMatchObject({ id: squatted.id, status: 'archived', awaitingRegistration: false });
    expect(await prisma.user.findUnique({ where: { id: squatted.id } })).toBeNull();
    expect(await tokenRows(squatted.id)).toEqual([]);
    const trail = await events(squatted.id);
    expect(trail.map((event) => event.action)).toEqual(['users.deleted']);
    expect(trail[0]!.metadata).toEqual({ action: 'delete', from: 'pending', to: null, reason: 'Not ours', hard: true });

    // The address is free: the owner registers it directly and is signed in.
    const fresh = await registerAs({ fullName: 'Real Owner', email: address, password: OTHER }).expect(201);
    expect(fresh.body.user.id).not.toBe(squatted.id);
    expect(await accountOf(address)).toMatchObject({ status: 'active', fullName: 'Real Owner', emailVerifiedAt: null });
    expect((await signIn(address, `Squatter-Choice-${RUN}`).expect(401)).body.code).toBe('invalid_credentials');
  });

  it('answers a password sign-in of an account without a password (Google only, or a v2 registration never finished) exactly like an unknown address, recording nothing', async () => {
    const googleOnlyId = await fixtureUser('google-only', { status: 'active', passwordHash: null, emailVerifiedAt: new Date() });
    const lockedId = await fixtureUser('google-locked', { status: 'active', passwordHash: null, lockedUntil: new Date(Date.now() + 600_000) });
    const legacyId = await fixtureUser('v2-pending', { status: 'pending', passwordHash: null, selfRegisteredAt: new Date() });
    const unknown = await signIn(email('nobody-google'), CHOSEN).expect(401);
    for (const name of ['google-only', 'google-locked', 'v2-pending']) {
      const res = await signIn(email(name), CHOSEN).expect(401);
      expect(res.body, name).toEqual(unknown.body);
      expect(res.body.code, name).toBe('invalid_credentials');
    }
    expect(await events(googleOnlyId)).toEqual([]);
    expect(await events(lockedId)).toEqual([]);
    expect(await events(legacyId)).toEqual([]);
    // An invited account keeps its own answer, and so does a pending account nobody self-registered (awaiting approval).
    await fixtureUser('still-invited', { status: 'invited', passwordHash: null });
    expect((await signIn(email('still-invited'), CHOSEN).expect(403)).body.code).toBe('account_not_activated');
    await fixtureUser('awaiting-approval', { status: 'pending' });
    expect((await signIn(email('awaiting-approval')).expect(403)).body.code).toBe('account_pending');
  });

  // ------------------------------------------------------------------ limits, audit, OpenAPI

  it(`limits a registration to ${REGISTER_CLIENT_LIMIT} per 15 minutes per (IP, e-mail) and ${REGISTER_IP_LIMIT} per hour per IP, a completion to ${COMPLETE_CLIENT_LIMIT} per 15 minutes per (IP, link) and ${COMPLETE_IP_LIMIT} per IP`, async () => {
    expect(REGISTER_IP_LIMIT).toBe(60);
    const ip = freshIp();
    const address = email('limited');
    // The first creates the account; the next ones are 409 — all count.
    await registerAs({ fullName: 'Limited', email: address }, ip).expect(201);
    for (let attempt = 2; attempt <= REGISTER_CLIENT_LIMIT; attempt += 1) await registerAs({ fullName: 'Limited', email: address }, ip).expect(409);
    const sixth = await registerAs({ fullName: 'Limited', email: address }, ip).expect(429);
    expect(sixth.body.code).toBe('rate_limited');
    expect(sixth.headers['retry-after-login']).toBeDefined();
    // Another address from the same IP still passes the per-(IP, e-mail) limit.
    await registerAs({ fullName: 'Limited', email: email('limited-other') }, ip).expect(201);

    const crowded = freshIp();
    for (let attempt = 1; attempt <= REGISTER_IP_LIMIT; attempt += 1) {
      await register({ email: `crowd-${attempt}-${RUN}@example.test` }, crowded).expect(400);
    }
    const ceiling = await register({ email: `crowd-x-${RUN}@example.test` }, crowded).expect(429);
    expect(ceiling.body.code).toBe('rate_limited');
    expect(ceiling.headers['retry-after-register_ip']).toBeDefined();

    // One link retried from one IP: refused at the per-(IP, link) limit; another link from that IP still passes.
    const completer = freshIp();
    const guessed = randomToken();
    for (let attempt = 1; attempt <= COMPLETE_CLIENT_LIMIT; attempt += 1) {
      await complete(guessed, { password: CHOSEN }, completer).expect(404);
    }
    const retried = await complete(guessed, { password: CHOSEN }, completer).expect(429);
    expect(retried.body.code).toBe('rate_limited');
    expect(retried.headers['retry-after-login']).toBeDefined();
    await complete(randomToken(), { password: CHOSEN }, completer).expect(404);

    // Many links from one IP: refused at the per-IP ceiling.
    const sprayer = freshIp();
    for (let attempt = 1; attempt <= COMPLETE_IP_LIMIT; attempt += 1) {
      await complete(randomToken(), { password: CHOSEN }, sprayer).expect(404);
    }
    const sprayed = await complete(randomToken(), { password: CHOSEN }, sprayer).expect(429);
    expect(sprayed.body.code).toBe('rate_limited');
    expect(sprayed.headers['retry-after-register_ip']).toBeDefined();
  }, 120_000);

  it('never puts a token, an address, a name or a password in the audit metadata of the suite, and sends no e-mail at all', async () => {
    const created = await prisma.user.findMany({ where: { email: { endsWith: `-${RUN}@example.test` } }, select: { id: true } });
    const trail = await prisma.auditLog.findMany({ where: { id: { gt: markId }, entityId: { in: created.map((row) => row.id) } }, select: { action: true, metadata: true } });
    expect(trail.length).toBeGreaterThan(0);
    const text = JSON.stringify(trail);
    expect(text).not.toMatch(/@example\.test/);
    expect(text).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(text).not.toMatch(/Student|Visitor|Limited|Twin|Squatted|Owner|Legacy/);
    expect(text).not.toMatch(/Choice|Chosen|\$argon2/);
    for (const event of trail) {
      for (const key of Object.keys((event.metadata ?? {}) as Record<string, unknown>)) expect(key).not.toMatch(/token|hash|password|email/i);
    }
    expect(mailbox.sent.filter((message) => message.to.endsWith(`-${RUN}@example.test`))).toEqual([]);
  });

  it('lists the three routes in the OpenAPI document — the registration answering 201 with a session, and 409', async () => {
    const server = app.getHttpServer() as { listening: boolean; address(): AddressInfo };
    if (!server.listening) await app.listen(0, '127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/docs-json`);
    expect(res.ok).toBe(true);
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown>; requestBody?: unknown }>>;
      components: { schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }> };
    };
    const registration = doc.paths['/api/account/register']?.['post'];
    expect(registration?.responses).not.toHaveProperty('202');
    expect(JSON.stringify(registration?.responses['201'])).toContain('#/components/schemas/SessionResponseDto');
    expect(registration?.responses).toHaveProperty('409');
    expect(JSON.stringify(registration?.requestBody)).toContain('#/components/schemas/RegisterDto');
    expect(doc.components.schemas['RegisterDto']?.required).toEqual(expect.arrayContaining(['fullName', 'email', 'password']));
    expect(doc.paths['/api/account/register/{token}']?.['get']?.responses).toHaveProperty('200');
    const completion = doc.paths['/api/account/register/{token}/complete']?.['post'];
    expect(JSON.stringify(completion?.responses['200'])).toContain('#/components/schemas/SessionResponseDto');
    expect(JSON.stringify(completion?.responses['400'])).toContain('#/components/schemas/RegistrationPasswordIncorrectErrorDto');
    expect(JSON.stringify(completion?.requestBody)).toContain('#/components/schemas/CompleteRegistrationDto');
    expect(Object.keys(doc.components.schemas['CompleteRegistrationDto']?.properties ?? {})).toEqual(['password']);
  });
});
