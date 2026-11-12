import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { MailService } from '../mail/mail.service.js';
import { NOTIFICATIONS_PATH } from '../mail/mail.templates.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DELIVERY_FAILURE, STALE_AFTER_MS, outcomeOf, pacingAfter } from './notifications.delivery.js';
import type { DeliveryOutcome } from './notifications.delivery.js';
import { nameOf, receives } from './notifications.recipients.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

function linkOf(data: Prisma.JsonValue): string {
  if (data && typeof data === 'object' && !Array.isArray(data) && typeof data['link'] === 'string') return data['link'];
  return NOTIFICATIONS_PATH;
}

/**
 * Sends the e-mail copies of notifications (owner decision D-R82, ADR-071).
 * The rows are written inside the transaction of the write that caused them;
 * the writer hands the ids of the `queued` ones over after it committed, and
 * this queue sends them one at a time, in the process, after the response —
 * so a slow provider never delays a request and a failed e-mail never fails
 * one. There is no outbox table and no worker:
 *
 *   * one message at a time, paced for the provider (`pacingAfter()`);
 *   * the state is written back with `WHERE email_status = 'queued'`, so a
 *     row is settled once however often its id is handed over;
 *   * what a stopped process left `queued` is picked up once at the next
 *     boot (`pickUp()`): sent when younger than a day, else `failed/stale`.
 *     A crash between the provider's answer and the write-back can therefore
 *     send one message a second time — accepted for a first version;
 *   * one process per academy (ADR-045). Two processes on one database would
 *     both pick the same rows up; the test runs share a database, so there
 *     the automatic pickup is off and the suites call `pickUp()` themselves.
 *
 * Log lines carry ids and counts only — never an address, a title or a link.
 */
@Injectable()
export class NotificationDispatcher implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationDispatcher.name);
  /** Rows created before this instant belong to an earlier process: only `pickUp()` sends them. */
  private readonly bootedAt = new Date();
  private readonly automaticPickup: boolean;
  /** Ids handed over and not settled yet. */
  private readonly waiting = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private quotaBlockedUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.automaticPickup = config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.automaticPickup || !this.prisma.isConfigured) return;
    setImmediate(() => {
      this.pickUp().catch((error: unknown) => {
        this.logger.error('pickup of queued notification e-mails failed at boot', error instanceof Error ? error.stack : String(error));
      });
    });
  }

  /**
   * Queues the e-mails of these notifications; call it only after the
   * transaction that wrote them has committed. Returns at once — the sending
   * starts after the current request has been answered.
   */
  enqueue(notificationIds: readonly string[]): void {
    const fresh = [...new Set(notificationIds)].filter((id) => !this.waiting.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) this.waiting.add(id);
    setImmediate(() => {
      for (const id of fresh) {
        this.tail = this.tail
          .then(() => this.deliver(id))
          .catch((error: unknown) => {
            // The row stays `queued`; the next boot picks it up.
            this.logger.error(`notification e-mail not settled (id=${id})`, error instanceof Error ? error.stack : String(error));
          })
          .finally(() => {
            this.waiting.delete(id);
          });
      }
    });
  }

  /** Resolves once everything handed over so far is settled (the tests wait on it; requests never do). */
  async whenIdle(): Promise<void> {
    while (this.waiting.size > 0) {
      await nextTick();
      await this.tail;
    }
  }

  /**
   * What an earlier process left `queued`: the rows older than a day become
   * `failed` with `stale`, the others are queued again. Runs once at boot
   * (not in test processes); calling it again finds nothing new.
   */
  async pickUp(now: Date = new Date()): Promise<{ queued: number; stale: number }> {
    const db = this.prisma.db;
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const stale = await db.notification.updateMany({
      where: { emailStatus: 'queued', createdAt: { lt: cutoff } },
      data: { emailStatus: 'failed', emailFailure: DELIVERY_FAILURE.stale },
    });
    const rows = await db.notification.findMany({
      where: { emailStatus: 'queued', createdAt: { gte: cutoff, lt: this.bootedAt } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (stale.count > 0 || rows.length > 0) this.logger.log(`queued notification e-mails picked up (send=${rows.length}, stale=${stale.count})`);
    this.enqueue(rows.map((row) => row.id));
    return { queued: rows.length, stale: stale.count };
  }

  private async deliver(id: string): Promise<void> {
    const db = this.prisma.db;
    const row = await db.notification.findFirst({
      where: { id, emailStatus: 'queued' },
      select: { id: true, title: true, data: true, recipientUserId: true },
    });
    if (!row) return;
    const user = await db.user.findUnique({
      where: { id: row.recipientUserId },
      select: { email: true, emailVerifiedAt: true, status: true, deletedAt: true, locale: true, fullName: true, displayName: true },
    });
    if (!user || user.deletedAt || !receives(user.status) || !user.email || !user.emailVerifiedAt) {
      await this.settle(id, { emailStatus: 'skipped', emailFailure: DELIVERY_FAILURE.recipientUnavailable });
      return;
    }
    if (Date.now() < this.quotaBlockedUntil) {
      await this.settle(id, { emailStatus: 'failed', emailFailure: DELIVERY_FAILURE.quotaExceeded });
      return;
    }

    const result = await this.mail.sendNotification({
      to: user.email,
      recipientName: nameOf(user),
      locale: user.locale,
      title: row.title,
      path: linkOf(row.data),
    });
    await this.settle(id, outcomeOf(result, new Date()));

    const pacing = pacingAfter(result, this.mail.transportName);
    if (pacing.quotaBlockMs > 0) {
      this.quotaBlockedUntil = Date.now() + pacing.quotaBlockMs;
      this.logger.warn(`mail quota used up: notification e-mails fail without a send for ${Math.round(pacing.quotaBlockMs / 60000)} min`);
    }
    if (pacing.waitMs > 0) await sleep(pacing.waitMs);
  }

  /** Writes the outcome only while the row is still `queued` — a second hand-over of the same id changes nothing. */
  private async settle(id: string, outcome: DeliveryOutcome): Promise<void> {
    await this.prisma.db.notification.updateMany({ where: { id, emailStatus: 'queued' }, data: outcome });
  }
}
