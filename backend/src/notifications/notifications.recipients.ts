// Who receives a notification (owner decision D-R81) and whether its e-mail
// copy is due (D-R84), as pure rules — unit-tested in
// notifications.recipients.spec.ts. The rule is the one of the «my …» pages
// read the other way round: from the student to those who may see their data.
//
//   * the student, while their account is `active`;
//   * each guardian linked to the student who holds the `guardian` role and
//     whose account is `active` and not soft-deleted (links alone grant
//     nothing — the service's query applies this filter);
//   * a soft-deleted student produces nothing, for anybody.
//
// A student event yields one notification per (recipient × student); a class
// event yields one per recipient, a guardian's copy naming every child of
// theirs in the class. Nobody else is notified automatically (no teacher, no
// staff).
import type { LocaleCode } from '../authorization/localized-text.js';
import type { NotificationEmailStatus, UserStatus } from '../generated/prisma/client.js';

/** What the engine reads about a possible recipient. */
export interface RecipientUser {
  id: string;
  fullName: string;
  displayName: string | null;
  /** Preferred language; null = the academy's default. */
  locale: LocaleCode | null;
  email: string | null;
  emailVerifiedAt: Date | null;
}

/** A not soft-deleted student the event is about; only an `active` one receives their own copy. */
export interface EventStudent extends RecipientUser {
  status: UserStatus;
}

/** An eligible guardian link: the guardian holds the role and an active, not soft-deleted account. */
export interface GuardianLink {
  guardianUserId: string;
  studentUserId: string;
}

export interface PlannedRecipient {
  user: RecipientUser;
  /** The recipient is a student the event is about. */
  self: boolean;
  /** The recipient's children the event is about — named at the end of a guardian's copy. */
  children: Array<{ id: string; name: string }>;
  /** `student_user_id` of the row: the recipient themself, their only child concerned, or null for several children. */
  studentId: string | null;
}

/** The name a person is addressed or mentioned by. */
export function nameOf(user: { fullName: string; displayName: string | null }): string {
  return user.displayName ?? user.fullName;
}

/** Accounts that receive notifications: `active` only (an invited account cannot sign in yet). */
export function receives(status: UserStatus): boolean {
  return status === 'active';
}

/**
 * A student event (a grade, an absence, an invoice …): the student, then each
 * of their eligible guardians — one notification each, all about that student.
 */
export function planStudentRecipients(student: EventStudent, guardians: readonly RecipientUser[]): PlannedRecipient[] {
  const planned: PlannedRecipient[] = [];
  if (receives(student.status)) planned.push({ user: student, self: true, children: [], studentId: student.id });
  const child = { id: student.id, name: nameOf(student) };
  for (const guardian of guardians) {
    if (guardian.id === student.id) continue;
    planned.push({ user: guardian, self: false, children: [child], studentId: student.id });
  }
  return planned;
}

/**
 * A class event (a cancelled lesson, a published assignment …): one
 * notification per recipient. Students come first, in the order given; then
 * the guardians, in the order of their first link. A guardian with two
 * children in the class gets one notification naming both; a student who is
 * also the guardian of a classmate gets one, their own, naming that child.
 */
export function planClassRecipients(
  students: readonly EventStudent[],
  links: readonly GuardianLink[],
  guardians: ReadonlyMap<string, RecipientUser>,
): PlannedRecipient[] {
  const byId = new Map<string, PlannedRecipient>();
  const studentsById = new Map(students.map((student) => [student.id, student]));
  for (const student of students) {
    if (receives(student.status)) byId.set(student.id, { user: student, self: true, children: [], studentId: student.id });
  }
  for (const link of links) {
    const child = studentsById.get(link.studentUserId);
    const guardian = guardians.get(link.guardianUserId);
    if (!child || !guardian || guardian.id === child.id) continue;
    let planned = byId.get(guardian.id);
    if (!planned) {
      planned = { user: guardian, self: false, children: [], studentId: null };
      byId.set(guardian.id, planned);
    }
    if (!planned.children.some((known) => known.id === child.id)) planned.children.push({ id: child.id, name: nameOf(child) });
  }
  for (const planned of byId.values()) {
    if (!planned.self) planned.studentId = planned.children.length === 1 ? planned.children[0]!.id : null;
  }
  return [...byId.values()];
}

export interface EmailDecisionInput {
  email: string | null;
  emailVerifiedAt: Date | null;
  /** False when the recipient switched the e-mail of this category off (a missing preference row = on). */
  categoryEnabled: boolean;
  /** Name of the configured mail transport (`none`, `log`, `resend`). */
  transport: string;
  /** False when the sender asked for no e-mail (an announcement without `sendEmail`). */
  wanted?: boolean;
}

/**
 * The state the e-mail copy starts in (D-R82/D-R84): `none` when no e-mail is
 * due — not asked for, no address, an address nobody confirmed, or the
 * category switched off; `skipped` when one is due but no transport is
 * configured; `queued` otherwise, for the dispatcher to send after commit.
 */
export function emailStatusFor(input: EmailDecisionInput): Extract<NotificationEmailStatus, 'none' | 'queued' | 'skipped'> {
  if (input.wanted === false) return 'none';
  if (!input.email || !input.emailVerifiedAt) return 'none';
  if (!input.categoryEnabled) return 'none';
  return input.transport === 'none' ? 'skipped' : 'queued';
}
