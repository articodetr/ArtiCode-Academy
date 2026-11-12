import { Injectable } from '@nestjs/common';
import type { LocaleCode } from '../authorization/localized-text.js';
import type { NotificationCategory, Prisma } from '../generated/prisma/client.js';
import { GUARDIAN_ROLE_KEY } from '../guardians/guardians.policy.js';
import { MY_LESSONS_ENROLLMENT_STATUSES } from '../lessons/my-lessons.policy.js';
import { MailService } from '../mail/mail.service.js';
import { templateLocale } from '../mail/mail.templates.js';
import { NotificationDispatcher } from './notifications.dispatcher.js';
import { NOTIFICATION_EVENTS, notificationData } from './notifications.events.js';
import type { ClassEventKey, NotificationEventKey, NotificationEventParams, StudentEventKey } from './notifications.events.js';
import { emailStatusFor, planClassRecipients, planStudentRecipients } from './notifications.recipients.js';
import type { EventStudent, GuardianLink, PlannedRecipient, RecipientUser } from './notifications.recipients.js';
import { childrenSuffix, renderNotification } from './notifications.templates.js';

/** The transaction of the write that causes the notifications. */
export type NotificationTx = Prisma.TransactionClient;

/**
 * What a `notify…()` call wrote. Hand it to `dispatch()` after the
 * transaction has committed — the e-mails of its `queued` rows go out then.
 */
export interface NotificationBatch {
  /** Notifications written. */
  created: number;
  /** Ids of the written rows whose e-mail copy waits for the dispatcher. */
  queuedIds: string[];
}

export const EMPTY_BATCH: NotificationBatch = Object.freeze({ created: 0, queuedIds: [] }) as NotificationBatch;

/** The class a student event is about, when its params name one. */
function classIdOf(params: object): string | null {
  const classId = (params as { classId?: unknown }).classId;
  return typeof classId === 'string' ? classId : null;
}

const enrollmentKey = (classId: string, studentId: string) => `${classId}|${studentId}`;

/** Rows per INSERT; a class is far below it, an announcement to 5,000 recipients (T05) takes five. */
export const NOTIFICATION_INSERT_CHUNK = 1000;

const RECIPIENT_SELECT = { id: true, fullName: true, displayName: true, locale: true, email: true, emailVerifiedAt: true } as const;
const STUDENT_SELECT = { ...RECIPIENT_SELECT, status: true } as const;

interface Audience {
  /** The not soft-deleted students of the event, by id. */
  students: Map<string, EventStudent>;
  /** Eligible guardian links of those students. */
  links: GuardianLink[];
  guardians: Map<string, RecipientUser>;
  /** Recipients who switched the e-mail of the event's category off. */
  muted: Set<string>;
  defaultLocale: LocaleCode;
}

/**
 * The notification engine of MOD-12 (roadmap §4j.5 T02; owner decisions
 * D-R80..D-R84; ADR-071). A writer service calls `notifyStudents()` or
 * `notifyClass()` INSIDE its own transaction, after its locks and its write,
 * so the notifications exist exactly when the write does; then, once the
 * transaction has committed, it calls `dispatch()` with what came back and
 * the e-mail copies go out in the background.
 *
 *     const batch = await this.prisma.db.$transaction(async (tx) => {
 *       … the write …
 *       return this.notifications.notifyStudents(tx, 'submission.graded', [{ studentId, params }]);
 *     });
 *     this.notifications.dispatch(batch);
 *
 * A notification is worded once, in its recipient's language (else the
 * academy's), and never changes afterwards. Nothing is recorded in the audit
 * log for a notification (D-R86).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly mail: MailService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  /**
   * A student event: one notification per (recipient × student) — the
   * student, while their account is active, and each of their guardians. An
   * unknown or soft-deleted student yields nothing.
   *
   * An event about a class (its params carry a `classId`: an absence, a
   * graded or returned attempt, an exam result, a final grade) follows the
   * «my …» pages (D-R83): it reaches the student and their guardians only
   * while the student's enrollment in that class is `active` or `completed`
   * — exactly when those pages show them the class. A withdrawn student is
   * told nothing about work they can no longer see. Events without a class
   * (invoices, payments, certificates) have no such condition.
   */
  async notifyStudents<K extends StudentEventKey>(
    tx: NotificationTx,
    key: K,
    items: ReadonlyArray<{ studentId: string; params: NotificationEventParams[K] }>,
  ): Promise<NotificationBatch> {
    if (items.length === 0) return EMPTY_BATCH;
    const category = NOTIFICATION_EVENTS[key].category;
    const audience = await this.audience(tx, items.map((item) => item.studentId), category);
    const enrolled = await this.ownedClasses(tx, items);
    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const item of items) {
      const student = audience.students.get(item.studentId);
      if (!student) continue;
      const classId = classIdOf(item.params);
      if (classId !== null && !enrolled.has(enrollmentKey(classId, student.id))) continue;
      const guardians = audience.links
        .filter((link) => link.studentUserId === student.id)
        .map((link) => audience.guardians.get(link.guardianUserId))
        .filter((guardian): guardian is RecipientUser => guardian !== undefined);
      for (const recipient of planStudentRecipients(student, guardians)) rows.push(this.row(key, item.params, recipient, audience));
    }
    return this.write(tx, rows);
  }

  /**
   * A class event: one notification per recipient — the students with an
   * `active` enrollment in the class and their guardians; a guardian's copy
   * names every child of theirs in the class.
   */
  async notifyClass<K extends ClassEventKey>(tx: NotificationTx, key: K, classId: string, params: NotificationEventParams[K]): Promise<NotificationBatch> {
    const enrollments = await tx.enrollment.findMany({ where: { classId, status: 'active' }, orderBy: { id: 'asc' }, select: { studentUserId: true } });
    if (enrollments.length === 0) return EMPTY_BATCH;
    const studentIds = enrollments.map((enrollment) => enrollment.studentUserId);
    const audience = await this.audience(tx, studentIds, NOTIFICATION_EVENTS[key].category);
    const students = studentIds.map((id) => audience.students.get(id)).filter((student): student is EventStudent => student !== undefined);
    const rows = planClassRecipients(students, audience.links, audience.guardians).map((recipient) => this.row(key, params, recipient, audience));
    return this.write(tx, rows);
  }

  /** After the transaction committed: queues the e-mail copies. Never throws and never waits for a send. */
  dispatch(batch: NotificationBatch): void {
    this.dispatcher.enqueue(batch.queuedIds);
  }

  // --------------------------------------------------------------- internals

  /**
   * The (class, student) pairs of these items in which the student holds an
   * enrollment the «my …» pages show — one flat read, and none at all when no
   * item is about a class.
   */
  private async ownedClasses(tx: NotificationTx, items: ReadonlyArray<{ studentId: string; params: object }>): Promise<Set<string>> {
    const classIds = new Set<string>();
    const studentIds = new Set<string>();
    for (const item of items) {
      const classId = classIdOf(item.params);
      if (classId === null) continue;
      classIds.add(classId);
      studentIds.add(item.studentId);
    }
    if (classIds.size === 0) return new Set();
    const enrollments = await tx.enrollment.findMany({
      where: { classId: { in: [...classIds] }, studentUserId: { in: [...studentIds] }, status: { in: [...MY_LESSONS_ENROLLMENT_STATUSES] } },
      select: { classId: true, studentUserId: true },
    });
    return new Set(enrollments.map((enrollment) => enrollmentKey(enrollment.classId, enrollment.studentUserId)));
  }

  /** The students, their eligible guardians, the muted recipients and the academy's language — four flat reads. */
  private async audience(tx: NotificationTx, studentIds: readonly string[], category: NotificationCategory): Promise<Audience> {
    const ids = [...new Set(studentIds)];
    const studentRows = await tx.user.findMany({ where: { id: { in: ids }, deletedAt: null }, select: STUDENT_SELECT });
    const students = new Map(studentRows.map((row) => [row.id, row satisfies EventStudent]));
    const liveIds = [...students.keys()];
    const links =
      liveIds.length === 0
        ? []
        : await tx.guardianStudent.findMany({
            where: {
              studentUserId: { in: liveIds },
              // The «my …» rule read backwards (D-R81): the role, an active account, not soft-deleted.
              guardian: { deletedAt: null, status: 'active', roles: { some: { role: { key: GUARDIAN_ROLE_KEY } } } },
            },
            orderBy: [{ studentUserId: 'asc' }, { guardianUserId: 'asc' }],
            select: { guardianUserId: true, studentUserId: true },
          });
    const guardianIds = [...new Set(links.map((link) => link.guardianUserId))];
    const guardianRows = guardianIds.length === 0 ? [] : await tx.user.findMany({ where: { id: { in: guardianIds } }, select: RECIPIENT_SELECT });
    const guardians = new Map(guardianRows.map((row) => [row.id, row satisfies RecipientUser]));
    const recipientIds = [...new Set([...liveIds, ...guardianIds])];
    const mutedRows =
      recipientIds.length === 0
        ? []
        : await tx.notificationPreference.findMany({ where: { userId: { in: recipientIds }, category, emailEnabled: false }, select: { userId: true } });
    const academy = await tx.academy.findFirst({ select: { defaultLocale: true } });
    return { students, links, guardians, muted: new Set(mutedRows.map((row) => row.userId)), defaultLocale: academy?.defaultLocale ?? 'ar' };
  }

  private row<K extends NotificationEventKey>(key: K, params: NotificationEventParams[K], recipient: PlannedRecipient, audience: Audience): Prisma.NotificationCreateManyInput {
    const event = NOTIFICATION_EVENTS[key];
    const locale = templateLocale(recipient.user.locale, audience.defaultLocale);
    const rendered = renderNotification(key, params, locale, audience.defaultLocale);
    const suffix = childrenSuffix(recipient.children.map((child) => child.name), locale);
    return {
      recipientUserId: recipient.user.id,
      eventKey: key,
      category: event.category,
      title: rendered.title,
      body: suffix ? `${rendered.body} ${suffix}` : rendered.body,
      data: notificationData(key, params, recipient.children.map((child) => child.id)),
      studentUserId: recipient.studentId,
      emailStatus: emailStatusFor({
        email: recipient.user.email,
        emailVerifiedAt: recipient.user.emailVerifiedAt,
        categoryEnabled: !audience.muted.has(recipient.user.id),
        transport: this.mail.transportName,
      }),
    };
  }

  private async write(tx: NotificationTx, rows: Prisma.NotificationCreateManyInput[]): Promise<NotificationBatch> {
    const queuedIds: string[] = [];
    for (let start = 0; start < rows.length; start += NOTIFICATION_INSERT_CHUNK) {
      const written = await tx.notification.createManyAndReturn({
        data: rows.slice(start, start + NOTIFICATION_INSERT_CHUNK),
        select: { id: true, emailStatus: true },
      });
      for (const row of written) if (row.emailStatus === 'queued') queuedIds.push(row.id);
    }
    return { created: rows.length, queuedIds };
  }
}
