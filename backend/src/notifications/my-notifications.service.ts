import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MY_NOTIFICATIONS_PAGE_DEFAULT } from './my-notifications.dto.js';
import type {
  ListMyNotificationsQueryDto,
  MyNotificationDto,
  MyNotificationListDto,
  NotificationPreferencesDto,
  ReadAllNotificationsDto,
  ReadAllResultDto,
  UnreadCountDto,
  UpdateNotificationPreferencesDto,
} from './my-notifications.dto.js';
import { notificationsError } from './notifications.errors.js';
import { NOTIFICATION_CATEGORIES } from './notifications.events.js';

const NOTIFICATION_SELECT = {
  id: true,
  eventKey: true,
  category: true,
  title: true,
  body: true,
  data: true,
  announcementId: true,
  readAt: true,
  createdAt: true,
  student: { select: { id: true, fullName: true, displayName: true } },
} as const satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>;

function toDto(row: NotificationRow): MyNotificationDto {
  const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
  return {
    id: row.id,
    eventKey: row.eventKey,
    category: row.category,
    title: row.title,
    body: row.body,
    data,
    student: row.student,
    announcementId: row.announcementId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * MOD-12-T02 — «my notifications» and the e-mail preferences (API-167..172;
 * owner decisions D-R84/D-R86). Everything here is by ownership: no
 * permission key, and every query carries `recipient_user_id = caller` (or
 * `user_id = caller`), so nobody reads, counts or marks another user's
 * notification — it answers `404` like one that does not exist. The item
 * never carries the state of the e-mail copy or an address. Marking as read
 * and the preferences are personal: no audit event (D-R86).
 */
@Injectable()
export class MyNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** API-167: newest first by the UUIDv7 id (insertion order), `limit + 1` rows read to know whether a page follows. */
  async list(query: ListMyNotificationsQueryDto, caller: AuthPrincipal): Promise<MyNotificationListDto> {
    const limit = query.limit ?? MY_NOTIFICATIONS_PAGE_DEFAULT;
    const where: Prisma.NotificationWhereInput = { recipientUserId: caller.id };
    if (query.unread) where.readAt = null;
    if (query.category) where.category = query.category;
    if (query.cursor) where.id = { lt: query.cursor };
    const rows = await this.prisma.db.notification.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1, select: NOTIFICATION_SELECT });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items: items.map(toDto), nextCursor: rows.length > limit && last ? last.id : null };
  }

  /** API-168: what the frontend polls for the bell (D-R86) — one count on the partial index of unread rows. */
  async unreadCount(caller: AuthPrincipal): Promise<UnreadCountDto> {
    return { unread: await this.prisma.db.notification.count({ where: { recipientUserId: caller.id, readAt: null } }) };
  }

  /** API-169: sets `read_at` once; a repeat changes nothing and answers the same notification. */
  async markRead(notificationId: string, caller: AuthPrincipal): Promise<MyNotificationDto> {
    const db = this.prisma.db;
    await db.notification.updateMany({ where: { id: notificationId, recipientUserId: caller.id, readAt: null }, data: { readAt: new Date() } });
    const row = await db.notification.findFirst({ where: { id: notificationId, recipientUserId: caller.id }, select: NOTIFICATION_SELECT });
    if (!row) throw notificationsError.notificationNotFound(notificationId);
    return toDto(row);
  }

  /** API-170: every unread notification of the caller, or of one category. */
  async markAllRead(body: ReadAllNotificationsDto | undefined, caller: AuthPrincipal): Promise<ReadAllResultDto> {
    const where: Prisma.NotificationWhereInput = { recipientUserId: caller.id, readAt: null };
    if (body?.category) where.category = body.category;
    const result = await this.prisma.db.notification.updateMany({ where, data: { readAt: new Date() } });
    return { updated: result.count };
  }

  /**
   * API-171: the six categories with their e-mail switch (a missing row = on),
   * and the two facts that explain why no e-mail arrives although a switch is
   * on: the caller confirmed no address, or the academy sends no e-mail.
   */
  async preferences(caller: AuthPrincipal): Promise<NotificationPreferencesDto> {
    const db = this.prisma.db;
    const rows = await db.notificationPreference.findMany({ where: { userId: caller.id, emailEnabled: false }, select: { category: true } });
    const user = await db.user.findUnique({ where: { id: caller.id }, select: { email: true, emailVerifiedAt: true } });
    const off = new Set(rows.map((row) => row.category));
    return {
      categories: NOTIFICATION_CATEGORIES.map((category) => ({ category, emailEnabled: !off.has(category) })),
      emailVerified: Boolean(user?.email && user.emailVerifiedAt),
      emailAvailable: this.mail.transportName !== 'none',
    };
  }

  /** API-172: the switch of each named category is replaced, the others stay; no audit event (a personal preference). */
  async updatePreferences(body: UpdateNotificationPreferencesDto, caller: AuthPrincipal): Promise<NotificationPreferencesDto> {
    const entries = body.categories ?? [];
    if (entries.length === 0) throw notificationsError.nothingToUpdate();
    const db = this.prisma.db;
    await db.$transaction(
      entries.map((entry) =>
        db.notificationPreference.upsert({
          where: { userId_category: { userId: caller.id, category: entry.category } },
          create: { userId: caller.id, category: entry.category, emailEnabled: entry.emailEnabled },
          update: { emailEnabled: entry.emailEnabled },
        }),
      ),
    );
    return this.preferences(caller);
  }
}
