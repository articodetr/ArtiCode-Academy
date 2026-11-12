// TEST-175 — MOD-12-T02: the in-process queue of notification e-mails
// (D-R82, ADR-071) with stubs for Prisma, the mail service and the config —
// what the e2e suite cannot show: the pickup at boot and the quota stop.
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.schema.js';
import type { MailService, NotificationMail } from '../mail/mail.service.js';
import type { MailDeliveryResult } from '../mail/mail.transport.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { NotificationDispatcher } from './notifications.dispatcher.js';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The query the pickup reads the left-over rows with. */
interface PickupRead {
  where: { emailStatus: string; createdAt: { gte: Date; lt: Date } };
  orderBy: unknown;
}

interface Write {
  where: { id?: string; emailStatus?: string; createdAt?: unknown };
  data: { emailStatus: string; emailFailure?: string; emailMessageId?: string | null };
}

function build(options: { nodeEnv?: string; configured?: boolean; results?: MailDeliveryResult[]; leftQueued?: string[]; recipient?: Record<string, unknown> | null } = {}) {
  const writes: Write[] = [];
  const settled = new Set<string>();
  const results = [...(options.results ?? [])];
  const recipient =
    options.recipient === undefined
      ? { email: 'reader@example.test', emailVerifiedAt: new Date(), status: 'active', deletedAt: null, locale: null, fullName: 'Reader', displayName: null }
      : options.recipient;
  const prisma = {
    isConfigured: options.configured ?? true,
    db: {
      notification: {
        // A row is found only while it is still queued, exactly like `WHERE email_status = 'queued'`.
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (settled.has(where.id) ? null : { id: where.id, title: 'A title', data: { link: '/my-lessons' }, recipientUserId: 'u1' })),
        findMany: vi.fn(async (_args: PickupRead) => (options.leftQueued ?? []).map((id) => ({ id }))),
        updateMany: vi.fn(async (args: Write) => {
          writes.push(args);
          if (args.where.id) settled.add(args.where.id);
          return { count: args.where.id ? 1 : 2 };
        }),
      },
      user: { findUnique: vi.fn(async () => recipient) },
    },
  };
  const send = vi.fn(async (_mail: NotificationMail): Promise<MailDeliveryResult> => results.shift() ?? { transport: 'fake', status: 'sent', messageId: 'm' });
  const mail = { sendNotification: send, transportName: 'fake' };
  const config = { get: () => options.nodeEnv ?? 'test' };
  const dispatcher = new NotificationDispatcher(prisma as unknown as PrismaService, mail as unknown as MailService, config as unknown as ConfigService<Env, true>);
  return { dispatcher, prisma, send, writes };
}

describe('NotificationDispatcher (TEST-175)', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('picks the queued e-mails up once at boot in development and production — not in a test process, not without a database', async () => {
    for (const nodeEnv of ['development', 'production']) {
      const { dispatcher, prisma, send } = build({ nodeEnv, leftQueued: ['old-1', 'old-2'] });
      dispatcher.onApplicationBootstrap();
      // Boot is not delayed: nothing has been read yet when the hook returns.
      expect(prisma.db.notification.updateMany).not.toHaveBeenCalled();
      await tick();
      await tick();
      await dispatcher.whenIdle();
      expect(prisma.db.notification.findMany).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(2);
    }
    for (const options of [{ nodeEnv: 'test' }, { nodeEnv: 'production', configured: false }]) {
      const { dispatcher, prisma, send } = build({ ...options, leftQueued: ['old-1'] });
      dispatcher.onApplicationBootstrap();
      await tick();
      await tick();
      await dispatcher.whenIdle();
      expect(prisma.db.notification.updateMany).not.toHaveBeenCalled();
      expect(prisma.db.notification.findMany).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('the pickup marks what is older than a day as stale and queues the rest of an earlier process', async () => {
    const now = new Date('2026-11-12T10:00:00Z');
    const { dispatcher, prisma, writes, send } = build({ leftQueued: ['old-1'] });
    const result = await dispatcher.pickUp(now);
    await dispatcher.whenIdle();
    expect(result).toEqual({ queued: 1, stale: 2 });
    expect(writes[0]).toEqual({ where: { emailStatus: 'queued', createdAt: { lt: new Date('2026-11-11T10:00:00Z') } }, data: { emailStatus: 'failed', emailFailure: 'stale' } });
    const read = prisma.db.notification.findMany.mock.calls[0]![0];
    expect(read.where.emailStatus).toBe('queued');
    expect(read.where.createdAt.gte).toEqual(new Date('2026-11-11T10:00:00Z'));
    // Only rows written before this process started: its own rows are handed over by their writers.
    expect(read.where.createdAt.lt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(read.orderBy).toEqual({ createdAt: 'asc' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends one message at a time and settles every row once, only while it is still queued', async () => {
    const { dispatcher, send, writes } = build();
    dispatcher.enqueue(['n1', 'n2', 'n1']);
    dispatcher.enqueue(['n2']);
    await dispatcher.whenIdle();
    dispatcher.enqueue(['n1']);
    await dispatcher.whenIdle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([mail]) => mail)).toEqual([
      { to: 'reader@example.test', recipientName: 'Reader', locale: null, title: 'A title', path: '/my-lessons' },
      { to: 'reader@example.test', recipientName: 'Reader', locale: null, title: 'A title', path: '/my-lessons' },
    ]);
    expect(writes.map((write) => [write.where.id, write.where.emailStatus, write.data.emailStatus])).toEqual([
      ['n1', 'queued', 'sent'],
      ['n2', 'queued', 'sent'],
    ]);
    // Nothing waiting: resolves at once.
    await dispatcher.whenIdle();
  });

  it('once the provider says the quota is used up, the next e-mails fail without another request', async () => {
    const quota: MailDeliveryResult = { transport: 'fake', status: 'failed', messageId: null, failure: { reason: 'http', httpStatus: 429, providerCode: 'daily_quota_exceeded' } };
    const { dispatcher, send, writes } = build({ results: [quota] });
    dispatcher.enqueue(['n1', 'n2', 'n3']);
    await dispatcher.whenIdle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(writes.map((write) => [write.where.id, write.data.emailStatus, write.data.emailFailure])).toEqual([
      ['n1', 'failed', 'http_429'],
      ['n2', 'failed', 'quota_exceeded'],
      ['n3', 'failed', 'quota_exceeded'],
    ]);
  });

  it('does not mail a recipient who lost the address, its confirmation or the active account, and never throws out of the queue', async () => {
    for (const recipient of [
      null,
      { email: null, emailVerifiedAt: null, status: 'active', deletedAt: null, locale: null, fullName: 'R', displayName: null },
      { email: 'r@example.test', emailVerifiedAt: null, status: 'active', deletedAt: null, locale: null, fullName: 'R', displayName: null },
      { email: 'r@example.test', emailVerifiedAt: new Date(), status: 'suspended', deletedAt: null, locale: null, fullName: 'R', displayName: null },
      { email: 'r@example.test', emailVerifiedAt: new Date(), status: 'active', deletedAt: new Date(), locale: null, fullName: 'R', displayName: null },
    ]) {
      const { dispatcher, send, writes } = build({ recipient });
      dispatcher.enqueue(['n1']);
      await dispatcher.whenIdle();
      expect(send).not.toHaveBeenCalled();
      expect(writes.map((write) => [write.data.emailStatus, write.data.emailFailure])).toEqual([['skipped', 'recipient_unavailable']]);
    }
    // A database error while settling leaves the row queued (the next boot picks it up) and the queue alive.
    const { dispatcher, prisma, send } = build();
    prisma.db.notification.updateMany.mockRejectedValueOnce(new Error('connection lost'));
    dispatcher.enqueue(['n1', 'n2']);
    await dispatcher.whenIdle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(Logger.prototype.error).mock.calls[0]![0])).toBe('notification e-mail not settled (id=n1)');
  });
});
