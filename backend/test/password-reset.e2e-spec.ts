// TEST-023 (self-service part) — MOD-03-T05: the public "forgot my password"
// route POST /api/account/password-reset/request (API-021) with the feature
// ENABLED, which the default environment refuses (AUTH_SELF_SERVICE_RESET_ENABLED
// is false until launch task LR-01). The variables are set here before the
// application is imported; the schema also demands a transport other than
// `none`, so `log` is declared and then replaced by a recording fake so that
// no token reaches the test output. Skipped when no database is reachable.
import { createHash } from 'node:crypto';
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
import type {
  MailDeliveryResult,
  MailMessage,
  MailTransport,
} from '../src/mail/mail.transport.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
process.env['AUTH_SELF_SERVICE_RESET_ENABLED'] = 'true';
process.env['MAIL_TRANSPORT'] = 'log';

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } =
  await import('../src/app.setup.js');
const { MAIL_TRANSPORT } = await import('../src/mail/mail.transport.js');

const DATABASE_URL =
  process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const NEW_PASSWORD = `Chosen-After-Mail-${RUN}`;
const REQUEST = '/api/account/password-reset/request';
const LINK_TOKEN = /\/reset-password\/([A-Za-z0-9_-]{43})/;

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      connectionTimeoutMillis: 3000,
    }),
  });
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

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until the condition holds (the request route does its work after answering). */
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await sleep(50);
  }
  throw new Error(`condition not met within ${timeoutMs} ms`);
}

/** Records every message instead of sending it. */
class RecordingTransport implements MailTransport {
  readonly name = 'recording';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.sent.push(message);
    return {
      transport: this.name,
      status: 'sent',
      messageId: `rec-${this.sent.length}`,
    };
  }
}

describe.skipIf(!available)(
  'MOD-03-T05 self-service password reset, enabled (e2e, TEST-023)',
  () => {
    let app: NestExpressApplication;
    let prisma: PrismaClient;
    const mailbox = new RecordingTransport();
    const createdUserIds: string[] = [];
    const fx: Record<string, string> = {};

    const email = (name: string) => `${name}-${RUN}@example.test`;
    const api = () => request(app.getHttpServer());
    const requestReset = (identifier: string) =>
      api().post(REQUEST).send({ identifier });
    const resetRows = (userId: string) =>
      prisma.verificationToken.findMany({
        where: { userId, purpose: 'password_reset' },
        orderBy: { createdAt: 'asc' },
      });
    const events = (entityId: string, action: string) =>
      prisma.auditLog.findMany({
        where: { entityId, action },
        orderBy: { createdAt: 'asc' },
      });

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MAIL_TRANSPORT)
        .useValue(mailbox)
        .compile();
      app =
        moduleRef.createNestApplication<NestExpressApplication>(
          APP_CREATE_OPTIONS,
        );
      configureApp(app);
      await app.init();
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: DATABASE_URL! }),
      });
      const passwords = new PasswordService();
      const passwordHash = await passwords.hash(PASSWORD);

      const holder = await prisma.user.create({
        data: {
          email: email('holder'),
          fullName: 'Fixture Holder',
          displayName: 'Holder',
          locale: 'en',
          passwordHash,
          status: 'active',
        },
        select: { id: true },
      });
      const usernameOnly = await prisma.user.create({
        data: {
          username: `fixture_nomail_${RUN}`,
          fullName: 'Fixture No Mail',
          passwordHash,
          status: 'active',
        },
        select: { id: true },
      });
      const suspended = await prisma.user.create({
        data: {
          email: email('suspended'),
          fullName: 'Fixture Suspended',
          passwordHash,
          status: 'suspended',
        },
        select: { id: true },
      });
      fx['holder'] = holder.id;
      fx['usernameOnly'] = usernameOnly.id;
      fx['suspended'] = suspended.id;
      createdUserIds.push(holder.id, usernameOnly.id, suspended.id);
    });

    afterAll(async () => {
      if (createdUserIds.length > 0)
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.$disconnect();
      await app.close();
    });

    it('answers 202 for unknown and known identifiers alike; only the known active account gets a token and a mail (AC 4)', async () => {
      const unknown = await requestReset(`nobody-${RUN}@example.test`).expect(
        202,
      );
      expect(unknown.body).toEqual({});
      await sleep(200);
      expect(mailbox.sent).toHaveLength(0);

      // Case and surrounding whitespace do not matter, as for login.
      const known = await requestReset(
        `  ${email('holder').toUpperCase()} `,
      ).expect(202);
      expect(known.body).toEqual({});
      await waitFor(async () => (await resetRows(fx['holder']!)).length === 1);
      await waitFor(async () => mailbox.sent.length === 1);

      const [row] = await resetRows(fx['holder']!);
      expect(row).toMatchObject({
        purpose: 'password_reset',
        consumedAt: null,
        metadata: { via: 'self_service', issuedBy: null },
      });
      const message = mailbox.sent[0]!;
      expect(message).toMatchObject({
        kind: 'password_reset',
        to: email('holder'),
        locale: 'en',
      });
      const token = LINK_TOKEN.exec(message.text)?.[1];
      expect(token).toBeDefined();
      expect(sha256(token!)).toBe(row!.tokenHash);

      // Nothing is forced on the account: the person asked for the reset themself.
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: fx['holder']! },
        select: { mustChangePassword: true },
      });
      expect(user.mustChangePassword).toBe(false);
      const issued = await events(fx['holder']!, 'users.password_reset.issued');
      expect(issued).toHaveLength(1);
      expect(issued[0]).toMatchObject({
        actorUserId: null,
        entityType: 'users',
        metadata: { resetId: row!.id, via: 'self_service', superseded: 0 },
      });
      expect(JSON.stringify(issued)).not.toContain(token);
      fx['holderToken'] = token!;
    });

    it('the mailed link completes the reset and signs the person in', async () => {
      const res = await api()
        .post(`/api/account/password-reset/${fx['holderToken']}/confirm`)
        .send({ newPassword: NEW_PASSWORD })
        .expect(200);
      expect(res.body.user).toMatchObject({
        id: fx['holder'],
        status: 'active',
        mustChangePassword: false,
      });
      await api()
        .get('/api/auth/me')
        .set({ Authorization: `Bearer ${res.body.accessToken}` })
        .expect(200);
      await api()
        .post('/api/auth/login')
        .send({ identifier: email('holder'), password: NEW_PASSWORD })
        .expect(200);
      expect((await resetRows(fx['holder']!))[0]!.consumedAt).not.toBeNull();
      expect(await events(fx['holder']!, 'auth.password.reset')).toHaveLength(
        1,
      );
    });

    it('a username-only or suspended account gets neither a token nor a mail', async () => {
      const sentBefore = mailbox.sent.length;
      await requestReset(`fixture_nomail_${RUN}`).expect(202);
      await requestReset(email('suspended')).expect(202);
      await sleep(300);
      expect(await resetRows(fx['usernameOnly']!)).toEqual([]);
      expect(await resetRows(fx['suspended']!)).toEqual([]);
      expect(mailbox.sent).toHaveLength(sentBefore);
    });

    it('rate-limits requests per (IP, identifier) and validates the body', async () => {
      await api().post(REQUEST).send({}).expect(400);
      await api().post(REQUEST).send({ identifier: 'x', extra: 1 }).expect(400);

      const ghost = `ghost-${RUN}@example.test`;
      for (let attempt = 0; attempt < 5; attempt += 1)
        await requestReset(ghost).expect(202);
      expect((await requestReset(ghost).expect(429)).body.code).toBe(
        'rate_limited',
      );
      // Another identifier from the same address is still served.
      await requestReset(`other-ghost-${RUN}@example.test`).expect(202);
    });
  },
);
