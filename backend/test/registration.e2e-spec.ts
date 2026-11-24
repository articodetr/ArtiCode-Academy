// PORTAL-03 (#207, the agreed contract v2) — student self-registration through the API:
// `POST /api/account/register`, `GET /api/account/register/:token` and
// `POST /api/account/register/:token/complete`, with the sign-in, enrollment and
// admin-status rules around them. `MAIL_TRANSPORT=log` is declared before the
// application is imported (the routes are open only with a mail transport) and
// the transport is replaced by a recording fake, so every link is read from the
// "e-mail" exactly as a person would. `TRUST_PROXY=1` lets each test speak from
// its own `X-Forwarded-For` address, so the per-IP limits of one test never
// spend another's. The academy's `settings.selfRegistration` is switched on for
// the suite and restored afterwards. Skipped when no database is reachable.
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import type { MailDeliveryResult, MailMessage, MailTransport } from '../src/mail/mail.transport.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
const PREVIOUS_ENV = { MAIL_TRANSPORT: process.env['MAIL_TRANSPORT'], TRUST_PROXY: process.env['TRUST_PROXY'] };
process.env['MAIL_TRANSPORT'] = 'log';
process.env['TRUST_PROXY'] = '1';

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');
const { MAIL_TRANSPORT } = await import('../src/mail/mail.transport.js');
const { RegistrationService, REGISTRATION_MAIL_WINDOW_MS, countRegistrationMails } = await import('../src/account/registration.service.js');
const { COMPLETE_CLIENT_LIMIT, COMPLETE_IP_LIMIT, REGISTER_CLIENT_LIMIT, REGISTER_IP_LIMIT } = await import('../src/account/registration.throttle.js');

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PREFIX = `R${RUN.toUpperCase()}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const CHOSEN = `Chosen-After-Link-${RUN}`;
const REGISTER = '/api/account/register';
const linkPath = (token: string) => `/api/account/register/${token}`;
const completePath = (token: string) => `/api/account/register/${token}/complete`;
const LINK_TOKEN = /\/register\/complete\/([A-Za-z0-9_-]{43})/;

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

/** Records every message instead of sending it. */
class RecordingTransport implements MailTransport {
  readonly name = 'recording';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.sent.push(message);
    return { transport: this.name, status: 'sent', messageId: `rec-${this.sent.length}` };
  }
}

describe.skipIf(!available)('PORTAL-03 student self-registration (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let registration: InstanceType<typeof RegistrationService>;
  let originalSettings: Prisma.JsonValue = null;
  let defaultLocale = 'ar';
  let markId = '00000000-0000-0000-0000-000000000000';
  let ipCounter = 0;
  let dailyMailLimit = 0;
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
  const register = (body: unknown, ip = freshIp()) => api().post(REGISTER).set(from(ip)).send(body as object);
  const settle = () => registration.whenIdle();
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
        emailVerifiedAt: true,
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

  /** The token of the latest registration e-mail sent to this address. */
  function mailedToken(address: string): string {
    const message = [...mailbox.sent].reverse().find((sent) => sent.to === address && sent.kind === 'registration');
    const token = message ? LINK_TOKEN.exec(message.text)?.[1] : undefined;
    if (!token) throw new Error('no registration e-mail for this address');
    return token;
  }

  async function settingsWith(enabled: boolean | null): Promise<void> {
    const base = originalSettings && typeof originalSettings === 'object' && !Array.isArray(originalSettings) ? originalSettings : {};
    await prisma.academy.updateMany({ data: { settings: { ...base, selfRegistration: { enabled } } as Prisma.InputJsonValue } });
  }

  async function fixtureUser(name: string, data: Partial<Prisma.UserUncheckedCreateInput> = {}, roleIds: string[] = []): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Fixture ${name}`,
        passwordHash: await new PasswordService().hash(PASSWORD),
        status: 'active',
        ...data,
        roles: roleIds.length > 0 ? { create: roleIds.map((roleId) => ({ roleId })) } : undefined,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  /** Not async on purpose: the returned supertest Test keeps its `.expect()` chain. */
  function signIn(identifier: string, password = PASSWORD) {
    return api().post('/api/auth/login').set(from(freshIp())).send({ identifier, password });
  }

  /** Registers a new address and completes it; returns the new account's id. */
  async function registeredStudent(name: string): Promise<string> {
    await register({ fullName: `Student ${name}`, email: email(name) }).expect(202);
    await settle();
    await api().post(completePath(mailedToken(email(name)))).set(from(freshIp())).send({ password: CHOSEN }).expect(200);
    return (await accountOf(email(name)))!.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MAIL_TRANSPORT).useValue(mailbox).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    registration = app.get(RegistrationService);
    // The academy's daily budget counts the stored rows of earlier runs against this database too: lifted for the
    // suite, and lowered on purpose by the test that proves it.
    dailyMailLimit = registration.limits.mailsPerDay;
    registration.limits.mailsPerDay = Number.MAX_SAFE_INTEGER;
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    const academy = await prisma.academy.findFirstOrThrow({ select: { settings: true, defaultLocale: true } });
    originalSettings = academy.settings;
    defaultLocale = academy.defaultLocale;
    await settingsWith(true);
    markId = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? markId;

    const deactivator = await prisma.role.create({
      data: { key: `test_reg_${RUN}`, label: { ar: 'دور اختبار التسجيل' }, permissions: { create: ['users.read', 'users.deactivate'].map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(deactivator.id);
    await fixtureUser('deactivator', {}, [deactivator.id]);
    tokens['deactivator'] = (await signIn(email('deactivator')).expect(200)).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    try {
      if (registration) {
        await settle();
        registration.limits.mailsPerDay = dailyMailLimit;
      }
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

  it('is closed on all three routes while the academy does not take registrations — before any token or body is read', async () => {
    await settingsWith(false);
    try {
      const token = randomToken();
      for (const res of [
        await register({ fullName: 'Closed Visitor', email: email('closed') }),
        await api().get(linkPath(token)).set(from(freshIp())),
        await api().post(completePath(token)).set(from(freshIp())).send({ password: CHOSEN }),
        await api().get(linkPath('not-a-token')).set(from(freshIp())),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('registration_disabled');
      }
      await settle();
      expect(await accountOf(email('closed'))).toBeNull();
      expect(mailsTo(email('closed'))).toHaveLength(0);
    } finally {
      await settingsWith(true);
    }
  });

  it('answers registration_invalid with the problems under each field and the unexpected fields in unknown', async () => {
    const cases: Array<[unknown, Record<string, string[]>, string[]]> = [
      [{}, { fullName: ['required'], email: ['required'] }, []],
      [{ fullName: ' ', email: '  ' }, { fullName: ['blank'], email: ['blank'] }, []],
      [{ fullName: 'S', email: 'nope', locale: 'fr' }, { fullName: ['too_short'], email: ['invalid_format'], locale: ['invalid_format'] }, []],
      [{ fullName: 'x'.repeat(201), email: `${'a'.repeat(320)}@x.test` }, { fullName: ['too_long'], email: ['too_long'] }, []],
      [{ fullName: 'Sara Visitor', email: email('invalid'), password: 'Chosen-1234567', roleKeys: ['academy_admin'] }, {}, ['password', 'roleKeys']],
      [[], { fullName: ['required'], email: ['required'] }, []],
    ];
    for (const [body, fields, unknown] of cases) {
      const res = await register(body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body).toMatchObject({ statusCode: 400, code: 'registration_invalid', fields, unknown });
      expect(Object.keys(res.body.fields).sort()).toEqual(Object.keys(fields).sort());
    }
    await settle();
    expect(await accountOf(email('invalid'))).toBeNull();
  });

  it('creates a pending student for a new address after a bodiless 202, and mails a link that carries nothing typed', async () => {
    const address = email('newcomer');
    const typedName = `Visitor ${RUN} Newcomer`;
    const res = await register({ fullName: `  ${typedName} `, email: `  ${address.toUpperCase()} `, locale: 'en' }).expect(202);
    expect(res.text).toBe('');
    await settle();

    const account = await accountOf(address);
    expect(account).toMatchObject({ status: 'pending', fullName: typedName, locale: 'en', passwordHash: null, passwordChangedAt: null, emailVerifiedAt: null });
    expect(account!.roles.map((grant) => grant.role.key)).toEqual(['student']);
    expect(account!.studentProfile).not.toBeNull();

    const rows = await tokenRows(account!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'email_verification', metadata: { via: 'self_registration', email: address }, consumedAt: null });
    const mails = mailsTo(address);
    expect(mails.map((message) => [message.kind, message.locale])).toEqual([['registration', 'en']]);
    const token = mailedToken(address);
    expect(sha256(token)).toBe(rows[0]!.tokenHash);
    for (const part of [mails[0]!.subject, mails[0]!.text, mails[0]!.html]) expect(part).not.toContain(typedName);

    const preview = await api().get(linkPath(token)).set(from(freshIp())).expect(200);
    expect(preview.body).toEqual({ fullName: typedName, maskedEmail: `n***@example.test`, expiresAt: expect.any(String) });
    expect(new Date(preview.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const trail = await events(account!.id);
    expect(trail.map((event) => event.action)).toEqual(['users.self_registered', 'mail.delivery.sent']);
    expect(trail[0]).toMatchObject({ actorUserId: null, metadata: { via: 'email' } });
    expect(trail[1]!.metadata).toMatchObject({ kind: 'registration' });
  });

  it('re-sends a fresh link to a pending account, retiring the older one and keeping the stored name', async () => {
    const address = email('again');
    await register({ fullName: 'First Name', email: address }).expect(202);
    await settle();
    const first = mailedToken(address);
    await register({ fullName: 'Second Name', email: address, locale: 'tr' }).expect(202);
    await settle();
    const second = mailedToken(address);
    expect(second).not.toBe(first);

    const account = await accountOf(address);
    expect(account).toMatchObject({ status: 'pending', fullName: 'First Name', locale: null });
    const rows = await tokenRows(account!.id);
    expect(rows.map((row) => row.consumedAt === null)).toEqual([false, true]);
    expect(mailsTo(address).map((message) => [message.kind, message.locale])).toEqual([
      ['registration', defaultLocale],
      ['registration', 'tr'],
    ]);

    // The replaced link is dead everywhere; the new one previews.
    expect((await api().get(linkPath(first)).set(from(freshIp())).expect(404)).body.code).toBe('registration_link_invalid');
    expect((await api().post(completePath(first)).set(from(freshIp())).send({ password: CHOSEN }).expect(404)).body.code).toBe('registration_link_invalid');
    expect((await api().get(linkPath(second)).set(from(freshIp())).expect(200)).body.fullName).toBe('First Name');
    expect((await events(account!.id)).filter((event) => event.action === 'users.self_registered')).toHaveLength(1);

    // At most three links per 15 minutes for one account: the fourth request answers 202 and sends nothing.
    await register({ fullName: 'Third', email: address }).expect(202);
    await settle();
    expect(mailsTo(address)).toHaveLength(3);
    await register({ fullName: 'Fourth', email: address }).expect(202);
    await settle();
    expect(mailsTo(address)).toHaveLength(3);
    expect((await tokenRows(account!.id)).filter((row) => row.consumedAt === null)).toHaveLength(1);
  });

  it('tells an address that already has an account so, changing nothing; a soft-deleted account gets nothing', async () => {
    const holderId = await fixtureUser('holder', { locale: 'ar', emailVerifiedAt: new Date() });
    const before = await accountOf(email('holder'));
    await register({ fullName: 'Someone Else', email: email('holder'), locale: 'en' }).expect(202);
    const deletedId = await fixtureUser('gone', { status: 'archived', deletedAt: new Date() });
    await register({ fullName: 'Someone Else', email: email('gone') }).expect(202);
    const invitedId = await fixtureUser('invitee', { status: 'invited', passwordHash: null });
    await register({ fullName: 'Someone Else', email: email('invitee') }).expect(202);
    await settle();

    const notice = mailsTo(email('holder'));
    expect(notice.map((message) => [message.kind, message.locale])).toEqual([['registration_existing', 'en']]);
    expect(notice[0]!.text).toMatch(/\/login/);
    expect(notice[0]!.text).not.toMatch(LINK_TOKEN);
    expect(notice[0]!.text).not.toContain('Someone Else');
    expect(await accountOf(email('holder'))).toEqual(before);
    expect(await tokenRows(holderId)).toEqual([]);
    expect((await events(holderId)).map((event) => [event.action, event.actorUserId, event.metadata])).toEqual([
      ['users.self_registration.notice_sent', null, null],
      ['mail.delivery.sent', null, expect.objectContaining({ kind: 'registration_existing' })],
    ]);

    // At most one notice per account per 24 hours, whatever the IP: the next requests answer 202 and send nothing.
    await register({ fullName: 'Someone Else', email: email('holder') }).expect(202);
    await register({ fullName: 'Someone Else', email: email('holder'), locale: 'ar' }).expect(202);
    await settle();
    expect(mailsTo(email('holder'))).toHaveLength(1);
    expect((await events(holderId)).filter((event) => event.action === 'users.self_registration.notice_sent')).toHaveLength(1);
    expect(await accountOf(email('holder'))).toEqual(before);

    expect(mailsTo(email('gone'))).toEqual([]);
    expect(await tokenRows(deletedId)).toEqual([]);
    expect(await events(deletedId)).toEqual([]);

    expect(mailsTo(email('invitee')).map((message) => message.kind)).toEqual(['registration_existing']);
    expect(await tokenRows(invitedId)).toEqual([]);
  });

  it('ends two registrations of one new address at once with one account and one open link', async () => {
    const address = email('twice');
    const ip = freshIp();
    const [a, b] = await Promise.all([register({ fullName: 'Twin One', email: address }, ip), register({ fullName: 'Twin Two', email: address }, ip)]);
    expect([a.status, b.status]).toEqual([202, 202]);
    await settle();
    expect(await prisma.user.count({ where: { email: address } })).toBe(1);
    const account = await accountOf(address);
    expect((await tokenRows(account!.id)).filter((row) => row.consumedAt === null)).toHaveLength(1);
    expect((await events(account!.id)).filter((event) => event.action === 'users.self_registered')).toHaveLength(1);
    // The open link is the one in the latest e-mail.
    await api().get(linkPath(mailedToken(address))).set(from(freshIp())).expect(200);
  });

  it('refuses sign-in before the link is opened exactly like an unknown address, and accepts it after completion', async () => {
    const address = email('signin');
    await register({ fullName: 'Sign In Student', email: address }).expect(202);
    await settle();
    const account = await accountOf(address);

    const pending = await signIn(address, CHOSEN).expect(401);
    const unknown = await signIn(email('nobody-at-all'), CHOSEN).expect(401);
    expect(pending.body).toEqual(unknown.body);
    expect(pending.body.code).toBe('invalid_credentials');
    expect((await events(account!.id)).map((event) => event.action)).toEqual(['users.self_registered', 'mail.delivery.sent']);

    const token = mailedToken(address);
    const done = await api().post(completePath(token)).set(from(freshIp())).send({ password: CHOSEN, fullName: '  Renamed Student ' }).expect(200);
    expect(done.body).toEqual({ completed: true });
    expect(done.headers['set-cookie']).toBeUndefined();

    const active = await accountOf(address);
    expect(active).toMatchObject({ status: 'active', fullName: 'Renamed Student' });
    expect(active!.passwordHash).not.toBeNull();
    expect(active!.passwordChangedAt).toBeInstanceOf(Date);
    expect(active!.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await tokenRows(account!.id)).every((row) => row.consumedAt !== null)).toBe(true);

    // Used: the link is dead on both routes.
    expect((await api().get(linkPath(token)).set(from(freshIp())).expect(404)).body.code).toBe('registration_link_invalid');
    expect((await api().post(completePath(token)).set(from(freshIp())).send({ password: CHOSEN }).expect(404)).body.code).toBe('registration_link_invalid');

    const session = await signIn(address, CHOSEN).expect(200);
    expect(session.body.user).toMatchObject({ id: account!.id, roles: ['student'], status: 'active' });

    const trail = await events(account!.id);
    expect(trail.map((event) => event.action)).toEqual(['users.self_registered', 'mail.delivery.sent', 'users.self_registration.completed', 'auth.login.succeeded']);
    expect(trail[2]).toMatchObject({ actorUserId: account!.id, metadata: { verificationId: expect.any(String), nameChanged: true } });
  });

  it('checks a completion: the link before the body, then the body, then the invitation password policy', async () => {
    const address = email('policy');
    await register({ fullName: 'Policy Student', email: address }).expect(202);
    await settle();
    const token = mailedToken(address);
    const post = (body: unknown, path = completePath(token)) => api().post(path).set(from(freshIp())).send(body as object);

    const weak = await post({ password: 'short' }).expect(400);
    expect(weak.body).toMatchObject({ code: 'password_weak', problems: expect.arrayContaining(['at least 10 characters']) });
    expect((await post({ password: ' '.repeat(12) }).expect(400)).body.code).toBe('password_weak');
    expect((await post({}).expect(400)).body).toMatchObject({ code: 'registration_invalid', fields: { password: ['required'] }, unknown: [] });
    expect((await post({ password: CHOSEN, fullName: 'X', email: 'other@example.test' }).expect(400)).body).toMatchObject({
      code: 'registration_invalid',
      fields: { fullName: ['too_short'] },
      unknown: ['email'],
    });
    // A dead link wins over a bad body.
    expect((await post({}, completePath(randomToken())).expect(404)).body.code).toBe('registration_link_invalid');
    expect((await post({}, completePath('malformed')).expect(404)).body.code).toBe('registration_link_invalid');
    // Nothing was written by the refusals.
    expect(await accountOf(address)).toMatchObject({ status: 'pending', passwordHash: null });
    expect((await tokenRows((await accountOf(address))!.id)).filter((row) => row.consumedAt === null)).toHaveLength(1);
  });

  it('answers 410 for an expired link and never accepts another kind of token, nor a registration token at API-166', async () => {
    // An expired registration link of a pending account.
    const pendingId = await fixtureUser('expired', { status: 'pending', passwordHash: null });
    const expired = randomToken();
    await prisma.verificationToken.create({
      data: { userId: pendingId, purpose: 'email_verification', tokenHash: sha256(expired), expiresAt: new Date(Date.now() - 60_000), metadata: { via: 'self_registration', email: email('expired') } },
    });
    const gone = await api().get(linkPath(expired)).set(from(freshIp())).expect(410);
    expect(gone.body).toMatchObject({ code: 'registration_link_expired', expiresAt: expect.any(String) });
    expect((await api().post(completePath(expired)).set(from(freshIp())).send({ password: CHOSEN }).expect(410)).body.code).toBe('registration_link_expired');

    // An API-165 confirmation token (via self) and an invitation of a pending account are not registration links.
    const confirmation = randomToken();
    const invitation = randomToken();
    await prisma.verificationToken.createMany({
      data: [
        { userId: pendingId, purpose: 'email_verification', tokenHash: sha256(confirmation), expiresAt: new Date(Date.now() + 3_600_000), metadata: { via: 'self', email: email('expired') } },
        { userId: pendingId, purpose: 'invitation', tokenHash: sha256(invitation), expiresAt: new Date(Date.now() + 3_600_000), metadata: { via: 'self_registration', email: email('expired') } },
      ],
    });
    for (const token of [confirmation, invitation]) {
      expect((await api().get(linkPath(token)).set(from(freshIp())).expect(404)).body.code).toBe('registration_link_invalid');
      expect((await api().post(completePath(token)).set(from(freshIp())).send({ password: CHOSEN }).expect(404)).body.code).toBe('registration_link_invalid');
    }

    // A live registration link is refused by the e-mail confirmation route (API-166).
    const address = email('crosskind');
    await register({ fullName: 'Cross Kind', email: address }).expect(202);
    await settle();
    const token = mailedToken(address);
    const crossed = await api().post(`/api/account/email-verification/${token}/confirm`).set(from(freshIp())).expect(404);
    expect(crossed.body.code).toBe('verification_invalid');
    await api().get(linkPath(token)).set(from(freshIp())).expect(200);
    expect(await accountOf(address)).toMatchObject({ status: 'pending', emailVerifiedAt: null });
  });

  it('lets the new student enroll in a free open self-service class and see it in «my classes»', async () => {
    const studentId = await registeredStudent('learner');
    const course = await prisma.course.create({ data: { code: `${PREFIX}-FREE`, name: { ar: 'دورة مجانية' }, status: 'published' }, select: { id: true } });
    const klass = await prisma.class.create({
      data: { courseId: course.id, code: `${PREFIX}-FREE-A`, name: { ar: 'فصل مفتوح' }, capacity: 5, status: 'open', selfEnrollment: true },
      select: { id: true },
    });
    const session = await signIn(email('learner'), CHOSEN).expect(200);
    const bearer = { Authorization: `Bearer ${session.body.accessToken as string}` };

    const enrolled = await api().post(`/api/catalog/classes/${klass.id}/enroll`).set(bearer).send({}).expect(201);
    expect(enrolled.body).toMatchObject({ outcome: 'enrolled', enrollment: { status: 'active' } });
    const mine = await api().get('/api/me/classes').set(bearer).expect(200);
    expect((mine.body.items as Array<{ class: { id: string } }>).map((item) => item.class.id)).toContain(klass.id);
    expect(await prisma.enrollment.count({ where: { studentUserId: studentId, classId: klass.id, status: 'active' } })).toBe(1);
  });

  it('refuses the admin activate on a self-registered pending account: only delete applies', async () => {
    const address = email('waiting');
    await register({ fullName: 'Waiting Student', email: address }).expect(202);
    await settle();
    const account = await accountOf(address);
    const res = await api()
      .post(`/api/users/${account!.id}/status`)
      .set({ Authorization: `Bearer ${tokens['deactivator']}` })
      .send({ action: 'activate' })
      .expect(409);
    expect(res.body).toMatchObject({ code: 'invalid_transition', from: 'pending', action: 'activate', allowed: ['delete'] });
    expect(await accountOf(address)).toMatchObject({ status: 'pending' });
    expect((await events(account!.id)).map((event) => event.action)).toEqual(['users.self_registered', 'mail.delivery.sent']);
  });

  it('answers a password sign-in of an active account without a password (Google only) exactly like an unknown address, recording nothing', async () => {
    const googleOnlyId = await fixtureUser('google-only', { status: 'active', passwordHash: null, emailVerifiedAt: new Date() });
    const lockedId = await fixtureUser('google-locked', { status: 'active', passwordHash: null, lockedUntil: new Date(Date.now() + 600_000) });
    const unknown = await signIn(email('nobody-google'), CHOSEN).expect(401);
    for (const name of ['google-only', 'google-locked']) {
      const res = await signIn(email(name), CHOSEN).expect(401);
      expect(res.body, name).toEqual(unknown.body);
      expect(res.body.code, name).toBe('invalid_credentials');
    }
    expect(await events(googleOnlyId)).toEqual([]);
    expect(await events(lockedId)).toEqual([]);
    // An invited account keeps its own answer.
    await fixtureUser('still-invited', { status: 'invited', passwordHash: null });
    expect((await signIn(email('still-invited'), CHOSEN).expect(403)).body.code).toBe('account_not_activated');
  });

  it('removes a self-registered account awaiting its holder for good on the admin delete, freeing the address', async () => {
    const address = email('squatted');
    await register({ fullName: 'Squatted Address', email: address }).expect(202);
    await settle();
    const squatted = (await accountOf(address))!;
    const res = await api()
      .delete(`/api/users/${squatted.id}`)
      .set({ Authorization: `Bearer ${tokens['deactivator']}` })
      .send({ reason: 'Not ours' })
      .expect(200);
    expect(res.body).toMatchObject({ id: squatted.id, status: 'archived', awaitingRegistration: false });
    expect(res.body.deletedAt).toEqual(expect.any(String));
    expect(await prisma.user.findUnique({ where: { id: squatted.id } })).toBeNull();
    expect(await tokenRows(squatted.id)).toEqual([]);
    expect(await prisma.userRole.count({ where: { userId: squatted.id } })).toBe(0);
    const trail = await events(squatted.id);
    expect(trail.map((event) => event.action)).toEqual(['users.self_registered', 'mail.delivery.sent', 'users.deleted']);
    expect(trail[2]!.metadata).toEqual({ action: 'delete', from: 'pending', to: null, reason: 'Not ours', hard: true });

    // The address is free: the owner registers it and gets a link of their own.
    await register({ fullName: 'Real Owner', email: address }).expect(202);
    await settle();
    const fresh = (await accountOf(address))!;
    expect(fresh.id).not.toBe(squatted.id);
    expect(fresh).toMatchObject({ status: 'pending', fullName: 'Real Owner' });
    await api().get(linkPath(mailedToken(address))).set(from(freshIp())).expect(200);
  });

  it('stops every registration e-mail past the academy daily budget, creating nothing, and still answers 202', async () => {
    const used = await countRegistrationMails(prisma, new Date(Date.now() - REGISTRATION_MAIL_WINDOW_MS));
    const holderId = await fixtureUser('budget-holder', { emailVerifiedAt: new Date() });
    registration.limits.mailsPerDay = used + 1;
    try {
      // The last e-mail of the budget goes out ...
      await register({ fullName: 'Within Budget', email: email('budget-in') }).expect(202);
      await settle();
      expect(mailsTo(email('budget-in')).map((message) => message.kind)).toEqual(['registration']);
      // ... and nothing after it: no account, no link, no notice, no event.
      await register({ fullName: 'Past Budget', email: email('budget-out') }).expect(202);
      await register({ fullName: 'Past Budget', email: email('budget-holder') }).expect(202);
      await register({ fullName: 'Within Budget', email: email('budget-in') }).expect(202);
      await settle();
      expect(await accountOf(email('budget-out'))).toBeNull();
      expect(mailsTo(email('budget-out'))).toEqual([]);
      expect(mailsTo(email('budget-holder'))).toEqual([]);
      expect(await events(holderId)).toEqual([]);
      expect(mailsTo(email('budget-in'))).toHaveLength(1);
      expect(await tokenRows((await accountOf(email('budget-in')))!.id)).toHaveLength(1);
    } finally {
      registration.limits.mailsPerDay = Number.MAX_SAFE_INTEGER;
    }
    // With the budget back, the same address is registered as usual.
    await register({ fullName: 'Past Budget', email: email('budget-out') }).expect(202);
    await settle();
    expect(await accountOf(email('budget-out'))).toMatchObject({ status: 'pending' });
  });

  it(`limits a registration to ${REGISTER_CLIENT_LIMIT} per 15 minutes per (IP, e-mail) and ${REGISTER_IP_LIMIT} per hour per IP, a completion to ${COMPLETE_CLIENT_LIMIT} per 15 minutes per (IP, link) and ${COMPLETE_IP_LIMIT} per IP`, async () => {
    const ip = freshIp();
    const address = email('limited');
    for (let attempt = 1; attempt <= REGISTER_CLIENT_LIMIT; attempt += 1) await register({ fullName: 'Limited', email: address }, ip).expect(202);
    const sixth = await register({ fullName: 'Limited', email: address }, ip).expect(429);
    expect(sixth.body.code).toBe('rate_limited');
    expect(sixth.headers['retry-after-login']).toBeDefined();
    // Another address from the same IP still passes the per-(IP, e-mail) limit.
    await register({ fullName: 'Limited', email: email('limited-other') }, ip).expect(202);

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
      await api().post(completePath(guessed)).set(from(completer)).send({ password: CHOSEN }).expect(404);
    }
    const retried = await api().post(completePath(guessed)).set(from(completer)).send({ password: CHOSEN }).expect(429);
    expect(retried.body.code).toBe('rate_limited');
    expect(retried.headers['retry-after-login']).toBeDefined();
    await api().post(completePath(randomToken())).set(from(completer)).send({ password: CHOSEN }).expect(404);

    // Many links from one IP: refused at the per-IP ceiling.
    const sprayer = freshIp();
    for (let attempt = 1; attempt <= COMPLETE_IP_LIMIT; attempt += 1) {
      await api().post(completePath(randomToken())).set(from(sprayer)).send({ password: CHOSEN }).expect(404);
    }
    const sprayed = await api().post(completePath(randomToken())).set(from(sprayer)).send({ password: CHOSEN }).expect(429);
    expect(sprayed.body.code).toBe('rate_limited');
    expect(sprayed.headers['retry-after-register_ip']).toBeDefined();
    await settle();
  }, 120_000);

  it('never puts a token, an address or a name in the audit metadata of the suite', async () => {
    await settle();
    const created = await prisma.user.findMany({ where: { email: { endsWith: `-${RUN}@example.test` } }, select: { id: true } });
    const trail = await prisma.auditLog.findMany({ where: { id: { gt: markId }, entityId: { in: created.map((row) => row.id) } }, select: { action: true, metadata: true } });
    expect(trail.length).toBeGreaterThan(0);
    const text = JSON.stringify(trail);
    expect(text).not.toMatch(/@example\.test/);
    expect(text).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(text).not.toMatch(/Student|Visitor|Limited|Twin|Squatted|Owner|Budget/);
    for (const event of trail) {
      for (const key of Object.keys((event.metadata ?? {}) as Record<string, unknown>)) expect(key).not.toMatch(/token|hash|password|email/i);
    }
  });

  it('lists the three routes in the OpenAPI document', async () => {
    const server = app.getHttpServer() as { listening: boolean; address(): AddressInfo };
    if (!server.listening) await app.listen(0, '127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/docs-json`);
    expect(res.ok).toBe(true);
    const doc = (await res.json()) as { paths: Record<string, Record<string, { responses: Record<string, unknown>; requestBody?: unknown }>> };
    expect(doc.paths['/api/account/register']?.['post']?.responses).toHaveProperty('202');
    expect(JSON.stringify(doc.paths['/api/account/register']?.['post']?.requestBody)).toContain('#/components/schemas/RegisterDto');
    expect(doc.paths['/api/account/register/{token}']?.['get']?.responses).toHaveProperty('200');
    expect(doc.paths['/api/account/register/{token}/complete']?.['post']?.responses).toHaveProperty('200');
    expect(JSON.stringify(doc.paths['/api/account/register/{token}/complete']?.['post']?.requestBody)).toContain(
      '#/components/schemas/CompleteRegistrationDto',
    );
  });
});
