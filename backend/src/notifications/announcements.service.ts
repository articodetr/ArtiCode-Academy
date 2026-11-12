import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { authError } from '../auth/auth.errors.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { visibleClassesWhere } from '../classes/classes.policy.js';
import { UserStatus } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { GUARDIAN_ROLE_KEY } from '../guardians/guardians.policy.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  academyAudienceMissing,
  announcementData,
  checkAudience,
  exceedsRecipientLimit,
  mergeRecipients,
  readAudience,
  visibleAnnouncementsWhere,
} from './announcements.audience.js';
import type { AnnouncementAudience } from './announcements.audience.js';
import { ANNOUNCEMENTS_PAGE_DEFAULT } from './announcements.dto.js';
import type {
  AnnouncementAudienceDto,
  AnnouncementDetailDto,
  AnnouncementDto,
  AnnouncementEmailCountsDto,
  AnnouncementListDto,
  CreateAnnouncementDto,
  ListAnnouncementsQueryDto,
} from './announcements.dto.js';
import { notificationsError } from './notifications.errors.js';
import { ANNOUNCEMENT_CATEGORY, ANNOUNCEMENT_EVENT_KEY } from './notifications.events.js';
import { emailStatusFor, receives } from './notifications.recipients.js';
import { NotificationsService } from './notifications.service.js';

export const ANNOUNCEMENTS_AUDIT_ACTIONS = {
  sent: 'notifications.announcement.sent',
} as const;

/** Audit `entity_type` of the announcement event. */
export const ANNOUNCEMENTS_ENTITY_TYPE = 'announcements';

/**
 * Upper bound of the sending transaction. Prisma closes an interactive
 * transaction after 5 seconds by default, which the largest announcement —
 * 5,000 notifications, each carrying the title and the body, in five
 * statements of 1,000 rows — does not reliably fit. Measured on the
 * development machine on 2026-11-12 as the application role: 1.6 s with short
 * texts and 3.2–3.7 s with a 4,000-character body while the machine was
 * quiet, 5.5 s and 12.5 s while other test runs shared it. A class
 * announcement — tens of rows — takes milliseconds.
 *
 * KI-079: for that long the transaction holds a key-share lock on the `users`
 * row of every recipient (the foreign key of each inserted notification). A
 * writer that locks one of those rows `FOR UPDATE` — a guardian link of that
 * student, `lockActiveAdmins()` — waits for the commit, and past Prisma's own
 * 5 seconds it fails. Only an announcement to thousands is long enough to
 * matter; nothing reads or writes wrongly.
 */
export const ANNOUNCEMENT_TRANSACTION_TIMEOUT_MS = 30_000;

type Tx = Prisma.TransactionClient;

/** What the service reads about a possible recipient: who, and where an e-mail copy may go. */
export interface AudienceMember {
  id: string;
  email: string | null;
  emailVerifiedAt: Date | null;
}

const MEMBER_SELECT = { id: true, email: true, emailVerifiedAt: true } as const satisfies Prisma.UserSelect;

/**
 * An account that receives notifications: not soft-deleted, and in a state
 * the engine notifies — its own rule (`receives()`: `active` only), turned
 * into a filter so an announcement and an automatic event never disagree.
 */
const RECEIVING_ACCOUNT = {
  deletedAt: null,
  status: { in: (Object.values(UserStatus) as UserStatus[]).filter(receives) },
} satisfies Prisma.UserWhereInput;

const ANNOUNCEMENT_SELECT = {
  id: true,
  audience: true,
  title: true,
  body: true,
  sendEmail: true,
  recipientCount: true,
  createdAt: true,
  class: { select: { id: true, code: true, name: true } },
  sender: { select: { id: true, fullName: true, displayName: true } },
} as const satisfies Prisma.AnnouncementSelect;

/** An announcement as it is answered: the row with its class and sender, read back or just written. */
interface AnnouncementView {
  id: string;
  audience: unknown;
  title: string;
  body: string;
  sendEmail: boolean;
  recipientCount: number;
  createdAt: Date;
  class: { id: string; code: string; name: unknown } | null;
  sender: { id: string; fullName: string; displayName: string | null } | null;
}

function toDto(row: AnnouncementView): AnnouncementDto {
  return {
    id: row.id,
    // A row this service wrote always reads back; the CHECK leaves at least an object with a known kind otherwise.
    audience: readAudience(row.audience) ?? (row.audience as AnnouncementAudienceDto),
    class: row.class ? { id: row.class.id, code: row.class.code, name: readLocalizedText(row.class.name) ?? { ar: row.class.code } } : null,
    title: row.title,
    body: row.body,
    sendEmail: row.sendEmail,
    recipientCount: row.recipientCount,
    sender: row.sender ? { id: row.sender.id, fullName: row.sender.fullName, displayName: row.sender.displayName } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * MOD-12-T05 — manual announcements (roadmap §4j.4 API-173..175; owner
 * decision D-R85). A holder of `notifications.send` writes a title and a body
 * to the people of a class they teach — or, with `classes.manage` too, of any
 * class or to everyone who holds one of the named roles. The announcement and
 * one notification per recipient are written in ONE transaction with exactly
 * one audit event (`notifications.announcement.sent`, ids and counts only);
 * the e-mail copies, when asked for, go out after the commit through the
 * notification dispatcher like those of every other notification (ADR-071).
 *
 * The notifications carry the sender's words as typed, for every recipient
 * alike — no template and no translation — and nothing here interprets them:
 * they are plain text. An announcement is never edited, withdrawn or
 * scheduled. Reading (the sender their own, a holder of `classes.manage` all)
 * records nothing.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * API-173. Refusals in this order, each before any write: the shape of the
   * audience (`audience_invalid`), an academy audience without
   * `classes.manage` (`permission_denied`), a class the caller may not
   * announce to (`class_not_found`), nobody to reach (`audience_empty`), too
   * many (`audience_too_large`).
   */
  async send(input: CreateAnnouncementDto, caller: AuthPrincipal, ctx: RequestContext): Promise<AnnouncementDto> {
    const checked = checkAudience(input.audience);
    if (checked.audience === null) throw notificationsError.audienceInvalid(checked.problems);
    const audience = checked.audience;
    if (audience.kind === 'academy') {
      const missing = academyAudienceMissing(caller.permissions);
      if (missing) throw authError.permissionDenied(missing);
    }
    const sendEmail = input.sendEmail === true;

    const { dto, batch } = await this.prisma.db.$transaction(
      async (tx) => {
        const klass = audience.kind === 'class' ? await this.announceableClass(tx, audience.classId, caller) : null;
        const recipients = mergeRecipients(await this.audienceMembers(tx, audience), caller.id);
        if (recipients.length === 0) throw notificationsError.audienceEmpty();
        if (exceedsRecipientLimit(recipients.length)) throw notificationsError.audienceTooLarge(recipients.length);
        // Only an announcement that asks for e-mail needs to know who switched the category off (D-R84).
        const muted = sendEmail ? await this.mutedAmong(tx, recipients) : new Set<string>();

        const announcement = await tx.announcement.create({
          data: {
            senderUserId: caller.id,
            audience: { ...audience },
            classId: klass?.id ?? null,
            title: input.title,
            body: input.body,
            sendEmail,
            recipientCount: recipients.length,
          },
          select: { id: true, audience: true, title: true, body: true, sendEmail: true, recipientCount: true, createdAt: true },
        });
        const data = announcementData(announcement.id, klass?.id ?? null);
        const transport = this.mail.transportName;
        // The engine's own writer: chunks of 1,000 rows, the queued ones handed back for the dispatcher.
        const batch = await this.notifications.write(
          tx,
          recipients.map((recipient) => ({
            recipientUserId: recipient.id,
            eventKey: ANNOUNCEMENT_EVENT_KEY,
            category: ANNOUNCEMENT_CATEGORY,
            // The sender's words, the same for every recipient: nothing is translated or templated.
            title: announcement.title,
            body: announcement.body,
            data,
            announcementId: announcement.id,
            studentUserId: null,
            emailStatus: emailStatusFor({
              email: recipient.email,
              emailVerifiedAt: recipient.emailVerifiedAt,
              categoryEnabled: !muted.has(recipient.id),
              transport,
              wanted: sendEmail,
            }),
          })),
        );
        await this.audit.record(
          {
            action: ANNOUNCEMENTS_AUDIT_ACTIONS.sent,
            actorUserId: caller.id,
            entityType: ANNOUNCEMENTS_ENTITY_TYPE,
            entityId: announcement.id,
            // Ids, keys and a count — never the title or the body.
            metadata: { audience: { ...audience }, recipients: recipients.length },
            ...ctx,
          },
          tx,
        );
        const sender = { id: caller.id, fullName: caller.fullName, displayName: caller.displayName };
        return { dto: toDto({ ...announcement, class: klass, sender }), batch };
      },
      { timeout: ANNOUNCEMENT_TRANSACTION_TIMEOUT_MS },
    );
    // After the commit: the e-mail copies leave in the background; a failed e-mail never fails the announcement.
    this.notifications.dispatch(batch);
    return dto;
  }

  /** API-174: newest first by the UUIDv7 id (insertion order), `limit + 1` rows read to know whether a page follows. */
  async list(query: ListAnnouncementsQueryDto, caller: AuthPrincipal): Promise<AnnouncementListDto> {
    const limit = query.limit ?? ANNOUNCEMENTS_PAGE_DEFAULT;
    const filters: Prisma.AnnouncementWhereInput[] = [visibleAnnouncementsWhere(caller)];
    if (query.classId) filters.push({ classId: query.classId });
    if (query.cursor) filters.push({ id: { lt: query.cursor } });
    const rows = await this.prisma.db.announcement.findMany({ where: { AND: filters }, orderBy: { id: 'desc' }, take: limit + 1, select: ANNOUNCEMENT_SELECT });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items: items.map(toDto), nextCursor: rows.length > limit && last ? last.id : null };
  }

  /** API-175: the announcement with how many read it and what became of its e-mail copies — counts only. */
  async get(id: string, caller: AuthPrincipal): Promise<AnnouncementDetailDto> {
    const db = this.prisma.db;
    const row = await db.announcement.findFirst({ where: { AND: [{ id }, visibleAnnouncementsWhere(caller)] }, select: ANNOUNCEMENT_SELECT });
    if (!row) throw notificationsError.announcementNotFound(id);
    const readCount = await db.notification.count({ where: { announcementId: id, readAt: { not: null } } });
    const states = await db.notification.groupBy({ by: ['emailStatus'], where: { announcementId: id }, _count: { _all: true } });
    const email: AnnouncementEmailCountsDto = { none: 0, queued: 0, sent: 0, failed: 0, skipped: 0 };
    for (const state of states) email[state.emailStatus] = state._count._all;
    return { ...toDto(row), readCount, email };
  }

  /**
   * The members of each group the audience names, group by group — accounts
   * that receive notifications only. The same person may appear in several
   * groups, and the sender among them: `mergeRecipients()` settles both.
   *
   *   students  — an `active` enrollment in the class
   *   guardians — the `guardian` role and a link to a student with an
   *               `active` enrollment in the class, as the engine reads it
   *               for a class event (D-R81): the student's own account may be
   *               invited or suspended, but not soft-deleted
   *   teachers  — a row in `class_teachers`, lead or assistant
   *   academy   — one of the named roles
   */
  async audienceMembers(tx: Tx, audience: AnnouncementAudience): Promise<AudienceMember[][]> {
    const read = (where: Prisma.UserWhereInput) => tx.user.findMany({ where: { ...RECEIVING_ACCOUNT, ...where }, orderBy: { id: 'asc' }, select: MEMBER_SELECT });
    if (audience.kind === 'academy') return [await read({ roles: { some: { role: { key: { in: audience.roleKeys } } } } })];

    const enrolled = { some: { classId: audience.classId, status: 'active' } } satisfies Prisma.EnrollmentListRelationFilter;
    const groups: AudienceMember[][] = [];
    if (audience.students) groups.push(await read({ enrollments: enrolled }));
    if (audience.guardians) {
      groups.push(await read({ roles: { some: { role: { key: GUARDIAN_ROLE_KEY } } }, guardianOf: { some: { student: { deletedAt: null, enrollments: enrolled } } } }));
    }
    if (audience.teachers) groups.push(await read({ classTeacherships: { some: { classId: audience.classId } } }));
    return groups;
  }

  // --------------------------------------------------------------- internals

  /**
   * The class of a class audience, when the caller may announce to it (D-R16:
   * a teacher of the class, or `classes.manage`); an unknown class and a class
   * of somebody else are the same 404. The row is locked `FOR KEY SHARE`: an
   * announcement changes nothing of the class and holds no count against it,
   * so it neither waits for nor blocks the class's writers (their lock is
   * `FOR NO KEY UPDATE`) — the lock only keeps the class from being deleted
   * before the announcement that points to it is written.
   */
  private async announceableClass(tx: Tx, classId: string, caller: AuthPrincipal): Promise<{ id: string; code: string; name: unknown }> {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM classes WHERE id = ${classId}::uuid FOR KEY SHARE`;
    if (locked.length === 0) throw notificationsError.classNotFound(classId);
    const klass = await tx.class.findFirst({ where: { AND: [{ id: classId }, visibleClassesWhere(caller)] }, select: { id: true, code: true, name: true } });
    if (!klass) throw notificationsError.classNotFound(classId);
    return klass;
  }

  /** The recipients who switched the e-mail of the `announcements` category off (a missing row = on). */
  private async mutedAmong(tx: Tx, recipients: readonly AudienceMember[]): Promise<Set<string>> {
    const rows = await tx.notificationPreference.findMany({
      where: { userId: { in: recipients.map((recipient) => recipient.id) }, category: ANNOUNCEMENT_CATEGORY, emailEnabled: false },
      select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
  }
}
