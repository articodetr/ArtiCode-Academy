import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { ACADEMY_ADMIN_ROLE_KEY } from '../authorization/system-roles.js';
import type { KindRoleKey } from '../authorization/system-roles.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { authError } from '../auth/auth.errors.js';
import { Prisma } from '../generated/prisma/client.js';
import type { EmployeeKind } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isEmptyPatch, planUserUpdate } from './users.changes.js';
import { decodeUserCursor, encodeUserCursor } from './users.cursor.js';
import type { SortOrder, UserCursor, UserSortField } from './users.cursor.js';
import { USERS_PAGE_DEFAULT } from './users.dto.js';
import type {
  ChangeUserStatusDto,
  CreateUserDto,
  DeleteUserDto,
  GuardianLinkDto,
  ListUsersQueryDto,
  ReplaceUserRolesDto,
  UpdateUserDto,
  UserDetailDto,
  UserListDto,
  UserListItemDto,
  UserRoleSummaryDto,
} from './users.dto.js';
import { usersError } from './users.errors.js';
import {
  ASSIGN_ROLES_PERMISSION,
  DEACTIVATE_USERS_PERMISSION,
  activePermissionKeys,
  exceedingPermissions,
  extraRoleKeys,
  extraRoleProfileProblem,
  profileKindFor,
} from './users.policy.js';
import type { RoleGrants } from './users.policy.js';
import { SELF_FORBIDDEN_ROLES_ACTION, diffRoleKeys, planProfiles, removesAcademyAdmin } from './users.roles.js';
import {
  accountState,
  allowedActions,
  isSelfForbidden,
  nextStatus,
  removesActiveAccount,
  revokesSessions,
} from './users.status.js';
import type { AccountAction } from './users.status.js';
import { calendarDateToDate, escapeLikePattern } from './users.validation.js';

/**
 * How much of a user a caller may see (D-R07): `full` for holders of
 * `users.read_contact`, `reduced` for plain `users.read` — no e-mail, username,
 * phone or account-security timestamps, and no search on e-mail/username (a
 * substring search would otherwise leak them character by character).
 */
export type UsersProjection = 'full' | 'reduced';

export const USERS_AUDIT_ACTIONS = {
  created: 'users.created',
  updated: 'users.updated',
  /** T06: every status action (`activate`/`suspend`/`archive`/`restore`/`unlock`), metadata `{ action, from, to, reason, … }`. */
  statusChanged: 'users.status.changed',
  /** T06: soft delete, metadata `{ from, to: 'archived', reason, revokedSessions }`. */
  deleted: 'users.deleted',
  /** T07: role replacement, metadata `{ added, removed, roles, profilesCreated? }` (keys only). */
  rolesChanged: 'users.roles.changed',
} as const;

// Explicit projections: the password hash and the login counters are never
// even read from the database for these endpoints.
const SUMMARY_SELECT = {
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
} satisfies Prisma.UserSelect;

const LIST_SELECT = {
  ...SUMMARY_SELECT,
  roles: { select: { role: { select: { key: true } } } },
} satisfies Prisma.UserSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  roles: { select: { role: { select: { key: true, label: true } } } },
  studentProfile: { select: { studentNumber: true, dateOfBirth: true, enrolledOn: true } },
  employeeProfile: {
    select: { employeeNumber: true, kind: true, jobTitle: true, specialization: true, hiredOn: true, isActive: true },
  },
  guardians: {
    select: { relationship: true, isPrimary: true, guardian: { select: { id: true, fullName: true, displayName: true } } },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
  guardianOf: {
    select: { relationship: true, isPrimary: true, student: { select: { id: true, fullName: true, displayName: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.UserSelect;

const ROLE_GRANT_SELECT = {
  id: true,
  key: true,
  permissions: { select: { permissionKey: true, permission: { select: { deprecatedAt: true } } } },
} satisfies Prisma.RoleSelect;

// What a PATCH compares against (users.changes.ts) plus the roles for SEC-R-15.
const CURRENT_SELECT = {
  email: true,
  username: true,
  phone: true,
  fullName: true,
  fullNameLatin: true,
  displayName: true,
  avatarUrl: true,
  locale: true,
  emailVerifiedAt: true,
  studentProfile: { select: { studentNumber: true, dateOfBirth: true, enrolledOn: true, notes: true } },
  employeeProfile: { select: { employeeNumber: true, jobTitle: true, specialization: true, hiredOn: true } },
  roles: { select: { role: { select: ROLE_GRANT_SELECT } } },
} satisfies Prisma.UserSelect;

// What a status change (users.status.ts) decides on, plus the roles for SEC-R-17 and the last-admin rule.
const STATE_SELECT = {
  id: true,
  status: true,
  deletedAt: true,
  lockedUntil: true,
  failedLoginCount: true,
  roles: { select: { role: { select: ROLE_GRANT_SELECT } } },
} satisfies Prisma.UserSelect;

// What a role replacement (users.roles.ts) decides on: the grants for the diff
// and SEC-R-16/17, the profiles for completion, the status for the admin quorum.
const ROLES_TARGET_SELECT = {
  id: true,
  status: true,
  deletedAt: true,
  roles: { select: { role: { select: ROLE_GRANT_SELECT } } },
  studentProfile: { select: { userId: true } },
  employeeProfile: { select: { kind: true } },
} satisfies Prisma.UserSelect;

type SummaryRow = Prisma.UserGetPayload<{ select: typeof SUMMARY_SELECT }>;
type ListRow = Prisma.UserGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.UserGetPayload<{ select: typeof DETAIL_SELECT }>;
type StateRow = Prisma.UserGetPayload<{ select: typeof STATE_SELECT }>;
type RolesTargetRow = Prisma.UserGetPayload<{ select: typeof ROLES_TARGET_SELECT }>;
type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_GRANT_SELECT }>;

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** `@db.Date` columns arrive as midnight UTC; only the calendar day is meaningful. */
function dayOrNull(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function asLocalizedText(value: Prisma.JsonValue, fallback: string): LocalizedText {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value['ar'] === 'string') {
    return value as LocalizedText;
  }
  return { ar: fallback };
}

function toSummary(row: SummaryRow, view: UsersProjection) {
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
  };
}

function toListItem(row: ListRow, view: UsersProjection): UserListItemDto {
  return { ...toSummary(row, view), roles: row.roles.map((grant) => grant.role.key).sort() };
}

function toDetail(row: DetailRow, view: UsersProjection): UserDetailDto {
  const roles: UserRoleSummaryDto[] = row.roles
    .map((grant) => ({ key: grant.role.key, label: asLocalizedText(grant.role.label, grant.role.key) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const guardians: GuardianLinkDto[] = row.guardians.map((link) => ({
    userId: link.guardian.id,
    fullName: link.guardian.fullName,
    displayName: link.guardian.displayName,
    relationship: link.relationship,
    isPrimary: link.isPrimary,
  }));
  const students: GuardianLinkDto[] = row.guardianOf.map((link) => ({
    userId: link.student.id,
    fullName: link.student.fullName,
    displayName: link.student.displayName,
    relationship: link.relationship,
    isPrimary: link.isPrimary,
  }));
  return {
    ...toSummary(row, view),
    roles,
    studentProfile: row.studentProfile
      ? {
          studentNumber: row.studentProfile.studentNumber,
          dateOfBirth: dayOrNull(row.studentProfile.dateOfBirth),
          enrolledOn: dayOrNull(row.studentProfile.enrolledOn),
        }
      : null,
    employeeProfile: row.employeeProfile
      ? {
          employeeNumber: row.employeeProfile.employeeNumber,
          kind: row.employeeProfile.kind,
          jobTitle: row.employeeProfile.jobTitle,
          specialization: row.employeeProfile.specialization,
          hiredOn: dayOrNull(row.employeeProfile.hiredOn),
          isActive: row.employeeProfile.isActive,
        }
      : null,
    guardians,
    students,
  };
}

/** Rows strictly after the cursor row in the requested order. */
function keysetClause(cursor: UserCursor): Prisma.UserWhereInput {
  const after = <T>(value: T): { lt: T } | { gt: T } => (cursor.order === 'desc' ? { lt: value } : { gt: value });
  if (cursor.sort === 'createdAt') return { id: after(cursor.id) };
  const name = cursor.key ?? '';
  return { OR: [{ fullName: after(name) }, { fullName: name, id: after(cursor.id) }] };
}

function searchClause(q: string, view: UsersProjection): Prisma.UserWhereInput {
  const match = { contains: escapeLikePattern(q), mode: 'insensitive' } as const;
  const fields: Prisma.UserWhereInput[] = [{ fullName: match }, { fullNameLatin: match }, { displayName: match }];
  if (view === 'full') fields.push({ email: match }, { username: match });
  return { OR: fields };
}

function orderBy(sort: UserSortField, order: SortOrder): Prisma.UserOrderByWithRelationInput[] {
  return sort === 'createdAt' ? [{ id: order }] : [{ fullName: order }, { id: order }];
}

interface DriverAdapterCause {
  constraint?: { index?: string; fields?: string[] };
  originalMessage?: string;
}

/**
 * Which unique constraint a P2002 names. The query engine reports `meta.target`
 * (field names); the driver adapter (Prisma 7 + pg) reports the index name and
 * the PostgreSQL message under `meta.driverAdapterError.cause`. Both are joined.
 */
function uniqueTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const meta = (error.meta ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const target = meta['target'];
  if (Array.isArray(target)) parts.push(target.join(','));
  else if (typeof target === 'string') parts.push(target);
  const cause = (meta['driverAdapterError'] as { cause?: DriverAdapterCause } | undefined)?.cause;
  if (cause?.constraint?.index) parts.push(cause.constraint.index);
  if (Array.isArray(cause?.constraint?.fields)) parts.push(cause.constraint.fields.join(','));
  if (typeof cause?.originalMessage === 'string') parts.push(cause.originalMessage);
  return parts.join(' ');
}

/**
 * MOD-03 — user management. Permission checks (`users.read`, `users.read_contact`
 * for the full projection, `users.deactivate` for soft-deleted rows and status
 * changes, `users.create`, `users.update`) are enforced by the controller and
 * the global guards; the service shapes queries and responses and applies the
 * role policy (users.policy.ts) and the account state machine
 * (users.status.ts) inside one transaction per write.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQueryDto, view: UsersProjection): Promise<UserListDto> {
    const sort: UserSortField = query.sort ?? 'createdAt';
    const order: SortOrder = query.order ?? (sort === 'createdAt' ? 'desc' : 'asc');
    const limit = query.limit ?? USERS_PAGE_DEFAULT;
    const cursor = query.cursor ? decodeUserCursor(query.cursor, sort, order) : null;

    const conditions: Prisma.UserWhereInput[] = [];
    if (!query.includeDeleted) conditions.push({ deletedAt: null });
    if (query.status) conditions.push({ status: query.status });
    if (query.role) conditions.push({ roles: { some: { role: { key: query.role } } } });
    if (query.q) conditions.push(searchClause(query.q, view));
    if (cursor) conditions.push(keysetClause(cursor));

    // One row more than the page tells whether a next page exists.
    const rows = await this.prisma.db.user.findMany({
      where: conditions.length > 0 ? { AND: conditions } : undefined,
      orderBy: orderBy(sort, order),
      take: limit + 1,
      select: LIST_SELECT,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeUserCursor({ sort, order, key: sort === 'fullName' ? last.fullName : null, id: last.id })
        : null;
    return { items: page.map((row) => toListItem(row, view)), nextCursor };
  }

  /** Throws `user_not_found` (404) for unknown ids and, unless `includeDeleted`, for soft-deleted users. */
  async getById(id: string, includeDeleted: boolean, view: UsersProjection): Promise<UserDetailDto> {
    const row = await this.prisma.db.user.findFirst({
      where: includeDeleted ? { id } : { id, deletedAt: null },
      select: DETAIL_SELECT,
    });
    if (!row) throw usersError.userNotFound();
    return toDetail(row, view);
  }

  // ------------------------------------------------------------- create

  /**
   * MOD-03-T02: creates the account (`status = invited`, no password), its
   * profile and its roles in one transaction with the audit event; the account
   * cannot sign in until an invitation is accepted (T03). Returns the full
   * detail — the caller supplied the identifiers it contains.
   */
  async create(input: CreateUserDto, caller: AuthPrincipal, ctx: RequestContext): Promise<UserDetailDto> {
    const kind: KindRoleKey = input.kind;
    const email = input.email ?? null;
    const username = input.username ?? null;
    if (!email && !username) throw usersError.identifierRequired();

    const profile = profileKindFor(kind);
    if (input.studentProfile && profile !== 'student') {
      throw usersError.profileMismatch(`studentProfile is only accepted with kind "student" (got "${kind}")`);
    }
    if (input.employeeProfile && profile !== 'employee') {
      throw usersError.profileMismatch(`employeeProfile is only accepted with kind "teacher" or "staff" (got "${kind}")`);
    }

    // Roles: the kind's own system role plus optional extras (users.roles.assign).
    const extras = extraRoleKeys(kind, input.roleKeys);
    if (extras.length > 0 && !caller.permissions.includes(ASSIGN_ROLES_PERMISSION)) {
      throw authError.permissionDenied([ASSIGN_ROLES_PERMISSION]);
    }
    const profileProblem = extraRoleProfileProblem(kind, extras);
    if (profileProblem?.code === 'profile_mismatch') {
      throw usersError.profileMismatch(
        `role "${profileProblem.roleKey}" needs a student profile: create the user with kind "student" (roles are completed in a later task)`,
      );
    }
    if (profileProblem?.code === 'employee_kind_required') throw usersError.employeeKindRequired(profileProblem.roleKeys);

    const roleKeys = [kind, ...extras];
    const roles = await this.prisma.db.role.findMany({ where: { key: { in: roleKeys } }, select: ROLE_GRANT_SELECT });
    const unknown = roleKeys.filter((key) => !roles.some((role) => role.key === key));
    if (unknown.length > 0) throw usersError.roleUnknown(unknown);

    // No exceeding the creator: every active permission the roles confer must be
    // held by the caller, apart from the learner baseline (users.policy.ts).
    const exceeding = exceedingPermissions(activePermissionKeys(roles), caller.permissions);
    if (exceeding.length > 0) throw authError.permissionDenied(exceeding);

    // Friendly 409 before the transaction; the unique indexes (which also cover
    // soft-deleted rows) remain the source of truth for concurrent requests.
    const clash = await this.prisma.db.user.findFirst({
      where: { OR: [...(email ? [{ email }] : []), ...(username ? [{ username }] : [])] },
      select: { email: true, username: true },
    });
    if (clash) throw clash.email === email && email ? usersError.emailInUse() : usersError.usernameInUse();

    const sortedRoleKeys = [...roleKeys].sort();
    let userId: string;
    try {
      userId = await this.prisma.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            username,
            phone: input.phone ?? null,
            fullName: input.fullName,
            fullNameLatin: input.fullNameLatin ?? null,
            displayName: input.displayName ?? null,
            locale: input.locale ?? null,
            status: 'invited',
            passwordHash: null,
            roles: { create: roles.map((role) => ({ roleId: role.id, assignedById: caller.id })) },
            studentProfile:
              profile === 'student'
                ? {
                    create: {
                      studentNumber: input.studentProfile?.studentNumber ?? null,
                      dateOfBirth: input.studentProfile?.dateOfBirth ? calendarDateToDate(input.studentProfile.dateOfBirth) : null,
                      enrolledOn: input.studentProfile?.enrolledOn ? calendarDateToDate(input.studentProfile.enrolledOn) : null,
                      notes: input.studentProfile?.notes ?? null,
                    },
                  }
                : undefined,
            employeeProfile:
              profile === 'employee'
                ? {
                    create: {
                      kind: kind as EmployeeKind,
                      employeeNumber: input.employeeProfile?.employeeNumber ?? null,
                      jobTitle: input.employeeProfile?.jobTitle ?? null,
                      specialization: input.employeeProfile?.specialization ?? null,
                      hiredOn: input.employeeProfile?.hiredOn ? calendarDateToDate(input.employeeProfile.hiredOn) : null,
                    },
                  }
                : undefined,
          },
          select: { id: true },
        });
        // Identifiers and non-sensitive values only: no e-mail, phone or names.
        await this.audit.record(
          {
            action: USERS_AUDIT_ACTIONS.created,
            actorUserId: caller.id,
            entityType: 'users',
            entityId: user.id,
            metadata: { kind, roles: sortedRoleKeys, profile },
            ...ctx,
          },
          tx,
        );
        return user.id;
      });
    } catch (error) {
      throw translateUniqueViolation(error);
    }

    return this.getById(userId, false, 'full');
  }

  // ------------------------------------------------------------- update

  /**
   * MOD-03-T04: partial update of the identity, the preferences and the
   * profile the user already has. Only fields whose value changes are written,
   * in one transaction with the audit event `users.updated` whose metadata
   * names the fields and never carries values; an idempotent PATCH writes
   * nothing. Changing the e-mail drops its verification. Changing `email` or
   * `username` of a user whose roles confer permissions the caller lacks is
   * refused (SEC-R-15): with manual token delivery, whoever controls the login
   * identifiers can complete a password reset for that account.
   */
  async update(
    id: string,
    input: UpdateUserDto,
    caller: AuthPrincipal,
    ctx: RequestContext,
    view: UsersProjection,
  ): Promise<UserDetailDto> {
    if (isEmptyPatch(input)) throw usersError.nothingToUpdate();
    const current = await this.prisma.db.user.findFirst({ where: { id, deletedAt: null }, select: CURRENT_SELECT });
    if (!current) throw usersError.userNotFound();

    const plan = planUserUpdate(current, input);
    if (plan.kind === 'profile_mismatch') {
      throw usersError.profileMismatch(
        plan.profile === 'student'
          ? 'studentProfile: this user has no student profile'
          : 'employeeProfile: this user has no employee profile',
      );
    }
    if (plan.kind === 'identifier_required') throw usersError.identifierRequired();
    if (plan.fields.length === 0) return this.getById(id, false, view);

    if (plan.identifierChanged) {
      const conferred = activePermissionKeys(current.roles.map((grant) => grant.role));
      const exceeding = exceedingPermissions(conferred, caller.permissions);
      if (exceeding.length > 0) throw authError.permissionDenied(exceeding);
    }

    // Friendly 409 before the transaction; the unique indexes (which also cover
    // soft-deleted rows) remain the source of truth for concurrent requests.
    const identifiers: Prisma.UserWhereInput[] = [];
    if (typeof plan.user.email === 'string') identifiers.push({ email: plan.user.email });
    if (typeof plan.user.username === 'string') identifiers.push({ username: plan.user.username });
    if (identifiers.length > 0) {
      const clash = await this.prisma.db.user.findFirst({
        where: { OR: identifiers, NOT: { id } },
        select: { email: true, username: true },
      });
      if (clash) {
        throw clash.email !== null && clash.email === plan.user.email ? usersError.emailInUse() : usersError.usernameInUse();
      }
    }

    try {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: {
            ...plan.user,
            studentProfile: plan.studentProfile ? { update: plan.studentProfile } : undefined,
            employeeProfile: plan.employeeProfile ? { update: plan.employeeProfile } : undefined,
          },
          select: { id: true },
        });
        // Field names only — never the old or new values.
        await this.audit.record(
          {
            action: USERS_AUDIT_ACTIONS.updated,
            actorUserId: caller.id,
            entityType: 'users',
            entityId: id,
            metadata: { fields: plan.fields },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateUniqueViolation(error);
    }

    return this.getById(id, false, view);
  }

  // ------------------------------------------------------- status (T06)

  /**
   * MOD-03-T06: `activate` / `suspend` / `archive` / `restore` / `unlock`
   * (users.status.ts). `suspend` and `archive` revoke every refresh token in
   * the same transaction; the access tokens die at the next request through
   * the session gate of AuthService. An `unlock` with nothing to clear is a
   * no-op (200, nothing written, no event).
   */
  changeStatus(
    id: string,
    input: ChangeUserStatusDto,
    caller: AuthPrincipal,
    ctx: RequestContext,
    view: UsersProjection,
  ): Promise<UserDetailDto> {
    return this.transition(id, input.action, input.reason ?? null, caller, ctx, view);
  }

  /**
   * MOD-03-T06: soft delete — `deleted_at = now()` and `status = archived`,
   * every refresh token revoked, one `users.deleted` event. The row stays
   * (history refers to it) and its e-mail/username remain reserved by the
   * unique indexes. Nothing applies to a deleted account afterwards.
   */
  softDelete(id: string, input: DeleteUserDto, caller: AuthPrincipal, ctx: RequestContext, view: UsersProjection): Promise<UserDetailDto> {
    return this.transition(id, 'delete', input.reason ?? null, caller, ctx, view);
  }

  /**
   * Order of the checks: 404 (unknown, or soft-deleted for a caller who may
   * not see deleted users) → 403 `permission_denied` when the target's roles
   * confer a permission the caller lacks (SEC-R-17) → 403 `self_forbidden` →
   * 409 `invalid_transition` → inside the transaction 409 `last_admin`.
   * The status is written with a conditional update, so a concurrent change
   * makes the loser fail with `invalid_transition` instead of overwriting.
   */
  private async transition(
    id: string,
    action: AccountAction,
    reason: string | null,
    caller: AuthPrincipal,
    ctx: RequestContext,
    view: UsersProjection,
  ): Promise<UserDetailDto> {
    const target = await this.loadStateTarget(id, caller);
    if (isSelfForbidden(action) && target.id === caller.id) throw usersError.selfForbidden(action);
    const from = accountState(target);
    const to = nextStatus(action, from);
    if (to === null) throw usersError.invalidTransition(from, action, allowedActions(from));
    if (action === 'unlock' && target.lockedUntil === null && target.failedLoginCount === 0) {
      return this.getById(id, false, view);
    }

    const isAdmin = target.roles.some((grant) => grant.role.key === ACADEMY_ADMIN_ROLE_KEY);
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      if (isAdmin && removesActiveAccount(action, from)) {
        // The active admins are locked for the rest of the transaction, so two
        // concurrent requests cannot each count the other and leave none (AC 3).
        const admins = await lockActiveAdmins(tx);
        if (!admins.some((admin) => admin.id !== target.id)) throw usersError.lastAdmin();
      }
      const updated = await tx.user.updateMany({
        where: { id, status: target.status, deletedAt: null },
        data: {
          status: to,
          ...(action === 'delete' ? { deletedAt: now } : {}),
          ...(action === 'unlock' ? { lockedUntil: null, failedLoginCount: 0 } : {}),
        },
      });
      if (updated.count !== 1) throw usersError.invalidTransition(from, action, allowedActions(from));

      let revokedSessions: number | null = null;
      if (revokesSessions(action)) {
        const revoked = await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
        revokedSessions = revoked.count;
      }
      // Identifiers and non-sensitive values only: the administrator's reason,
      // the cleared lock and the number of revoked sessions — never contact data.
      await this.audit.record(
        {
          action: action === 'delete' ? USERS_AUDIT_ACTIONS.deleted : USERS_AUDIT_ACTIONS.statusChanged,
          actorUserId: caller.id,
          entityType: 'users',
          entityId: id,
          metadata: {
            action,
            from,
            to,
            reason,
            ...(revokedSessions !== null ? { revokedSessions } : {}),
            ...(action === 'unlock' ? { lockedUntil: isoOrNull(target.lockedUntil), failedAttempts: target.failedLoginCount } : {}),
          },
          ...ctx,
        },
        tx,
      );
    });

    return this.getById(id, action === 'delete', view);
  }

  /**
   * The account a status action targets. A soft-deleted account is visible
   * (and so reported as `invalid_transition`) only to holders of
   * `users.deactivate`, as in the list and the detail; others get 404.
   * Authorisation before state (SEC-R-17): a caller who may not act on this
   * account learns nothing about it.
   */
  private async loadStateTarget(id: string, caller: AuthPrincipal): Promise<StateRow> {
    const user = await this.prisma.db.user.findUnique({ where: { id }, select: STATE_SELECT });
    if (!user || (user.deletedAt !== null && !caller.permissions.includes(DEACTIVATE_USERS_PERMISSION))) {
      throw usersError.userNotFound();
    }
    assertWithinReach(user.roles.map((grant) => grant.role), caller);
    return user;
  }

  // -------------------------------------------------------- roles (T07)

  /**
   * MOD-03-T07: `PUT /api/users/:id/roles` — the user ends up with exactly
   * `roleKeys` (users.roles.ts). Written as a diff in one transaction: grants
   * kept are untouched (their `assigned_by`/`assigned_at` stay), grants added
   * carry the caller as `assigned_by`, and a `student`/`teacher`/`staff` role
   * added to a user without the matching profile creates it (profiles are
   * never removed). One event `users.roles.changed`; a request that changes
   * no role writes nothing and records nothing. The new permissions apply at
   * the next request of the user, because the principal is read from the
   * database every time (ADR-024).
   *
   * Order of the checks: 404 (unknown or soft-deleted) → 403 `permission_denied`
   * when the target's roles confer a permission the caller lacks (SEC-R-17) →
   * 400 `role_unknown` → inside the transaction, on the locked row: SEC-R-17
   * again, 403 `permission_denied` for an added role the caller could not
   * confer (SEC-R-16), 403 `self_forbidden` when taking `academy_admin` from
   * oneself, 422 `employee_kind_required` / `profile_mismatch`, 200 no-op,
   * 409 `last_admin` when the target is the last active academy admin.
   */
  async replaceRoles(
    id: string,
    input: ReplaceUserRolesDto,
    caller: AuthPrincipal,
    ctx: RequestContext,
    view: UsersProjection,
  ): Promise<UserDetailDto> {
    const before = await this.loadRolesTarget(id, caller);
    const requestedKeys = [...new Set(input.roleKeys)].sort();
    const requested = requestedKeys.length > 0
      ? await this.prisma.db.role.findMany({ where: { key: { in: requestedKeys } }, select: ROLE_GRANT_SELECT })
      : [];
    const unknown = requestedKeys.filter((key) => !requested.some((role) => role.key === key));
    if (unknown.length > 0) throw usersError.roleUnknown(unknown);

    // Lock order (no deadlock with the status changes of T06): an active academy
    // admin is locked through the same admin scan as T06, anyone else through
    // their own row.
    const quorumMember = before.status === 'active' && holdsAcademyAdmin(before.roles);
    let added: string[] = [];
    try {
      await this.prisma.db.$transaction(async (tx) => {
        let admins = quorumMember ? await lockActiveAdmins(tx) : null;
        if (!quorumMember) await lockUserRow(tx, id);
        const target = await tx.user.findUnique({ where: { id }, select: ROLES_TARGET_SELECT });
        if (!target || target.deletedAt !== null) throw usersError.userNotFound();

        const current = target.roles.map((grant) => grant.role);
        assertWithinReach(current, caller);
        const diff = diffRoleKeys(current.map((role) => role.key), requestedKeys);
        const addedRoles = requested.filter((role) => diff.added.includes(role.key));
        assertWithinReach(addedRoles, caller);
        if (removesAcademyAdmin(diff) && target.id === caller.id) throw usersError.selfForbidden(SELF_FORBIDDEN_ROLES_ACTION);
        const profiles = planProfiles(
          diff.added,
          { hasStudentProfile: target.studentProfile !== null, employeeKind: target.employeeProfile?.kind ?? null },
          input.employeeKind,
        );
        if (profiles.kind === 'employee_kind_required') {
          throw usersError.employeeKindRequired(
            profiles.roleKeys,
            'Adding both employee roles to a user without an employee profile needs employeeKind ("teacher" or "staff")',
          );
        }
        if (profiles.kind === 'profile_mismatch') throw usersError.profileMismatch(profiles.detail);
        if (diff.added.length === 0 && diff.removed.length === 0) return;
        added = diff.added;

        if (removesAcademyAdmin(diff) && target.status === 'active') {
          // The active admins are locked for the rest of the transaction, so two
          // concurrent requests cannot each count the other and leave none (AC 2, 5).
          admins ??= await lockActiveAdmins(tx);
          if (!admins.some((admin) => admin.id !== target.id)) throw usersError.lastAdmin();
        }

        const removedRoleIds = current.filter((role) => diff.removed.includes(role.key)).map((role) => role.id);
        if (removedRoleIds.length > 0) await tx.userRole.deleteMany({ where: { userId: id, roleId: { in: removedRoleIds } } });
        if (addedRoles.length > 0) {
          await tx.userRole.createMany({ data: addedRoles.map((role) => ({ userId: id, roleId: role.id, assignedById: caller.id })) });
        }
        const profilesCreated: string[] = [];
        if (profiles.student) {
          await tx.studentProfile.create({ data: { userId: id }, select: { userId: true } });
          profilesCreated.push('student');
        }
        if (profiles.employee !== null) {
          await tx.employeeProfile.create({ data: { userId: id, kind: profiles.employee }, select: { userId: true } });
          profilesCreated.push('employee');
        }
        // The roles are part of the user as the list and the detail present it.
        await tx.user.update({ where: { id }, data: { updatedAt: new Date() }, select: { id: true } });
        // Role keys and profile kinds only — never contact data or names.
        await this.audit.record(
          {
            action: USERS_AUDIT_ACTIONS.rolesChanged,
            actorUserId: caller.id,
            entityType: 'users',
            entityId: id,
            metadata: {
              added: diff.added,
              removed: diff.removed,
              roles: requestedKeys,
              ...(profilesCreated.length > 0 ? { profilesCreated } : {}),
            },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateRoleGrantError(error, added);
    }
    return this.getById(id, false, view);
  }

  /**
   * The account whose roles are replaced: unknown or soft-deleted → 404 (as
   * PATCH — nothing applies to a deleted account). Authorisation before
   * anything else (SEC-R-17): a caller who may not act on this account learns
   * nothing about it, not even whether the requested keys exist.
   */
  private async loadRolesTarget(id: string, caller: AuthPrincipal): Promise<RolesTargetRow> {
    const user = await this.prisma.db.user.findFirst({ where: { id, deletedAt: null }, select: ROLES_TARGET_SELECT });
    if (!user) throw usersError.userNotFound();
    assertWithinReach(user.roles.map((grant) => grant.role), caller);
    return user;
  }
}

/**
 * The no-exceeding rule on a set of roles: every active permission they confer
 * must be held by the caller apart from the learner baseline (users.policy.ts),
 * else `403 permission_denied` naming the excess. Applied to the roles of a
 * target account (SEC-R-17) and to the roles a caller grants (SEC-R-16).
 */
function assertWithinReach(roles: readonly RoleGrants[], caller: AuthPrincipal): void {
  const exceeding = exceedingPermissions(activePermissionKeys(roles), caller.permissions);
  if (exceeding.length > 0) throw authError.permissionDenied(exceeding);
}

function holdsAcademyAdmin(grants: readonly { role: RoleRow }[]): boolean {
  return grants.some((grant) => grant.role.key === ACADEMY_ADMIN_ROLE_KEY);
}

/**
 * Locks one `users` row until the transaction ends. `FOR NO KEY UPDATE`
 * serialises concurrent writes to the account (a second role replacement, a
 * status change) without blocking the foreign-key checks of rows that merely
 * reference it (`user_roles.assigned_by`, `audit_logs.actor_user_id`).
 */
async function lockUserRow(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
}

/**
 * Ids of the active, non-deleted holders of `academy_admin`, locked
 * (`FOR UPDATE`) until the transaction ends. Two statements on purpose: under
 * READ COMMITTED a statement that waited for a lock re-evaluates only the
 * locked row itself (an admin suspended meanwhile is dropped), but keeps its
 * snapshot for every other table — so `academy_admin` grants a concurrent
 * role replacement (T07) removed meanwhile would still be seen. The second
 * statement starts a fresh snapshot and counts the rows the first one locked.
 */
async function lockActiveAdmins(tx: Prisma.TransactionClient): Promise<{ id: string }[]> {
  await tx.$queryRaw`
    SELECT u.id
    FROM users u
    WHERE u.status = 'active'
      AND u.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND r.key = ${ACADEMY_ADMIN_ROLE_KEY}
      )
    FOR UPDATE`;
  return tx.$queryRaw<{ id: string }[]>`
    SELECT u.id
    FROM users u
    WHERE u.status = 'active'
      AND u.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND r.key = ${ACADEMY_ADMIN_ROLE_KEY}
      )`;
}

/**
 * A role deleted between the lookup and the grant (T08 — `user_roles.role_id`
 * is `Restrict`, so the insert fails with P2003) reads as `400 role_unknown`
 * naming the added keys; anything else is rethrown.
 */
function translateRoleGrantError(error: unknown, addedKeys: readonly string[]): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003' && addedKeys.length > 0) {
    return usersError.roleUnknown(addedKeys);
  }
  return error;
}

/** Maps a unique-constraint violation raised by a concurrent insert to the matching 409; rethrows anything else. */
function translateUniqueViolation(error: unknown): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return error;
  const target = uniqueTarget(error);
  if (/email/i.test(target)) return usersError.emailInUse();
  if (/username/i.test(target)) return usersError.usernameInUse();
  if (/student_?number/i.test(target)) return usersError.studentNumberInUse();
  if (/employee_?number/i.test(target)) return usersError.employeeNumberInUse();
  return error;
}
