// The automatic notification events of MOD-12 (owner decision D-R80): fifteen
// events from the writes of MOD-06..MOD-11, in five categories. The sixteenth
// event is the manual announcement (T05), which carries its sender's own
// words instead of a template. The list lives here, in code — the database
// only checks the shape of a key. No framework imports: pure data and types,
// unit-tested in notifications.templates.spec.ts.
import type { LocalizedText } from '../authorization/localized-text.js';
import type { NotificationCategory } from '../generated/prisma/client.js';

/**
 * Frontend paths a notification points to (`data.link`): the page where the
 * recipient already sees the thing the event is about. The screens are the
 * collaborator's (MOD-12-T07); a path the frontend does not serve yet simply
 * opens its not-found page.
 */
export const NOTIFICATION_LINKS = {
  lessons: '/my-lessons',
  assignments: '/my-assignments',
  exams: '/my-exams',
  grades: '/my-grades',
  certificates: '/my-certificates',
  invoices: '/my-invoices',
  notifications: '/notifications',
} as const;

/** The key and category of a manual announcement (T05). */
export const ANNOUNCEMENT_EVENT_KEY = 'announcement';
export const ANNOUNCEMENT_CATEGORY: NotificationCategory = 'announcements';

interface LessonEventParams {
  lessonId: string;
  classId: string;
  lessonTitle: LocalizedText;
  className: LocalizedText;
  startsAt: Date;
  /** The lesson's display zone (D-R41): the room's branch, else the academy. */
  timeZone: string;
}

/**
 * What each event needs to be worded. Texts stored as `{ ar, en?, tr? }` are
 * passed whole and picked per recipient; numbers arrive already formatted
 * (`formatNumber()`), dates as instants with the zone they are shown in.
 * Every `…Id` entry is copied into the notification's `data`.
 */
export interface NotificationEventParams {
  'lesson.cancelled': LessonEventParams;
  /**
   * The lesson as it stands after the change: its new start, its end
   * (`endsAt` — a lesson that only ends earlier or later is news too) and its
   * room, worded by its name in the reader's language, else by its code; null
   * when the lesson has no room.
   */
  'lesson.rescheduled': LessonEventParams & { endsAt: Date; room: { code: string; name: LocalizedText | null } | null };
  'attendance.absent': LessonEventParams;
  'assignment.published': { assignmentId: string; classId: string; title: LocalizedText; className: LocalizedText; dueAt: Date | null; timeZone: string };
  'submission.graded': { submissionId: string; assignmentId: string; classId: string; title: LocalizedText; score: string; maxScore: string };
  'submission.returned': { submissionId: string; assignmentId: string; classId: string; title: LocalizedText };
  'exam.scheduled': { examId: string; classId: string; title: LocalizedText; className: LocalizedText; scheduledAt: Date | null; timeZone: string };
  /** The student's own result; `score` only with `scored`. */
  'exam.results_published': { examId: string; classId: string; title: LocalizedText; result: 'scored' | 'absent' | 'excused'; score: string | null; maxScore: string };
  'grades.finalized': { classId: string; className: LocalizedText; percent: string; bandLabel: LocalizedText; bandLetter: string | null };
  'certificate.issued': { certificateId: string; serial: string; courseName: LocalizedText };
  'certificate.revoked': { certificateId: string; serial: string; courseName: LocalizedText };
  /** `firstDueOn` is a calendar day `YYYY-MM-DD`. */
  'invoice.issued': { invoiceId: string; number: string; total: string; currency: string; firstDueOn: string | null };
  'invoice.cancelled': { invoiceId: string; number: string };
  'payment.recorded': { paymentId: string; invoiceId: string; receiptNumber: string; invoiceNumber: string; amount: string; currency: string };
  'payment.reversed': { paymentId: string; invoiceId: string; receiptNumber: string; invoiceNumber: string };
}

export type NotificationEventKey = keyof NotificationEventParams;

/**
 * `class`: one notification per recipient — the active students of the class
 * and their guardians, a guardian's copy naming their children in it.
 * `student`: one notification per (recipient × student) — the student and
 * their guardians (D-R81).
 */
export type NotificationScope = 'class' | 'student';

interface EventDefinition {
  category: NotificationCategory;
  scope: NotificationScope;
  link: string;
}

export const NOTIFICATION_EVENTS = {
  'lesson.cancelled': { category: 'lessons', scope: 'class', link: NOTIFICATION_LINKS.lessons },
  'lesson.rescheduled': { category: 'lessons', scope: 'class', link: NOTIFICATION_LINKS.lessons },
  'attendance.absent': { category: 'lessons', scope: 'student', link: NOTIFICATION_LINKS.lessons },
  'assignment.published': { category: 'assignments', scope: 'class', link: NOTIFICATION_LINKS.assignments },
  'submission.graded': { category: 'assignments', scope: 'student', link: NOTIFICATION_LINKS.assignments },
  'submission.returned': { category: 'assignments', scope: 'student', link: NOTIFICATION_LINKS.assignments },
  'exam.scheduled': { category: 'exams', scope: 'class', link: NOTIFICATION_LINKS.exams },
  'exam.results_published': { category: 'exams', scope: 'student', link: NOTIFICATION_LINKS.exams },
  'grades.finalized': { category: 'grades', scope: 'student', link: NOTIFICATION_LINKS.grades },
  'certificate.issued': { category: 'grades', scope: 'student', link: NOTIFICATION_LINKS.certificates },
  'certificate.revoked': { category: 'grades', scope: 'student', link: NOTIFICATION_LINKS.certificates },
  'invoice.issued': { category: 'finance', scope: 'student', link: NOTIFICATION_LINKS.invoices },
  'invoice.cancelled': { category: 'finance', scope: 'student', link: NOTIFICATION_LINKS.invoices },
  'payment.recorded': { category: 'finance', scope: 'student', link: NOTIFICATION_LINKS.invoices },
  'payment.reversed': { category: 'finance', scope: 'student', link: NOTIFICATION_LINKS.invoices },
} as const satisfies Record<NotificationEventKey, EventDefinition>;

export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEventKey[];

export type ClassEventKey = { [K in NotificationEventKey]: (typeof NOTIFICATION_EVENTS)[K]['scope'] extends 'class' ? K : never }[NotificationEventKey];
export type StudentEventKey = Exclude<NotificationEventKey, ClassEventKey>;

/** The six categories in the order the settings screen lists them (the declared order of the enum). */
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = ['lessons', 'assignments', 'exams', 'grades', 'finance', 'announcements'];

/**
 * `data` of a notification: the frontend path and the ids of the event —
 * never a name, a score, an amount or a text (D-R83). `studentIds` names the
 * children a guardian's copy of a class event is about when there are several
 * (a single student is the row's own `student_user_id`).
 */
export function notificationData(key: NotificationEventKey, params: object, studentIds: readonly string[] = []): Record<string, string | string[]> {
  const data: Record<string, string | string[]> = { link: NOTIFICATION_EVENTS[key].link };
  for (const [name, value] of Object.entries(params)) {
    if (name.endsWith('Id') && typeof value === 'string') data[name] = value;
  }
  if (studentIds.length > 1) data['studentIds'] = [...studentIds];
  return data;
}
