// TEST-173 — LR-01-T02 (D-R78): e-mail ownership. API-165
// `POST /api/account/email-verification/request` (signed in) and API-166
// `POST /api/account/email-verification/:token/confirm` (public), plus the
// confirmation e-mail sent right after an invitation is accepted. The mail
// transport is replaced by a recording fake, so the token is read from the
// "e-mail" exactly as a person would — it never appears in a response.
// Skipped when no database is reachable.
import { createHash, randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { MailDeliveryResult, MailMessage, MailTransport } from '../src/mail/mail.transport.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');
const { MAIL_TRANSPORT } = await import('../src/mail/mail.transport.js');
const { NoopMailTransport } = await import('../src/mail/noop.transport.js');

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const REQUEST = '/api/account/email-verification/request';
const confirmPath = (token: string) => `/api/account/email-verification/${token}/confirm`;
const LINK_TOKEN = /\/verify-email\/([A-Za-z0-9_-]{43})/;

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Records every message instead of sending it. */
class RecordingTransport implements MailTransport {
  readonly name = 'recording';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.sent.push(message);
    return { transport: this.name, status: 'sent', messageId: `rec-${this.sent.length}` };
  }
}

describe.skipIf(!available)('LR-01-T02 e-mail verification (e2e, TEST-173)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const mailbox = new RecordingTransport();
  const createdUserIds: string[] = [];
  const fx: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const events = (entityId: string, action: string) =>
    prisma.auditLog.findMany({ where: { entityId, action }, orderBy: { id: 'asc' } });
  const verifiedAt = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } })).emailVerifiedAt;

  /** The token of the latest confirmation e-mail sent to this address. */
  function mailedToken(address: string): string {
    const message = [...mailbox.sent].reverse().find((sent) => sent.to === address && sent.kind === 'email_verification');
    const token = message ? LINK_TOKEN.exec(message.text)?.[1] : undefined;
    if (!token) throw new Error('no confirmation e-mail for this address');
    return token;
  }

  async function signIn(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  async function createUser(name: string, data: { email?: string | null; username?: string; status?: 'active' | 'invited'; verified?: boolean }) {
    const passwordHash = data.status === 'invited' ? null : await new PasswordService().hash(PASSWORD);
    const user = await prisma.user.create({
      data: {
        email: data.email === undefined ? email(name) : data.email,
        username: data.username ?? null,
        fullName: `Fixture ${name}`,
        locale: 'en',
        passwordHash,
        status: data.status ?? 'active',
        emailVerifiedAt: data.verified ? new Date() : null,
      },
      select: { id: true },
    });
    fx[name] = user.id;
    createdUserIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(mailbox)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  }, 30_000);

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('AC1: the request mails a link that only the e-mail carries; the link confirms the address once', async () => {
    const id = await createUser('holder', {});
    const access = await signIn(email('holder'));

    const res = await api().post(REQUEST).set('Authorization', `Bearer ${access}`).expect(202);
    expect(Object.keys(res.body).sort()).toEqual(['delivery', 'expiresAt']);
    expect(res.body.delivery).toEqual({ transport: 'recording', status: 'sent' });
    const token = mailedToken(email('holder'));
    expect(JSON.stringify(res.body)).not.toContain(token);

    const issued = await events(id, 'users.email_verification.issued');
    expect(issued).toHaveLength(1);
    expect(issued[0]!.actorUserId).toBe(id);
    expect(issued[0]!.metadata).toMatchObject({ via: 'self', superseded: 0 });
    expect(JSON.stringify(issued[0]!.metadata)).not.toContain(token);
    expect(await events(id, 'mail.delivery.sent')).toHaveLength(1);
    expect(await verifiedAt(id)).toBeNull();

    const row = await prisma.verificationToken.findUniqueOrThrow({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
      select: { purpose: true, metadata: true },
    });
    expect(row).toEqual({ purpose: 'email_verification', metadata: { email: email('holder'), via: 'self' } });

    const confirmed = await api().post(confirmPath(token)).expect(200);
    expect(Object.keys(confirmed.body)).toEqual(['emailVerifiedAt']);
    expect((await verifiedAt(id))?.toISOString()).toBe(confirmed.body.emailVerifiedAt);
    const verified = await events(id, 'users.email.verified');
    expect(verified).toHaveLength(1);
    expect(verified[0]!.actorUserId).toBe(id);

    expect((await api().post(confirmPath(token)).expect(404)).body.code).toBe('verification_invalid');
    const again = await api().post(REQUEST).set('Authorization', `Bearer ${access}`).expect(409);
    expect(again.body).toMatchObject({ code: 'email_already_verified', emailVerifiedAt: confirmed.body.emailVerifiedAt });
    expect(await events(id, 'users.email.verified')).toHaveLength(1);
  });

  it('AC2: a newer request retires the older link; a changed address, an expired or a malformed token confirm nothing', async () => {
    const id = await createUser('changer', {});
    const access = await signIn(email('changer'));
    await api().post(REQUEST).set('Authorization', `Bearer ${access}`).expect(202);
    const first = mailedToken(email('changer'));
    await api().post(REQUEST).set('Authorization', `Bearer ${access}`).expect(202);
    const second = mailedToken(email('changer'));
    expect(second).not.toBe(first);
    expect((await events(id, 'users.email_verification.issued'))[1]!.metadata).toMatchObject({ superseded: 1 });
    expect((await api().post(confirmPath(first)).expect(404)).body.code).toBe('verification_invalid');

    // The address changes after the e-mail left: the link no longer proves anything.
    await prisma.user.update({ where: { id }, data: { email: email('changer-new') } });
    expect((await api().post(confirmPath(second)).expect(404)).body.code).toBe('verification_invalid');
    expect(await verifiedAt(id)).toBeNull();

    const late = await createUser('late', {});
    // Sign in before building the next request: supertest closes the shared server when its last request ends.
    const lateAccess = await signIn(email('late'));
    await api().post(REQUEST).set('Authorization', `Bearer ${lateAccess}`).expect(202);
    const lateToken = mailedToken(email('late'));
    await prisma.verificationToken.updateMany({
      where: { userId: late, purpose: 'email_verification', consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await api().post(confirmPath(lateToken)).expect(410);
    expect(expired.body.code).toBe('verification_expired');
    expect(typeof expired.body.expiredAt).toBe('string');
    expect(await verifiedAt(late)).toBeNull();

    expect((await api().post(confirmPath('not-a-token')).expect(404)).body.code).toBe('verification_invalid');
    expect((await api().post(confirmPath('a'.repeat(43))).expect(404)).body.code).toBe('verification_invalid');
    expect(await events(id, 'users.email.verified')).toHaveLength(0);
  });

  it('AC3: refused without a session, without an address, past three a quarter-hour, and without a transport', async () => {
    await api().post(REQUEST).expect(401);

    await createUser('nomail', { email: null, username: `fixture_nomail_${RUN}` });
    const noMailAccess = await signIn(`fixture_nomail_${RUN}`);
    const noMail = await api().post(REQUEST).set('Authorization', `Bearer ${noMailAccess}`).expect(422);
    expect(noMail.body.code).toBe('email_missing');

    const limited = await createUser('limited', {});
    const access = await signIn(email('limited'));
    for (let i = 0; i < 3; i++) await api().post(REQUEST).set('Authorization', `Bearer ${access}`).expect(202);
    expect((await api().post(REQUEST).set('Authorization', `Bearer ${access}`).expect(429)).body.code).toBe('rate_limited');
    expect(await events(limited, 'users.email_verification.issued')).toHaveLength(3);

    const offline = await createUser('offline', {});
    const offlineRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(new NoopMailTransport())
      .compile();
    const offlineApp = offlineRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(offlineApp);
    await offlineApp.init();
    try {
      // Signed in through this second app: without JWT_SECRET (CI) each app
      // instance has its own ephemeral key, so the first app's token is refused here.
      const login = await request(offlineApp.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: email('offline'), password: PASSWORD })
        .expect(200);
      const offlineAccess = login.body.accessToken as string;
      const unavailable = await request(offlineApp.getHttpServer())
        .post(REQUEST)
        .set('Authorization', `Bearer ${offlineAccess}`)
        .expect(503);
      expect(unavailable.body.code).toBe('mail_unavailable');
    } finally {
      await offlineApp.close();
    }
    expect(await events(offline, 'users.email_verification.issued')).toHaveLength(0);
  }, 30_000);

  it('AC4 (LR-01 AC2): accepting an invitation by its manual link leaves the address unconfirmed and mails a confirmation right away', async () => {
    const id = await createUser('invitee', { status: 'invited' });
    const raw = randomBytes(32).toString('base64url');
    await prisma.verificationToken.create({
      data: {
        userId: id,
        purpose: 'invitation',
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        metadata: { roles: [], issuedBy: null },
      },
    });

    await api().post(`/api/account/invitations/${raw}/accept`).send({ password: PASSWORD }).expect(200);
    expect(await verifiedAt(id)).toBeNull();

    const deadline = Date.now() + 5000;
    while (!mailbox.sent.some((sent) => sent.to === email('invitee') && sent.kind === 'email_verification')) {
      if (Date.now() > deadline) throw new Error('no confirmation e-mail after the invitation');
      await sleep(50);
    }
    const issued = await events(id, 'users.email_verification.issued');
    expect(issued).toHaveLength(1);
    expect(issued[0]!.metadata).toMatchObject({ via: 'invitation', superseded: 0 });

    await api().post(confirmPath(mailedToken(email('invitee')))).expect(200);
    expect(await verifiedAt(id)).not.toBeNull();
  });
});
