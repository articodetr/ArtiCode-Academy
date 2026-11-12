// Who a manual announcement is sent to (MOD-12-T05; owner decision D-R85;
// roadmap §4j.4 API-173..175) as pure rules — unit-tested in
// announcements.audience.spec.ts, no database and no framework behind them.
//
// An audience has one of two shapes; it is stored in `announcements.audience`
// and recorded in the audit event exactly as `checkAudience()` normalises it:
//
//   { kind: 'class', classId, students, guardians, teachers }
//       the three groups always spelled out, at least one of them true:
//       students  = the users with an `active` enrollment in the class
//       guardians = the guardians of those students (a link AND the `guardian` role)
//       teachers  = the teachers of the class, lead and assistants
//   { kind: 'academy', roleKeys }
//       1..4 distinct keys out of student / guardian / teacher / staff, in
//       that order: everyone who holds one of the roles
//
// Whatever the shape, a recipient is an `active`, not soft-deleted account,
// is counted once however many groups or roles they belong to, and is never
// the sender (`mergeRecipients()`). A class audience is open to whoever may
// announce to the class — a teacher of it, or a holder of `classes.manage`
// (D-R16); an academy audience needs `classes.manage` on top of
// `notifications.send`. The sender reads their own announcements, a holder
// of `classes.manage` all of them.
import type { AuthPrincipal } from '../auth/principal.js';
import { MANAGE_CLASSES_PERMISSION, canManageClasses } from '../classes/classes.policy.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ANNOUNCEMENT_MAX_RECIPIENTS } from './notifications.errors.js';
import { NOTIFICATION_LINKS } from './notifications.events.js';

/** The key of the three announcement routes (the teacher and the academy admin hold it by seed). */
export const SEND_NOTIFICATIONS_PERMISSION = 'notifications.send';

export const ANNOUNCEMENT_AUDIENCE_KINDS = ['class', 'academy'] as const;
export type AnnouncementAudienceKind = (typeof ANNOUNCEMENT_AUDIENCE_KINDS)[number];

/** The system roles an academy audience may name, in the order a normalised audience lists them. */
export const ANNOUNCEMENT_ROLE_KEYS = ['student', 'guardian', 'teacher', 'staff'] as const;
export type AnnouncementRoleKey = (typeof ANNOUNCEMENT_ROLE_KEYS)[number];

export interface ClassAudience {
  kind: 'class';
  classId: string;
  students: boolean;
  guardians: boolean;
  teachers: boolean;
}

export interface AcademyAudience {
  kind: 'academy';
  roleKeys: AnnouncementRoleKey[];
}

export type AnnouncementAudience = ClassAudience | AcademyAudience;

/**
 * What `audience_invalid { problems }` names:
 *
 *   kind_unknown              `kind` is neither `class` nor `academy`
 *   class_id_required         a class audience without `classId`
 *   recipient_group_required  a class audience with none of `students` / `guardians` / `teachers` true
 *   role_keys_not_allowed     a class audience that carries `roleKeys`
 *   class_fields_not_allowed  an academy audience that carries `classId`, `students`, `guardians` or `teachers`
 *   role_keys_required        an academy audience without a role key
 *   role_keys_unknown         a key other than student / guardian / teacher / staff
 *   role_keys_duplicate       the same key twice
 */
export const AUDIENCE_PROBLEMS = [
  'kind_unknown',
  'class_id_required',
  'recipient_group_required',
  'role_keys_not_allowed',
  'class_fields_not_allowed',
  'role_keys_required',
  'role_keys_unknown',
  'role_keys_duplicate',
] as const;
export type AudienceProblem = (typeof AUDIENCE_PROBLEMS)[number];

/** The audience as a request carries it, after the DTO checked the types of its fields. */
export interface AudienceInput {
  kind?: unknown;
  classId?: unknown;
  students?: unknown;
  guardians?: unknown;
  teachers?: unknown;
  roleKeys?: unknown;
}

export type AudienceCheck = { audience: AnnouncementAudience; problems: [] } | { audience: null; problems: AudienceProblem[] };

/** A field counts as carried when it is there at all — `false` and `[]` included; `null` is "absent", as in every DTO. */
function carried(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isRoleKey(value: unknown): value is AnnouncementRoleKey {
  return typeof value === 'string' && (ANNOUNCEMENT_ROLE_KEYS as readonly string[]).includes(value);
}

/**
 * The rules an audience breaks, or the audience in its normalised form: a
 * class audience with its id in lower case and its three groups spelled out,
 * an academy audience with its role keys in the fixed order. Every problem of
 * the request is named at once; an unknown kind is the only one that hides
 * the others (there is nothing to judge the fields against).
 */
export function checkAudience(input: AudienceInput): AudienceCheck {
  const problems: AudienceProblem[] = [];
  if (input.kind === 'class') {
    const classId = typeof input.classId === 'string' && input.classId.length > 0 ? input.classId.toLowerCase() : null;
    const students = input.students === true;
    const guardians = input.guardians === true;
    const teachers = input.teachers === true;
    if (classId === null) problems.push('class_id_required');
    if (!students && !guardians && !teachers) problems.push('recipient_group_required');
    if (carried(input.roleKeys)) problems.push('role_keys_not_allowed');
    if (classId === null || problems.length > 0) return { audience: null, problems };
    return { audience: { kind: 'class', classId, students, guardians, teachers }, problems: [] };
  }
  if (input.kind === 'academy') {
    const keys: unknown[] = Array.isArray(input.roleKeys) ? input.roleKeys : [];
    if ([input.classId, input.students, input.guardians, input.teachers].some(carried)) problems.push('class_fields_not_allowed');
    if (keys.length === 0) problems.push('role_keys_required');
    if (keys.some((key) => !isRoleKey(key))) problems.push('role_keys_unknown');
    if (new Set(keys).size !== keys.length) problems.push('role_keys_duplicate');
    if (problems.length > 0) return { audience: null, problems };
    return { audience: { kind: 'academy', roleKeys: ANNOUNCEMENT_ROLE_KEYS.filter((key) => keys.includes(key)) }, problems: [] };
  }
  return { audience: null, problems: ['kind_unknown'] };
}

/** `announcements.audience` read back; null for a value this module never wrote. */
export function readAudience(value: unknown): AnnouncementAudience | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return checkAudience(value as AudienceInput).audience;
}

/**
 * An academy-wide announcement needs `classes.manage` on top of
 * `notifications.send` (D-R85): the keys to report as missing, or null.
 */
export function academyAudienceMissing(permissions: readonly string[]): string[] | null {
  return canManageClasses(permissions) ? null : [MANAGE_CLASSES_PERMISSION];
}

/** The announcements a caller reads (API-174/175): their own; all of them with `classes.manage`. */
export function visibleAnnouncementsWhere(caller: Pick<AuthPrincipal, 'id' | 'permissions'>): Prisma.AnnouncementWhereInput {
  return canManageClasses(caller.permissions) ? {} : { senderUserId: caller.id };
}

/**
 * The recipients of an announcement from the members of its groups: each
 * person once — in the order of their first appearance, so the students of a
 * class come before their guardians and its teachers — and never the sender,
 * whatever group they belong to.
 */
export function mergeRecipients<T extends { id: string }>(groups: ReadonlyArray<readonly T[]>, senderId: string): T[] {
  const byId = new Map<string, T>();
  for (const group of groups) {
    for (const member of group) {
      if (member.id !== senderId && !byId.has(member.id)) byId.set(member.id, member);
    }
  }
  return [...byId.values()];
}

/** More recipients than one announcement may reach (D-R85: 5,000). */
export function exceedsRecipientLimit(recipients: number, max: number = ANNOUNCEMENT_MAX_RECIPIENTS): boolean {
  return recipients > max;
}

/**
 * `data` of an announcement's notifications: the notifications page (an
 * announcement has no page of its own) and ids only, like every other
 * notification (D-R83).
 */
export function announcementData(announcementId: string, classId: string | null): Record<string, string> {
  return { link: NOTIFICATION_LINKS.notifications, announcementId, ...(classId === null ? {} : { classId }) };
}
