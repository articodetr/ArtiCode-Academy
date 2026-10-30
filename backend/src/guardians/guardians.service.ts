import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { authError } from '../auth/auth.errors.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UserListItemDto } from '../users/users.dto.js';
import { usersError } from '../users/users.errors.js';
import { activePermissionKeys, exceedingPermissions } from '../users/users.policy.js';
import type { UsersProjection } from '../users/users.service.js';
import type { GuardianLinkItemDto, GuardianLinkListDto, LinkGuardianDto, UpdateGuardianLinkDto } from './guardians.dto.js';
import { guardiansError } from './guardians.errors.js';
import type { LinkParty } from './guardians.errors.js';
import { GUARDIAN_ROLE_KEY, STUDENT_ROLE_KEY, holdsRole, isEmptyLinkPatch, planLinkUpdate } from './guardians.policy.js';

export const GUARDIANS_AUDIT_ACTIONS = {
  linked: 'guardians.linked',
  updated: 'guardians.updated',
  unlinked: 'guardians.unlinked',
} as const;

// The linked user as the users list shows it (UserListItemDto): the same
// explicit projection as users.service.ts — never the password hash, the login
// counters, `password_changed_at` or `must_change_password`. Kept here because
// users/ does not export its presenter; the two must stay identical (D-R07).
const LINKED_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  phone: true,
  fullName: true,
  fullNameLatin: true,
  displayName: true,
  avatarUrl: true,
  locale: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  roles: { select: { role: { select: { key: true } } } },
} satisfies Prisma.UserSelect;

const GUARDIAN_LINK_SELECT = {
  relationship: true,
  isPrimary: true,
  createdAt: true,
  guardian: { select: LINKED_USER_SELECT },
} satisfies Prisma.GuardianStudentSelect;

const STUDENT_LINK_SELECT = {
  relationship: true,
  isPrimary: true,
  createdAt: true,
  student: { select: LINKED_USER_SELECT },
} satisfies Prisma.GuardianStudentSelect;

// What the policy needs about each party: existence, soft-delete, role keys
// and the active permissions the roles confer (no-exceeding rule).
const PARTY_SELECT = {
  id: true,
  deletedAt: true,
  roles: {
    select: {
      role: { select: { key: true, permissions: { select: { permissionKey: true, permission: { select: { deprecatedAt: true } } } } } },
    },
  },
} satisfies Prisma.UserSelect;

const LINK_STATE_SELECT = { relationship: true, isPrimary: true } satisfies Prisma.GuardianStudentSelect;

type LinkedUserRow = Prisma.UserGetPayload<{ select: typeof LINKED_USER_SELECT }>;
type LinkRow = Pick<Prisma.GuardianStudentGetPayload<{ select: typeof GUARDIAN_LINK_SELECT }>, 'relationship' | 'isPrimary' | 'createdAt'>;
type PartyRow = Prisma.UserGetPayload<{ select: typeof PARTY_SELECT }>;

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** Mirrors `toListItem()` of users.service.ts: the reduced projection nulls the contact and security fields. */
function toLinkedUser(row: LinkedUserRow, view: UsersProjection): UserListItemDto {
  const full = view === 'full';
  return {
    id: row.id,
    email: full ? row.email : null,
    username: full ? row.username : null,
    phone: full ? row.phone : null,
    fullName: row.fullName,
    fullNameLatin: row.fullNameLatin,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    locale: row.locale,
    status: row.status,
    emailVerifiedAt: full ? isoOrNull(row.emailVerifiedAt) : null,
    lastLoginAt: full ? isoOrNull(row.lastLoginAt) : null,
    lockedUntil: full ? isoOrNull(row.lockedUntil) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: isoOrNull(row.deletedAt),
    roles: row.roles.map((grant) => grant.role.key).sort(),
  };
}

function toItem(user: LinkedUserRow, link: LinkRow, view: UsersProjection): GuardianLinkItemDto {
  return {
    user: toLinkedUser(user, view),
    relationship: link.relationship,
    isPrimary: link.isPrimary,
    createdAt: link.createdAt.toISOString(),
  };
}

/**
 * Name of the constraint a Prisma known error reports. The query engine puts
 * field names under `meta.target`; the pg driver adapter puts the index or
 * constraint name and the PostgreSQL message under `meta.driverAdapterError.cause`
 * (KI-036). Everything found is joined so a regex can look for either.
 */
function constraintOf(error: Prisma.PrismaClientKnownRequestError): string {
  const meta = (error.meta ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const target = meta['target'];
  if (Array.isArray(target)) parts.push(target.join(','));
  else if (typeof target === 'string') parts.push(target);
  const cause = (meta['driverAdapterError'] as { cause?: Record<string, unknown> } | undefined)?.cause;
  const constraint = cause?.['constraint'] as { index?: string; fields?: string[] } | undefined;
  if (constraint?.index) parts.push(constraint.index);
  if (Array.isArray(constraint?.fields)) parts.push(constraint.fields.join(','));
  if (typeof cause?.['originalMessage'] === 'string') parts.push(cause['originalMessage']);
  return parts.join(' ');
}

/**
 * Concurrent requests can beat the friendly checks: a duplicate pair raises
 * P2002 on the primary key; the database CHECK against self-links is the
 * backstop of the pre-check. Anything else is rethrown.
 */
function translateKnownError(error: unknown, studentId: string, guardianId: string): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
  const constraint = constraintOf(error);
  if (/ck_guardian_students_distinct/i.test(constraint)) return guardiansError.selfLink();
  if (error.code === 'P2002') return guardiansError.alreadyLinked(studentId, guardianId);
  return error;
}

/**
 * MOD-03-T09 — guardian ↔ student links (`guardian_students`). The global
 * guards enforce `users.read` (reads) and `guardians.link` (writes); the
 * service applies the policy (guardians.policy.ts): both parties exist and are
 * not soft-deleted, neither party's roles confer a permission the caller lacks
 * (SEC-R-18 — the same no-exceeding rule as creation, invitations, identifier
 * changes and role grants), the guardian holds `guardian` and the student
 * `student`, and a student has at most one primary guardian. Every write is
 * one transaction, serialised per student by a row lock on the student's
 * `users` row, with exactly one audit event whose metadata carries identifiers
 * and the link fields only.
 */
@Injectable()
export class GuardiansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- reads

  /** Guardians of a student: primary first, then by link creation. Links to soft-deleted guardians are hidden. */
  async listGuardians(studentId: string, view: UsersProjection): Promise<GuardianLinkListDto> {
    await this.assertVisible(studentId, 'student');
    const rows = await this.prisma.db.guardianStudent.findMany({
      where: { studentUserId: studentId, guardian: { deletedAt: null } },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: GUARDIAN_LINK_SELECT,
    });
    return { items: rows.map((row) => toItem(row.guardian, row, view)) };
  }

  /** Students of a guardian, by link creation. Links to soft-deleted students are hidden. */
  async listStudents(guardianId: string, view: UsersProjection): Promise<GuardianLinkListDto> {
    await this.assertVisible(guardianId, 'guardian');
    const rows = await this.prisma.db.guardianStudent.findMany({
      where: { guardianUserId: guardianId, student: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: STUDENT_LINK_SELECT,
    });
    return { items: rows.map((row) => toItem(row.student, row, view)) };
  }

  // ------------------------------------------------------------- link

  async link(
    studentId: string,
    input: LinkGuardianDto,
    caller: AuthPrincipal,
    ctx: RequestContext,
    view: UsersProjection,
  ): Promise<GuardianLinkItemDto> {
    const guardianId = input.guardianId;
    if (guardianId === studentId) throw guardiansError.selfLink();
    const { student, guardian } = await this.loadParties(studentId, guardianId, caller);
    if (!holdsRole(guardian, GUARDIAN_ROLE_KEY)) throw guardiansError.notAGuardian(guardianId);
    if (!holdsRole(student, STUDENT_ROLE_KEY)) throw guardiansError.notAStudent(studentId);

    // Friendly 409 before the transaction; the primary key is the source of
    // truth for concurrent requests (P2002 below).
    const existing = await this.prisma.db.guardianStudent.findUnique({
      where: { guardianUserId_studentUserId: { guardianUserId: guardianId, studentUserId: studentId } },
      select: { guardianUserId: true },
    });
    if (existing) throw guardiansError.alreadyLinked(studentId, guardianId);

    const isPrimary = input.isPrimary === true;
    try {
      await this.prisma.db.$transaction(async (tx) => {
        await this.lockStudent(tx, studentId);
        const demotedGuardianUserId = isPrimary ? await this.demotePrimary(tx, studentId, guardianId) : null;
        await tx.guardianStudent.create({
          data: { guardianUserId: guardianId, studentUserId: studentId, relationship: input.relationship, isPrimary },
          select: { guardianUserId: true },
        });
        await this.audit.record(
          {
            action: GUARDIANS_AUDIT_ACTIONS.linked,
            actorUserId: caller.id,
            entityType: 'users',
            entityId: studentId,
            metadata: {
              guardianUserId: guardianId,
              studentUserId: studentId,
              relationship: input.relationship,
              isPrimary,
              demotedGuardianUserId,
            },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, studentId, guardianId);
    }
    return this.getItem(studentId, guardianId, view);
  }

  // ------------------------------------------------------------- update

  /**
   * PATCH of `relationship` / `isPrimary`. Only what differs is written; an
   * idempotent PATCH writes nothing and records nothing. Promoting demotes the
   * student's current primary guardian in the same transaction; demoting
   * leaves the student without a primary guardian. The roles of the parties
   * are not re-checked: the link exists.
   */
  async update(
    studentId: string,
    guardianId: string,
    input: UpdateGuardianLinkDto,
    caller: AuthPrincipal,
    ctx: RequestContext,
    view: UsersProjection,
  ): Promise<GuardianLinkItemDto> {
    if (isEmptyLinkPatch(input)) throw usersError.nothingToUpdate();
    await this.loadParties(studentId, guardianId, caller);
    const current = await this.prisma.db.guardianStudent.findUnique({
      where: { guardianUserId_studentUserId: { guardianUserId: guardianId, studentUserId: studentId } },
      select: LINK_STATE_SELECT,
    });
    if (!current) throw guardiansError.linkNotFound(studentId, guardianId);

    const plan = planLinkUpdate(current, input);
    if (plan.fields.length === 0) return this.getItem(studentId, guardianId, view);

    const next = { ...current, ...plan.data };
    await this.prisma.db.$transaction(async (tx) => {
      await this.lockStudent(tx, studentId);
      const demotedGuardianUserId = plan.promote ? await this.demotePrimary(tx, studentId, guardianId) : null;
      await tx.guardianStudent.update({
        where: { guardianUserId_studentUserId: { guardianUserId: guardianId, studentUserId: studentId } },
        data: plan.data,
        select: { guardianUserId: true },
      });
      // Field names and the resulting link state — never names or contact data.
      await this.audit.record(
        {
          action: GUARDIANS_AUDIT_ACTIONS.updated,
          actorUserId: caller.id,
          entityType: 'users',
          entityId: studentId,
          metadata: {
            guardianUserId: guardianId,
            studentUserId: studentId,
            relationship: next.relationship,
            isPrimary: next.isPrimary,
            fields: plan.fields,
            demotedGuardianUserId,
          },
          ...ctx,
        },
        tx,
      );
    });
    return this.getItem(studentId, guardianId, view);
  }

  // ------------------------------------------------------------- unlink

  /** Deletes the row; the event keeps the link's last state because the row is gone. */
  async unlink(studentId: string, guardianId: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    await this.loadParties(studentId, guardianId, caller);
    const current = await this.prisma.db.guardianStudent.findUnique({
      where: { guardianUserId_studentUserId: { guardianUserId: guardianId, studentUserId: studentId } },
      select: LINK_STATE_SELECT,
    });
    if (!current) throw guardiansError.linkNotFound(studentId, guardianId);

    await this.prisma.db.$transaction(async (tx) => {
      await this.lockStudent(tx, studentId);
      // A concurrent unlink makes the count 0: the transaction then fails
      // without an event instead of recording an unlink that did nothing.
      const deleted = await tx.guardianStudent.deleteMany({ where: { guardianUserId: guardianId, studentUserId: studentId } });
      if (deleted.count === 0) throw guardiansError.linkNotFound(studentId, guardianId);
      await this.audit.record(
        {
          action: GUARDIANS_AUDIT_ACTIONS.unlinked,
          actorUserId: caller.id,
          entityType: 'users',
          entityId: studentId,
          metadata: {
            guardianUserId: guardianId,
            studentUserId: studentId,
            relationship: current.relationship,
            isPrimary: current.isPrimary,
          },
          ...ctx,
        },
        tx,
      );
    });
  }

  // ------------------------------------------------------------- helpers

  /** 404 for an unknown or soft-deleted user — reads do not require any role. */
  private async assertVisible(userId: string, party: LinkParty): Promise<void> {
    const user = await this.prisma.db.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
    if (!user) throw guardiansError.partyNotFound(party, userId);
  }

  /**
   * Both parties of a write, in one query. Authorisation before state: the
   * roles of neither party may confer an active permission the caller lacks
   * (learner baseline excepted — users.policy.ts), so a caller who may not act
   * on an account learns nothing about its links. Existence is checked first
   * (an unknown id is not a privileged account), the student before the guardian.
   */
  private async loadParties(studentId: string, guardianId: string, caller: AuthPrincipal): Promise<{ student: PartyRow; guardian: PartyRow }> {
    const rows = await this.prisma.db.user.findMany({
      where: { id: { in: [studentId, guardianId] }, deletedAt: null },
      select: PARTY_SELECT,
    });
    const student = rows.find((row) => row.id === studentId);
    if (!student) throw guardiansError.partyNotFound('student', studentId);
    const guardian = rows.find((row) => row.id === guardianId);
    if (!guardian) throw guardiansError.partyNotFound('guardian', guardianId);

    const conferred = new Set<string>([
      ...activePermissionKeys(student.roles.map((grant) => grant.role)),
      ...activePermissionKeys(guardian.roles.map((grant) => grant.role)),
    ]);
    const exceeding = exceedingPermissions(conferred, caller.permissions);
    if (exceeding.length > 0) throw authError.permissionDenied(exceeding);
    return { student, guardian };
  }

  /**
   * Serialises the link writes of one student: two requests promoting
   * different guardians at once would otherwise both pass the demotion step on
   * the same snapshot and the second would die on `uq_guardian_students_primary`.
   */
  private async lockStudent(tx: Prisma.TransactionClient, studentId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${studentId}::uuid FOR UPDATE`;
  }

  /** Clears the current primary guardian of the student (if any, other than `guardianId`); returns who was demoted. */
  private async demotePrimary(tx: Prisma.TransactionClient, studentId: string, guardianId: string): Promise<string | null> {
    const primary = await tx.guardianStudent.findFirst({
      where: { studentUserId: studentId, isPrimary: true, NOT: { guardianUserId: guardianId } },
      select: { guardianUserId: true },
    });
    if (!primary) return null;
    await tx.guardianStudent.update({
      where: { guardianUserId_studentUserId: { guardianUserId: primary.guardianUserId, studentUserId: studentId } },
      data: { isPrimary: false },
      select: { guardianUserId: true },
    });
    return primary.guardianUserId;
  }

  private async getItem(studentId: string, guardianId: string, view: UsersProjection): Promise<GuardianLinkItemDto> {
    const row = await this.prisma.db.guardianStudent.findUnique({
      where: { guardianUserId_studentUserId: { guardianUserId: guardianId, studentUserId: studentId } },
      select: GUARDIAN_LINK_SELECT,
    });
    if (!row) throw guardiansError.linkNotFound(studentId, guardianId);
    return toItem(row.guardian, row, view);
  }
}
