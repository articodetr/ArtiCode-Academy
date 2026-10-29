import { Injectable } from '@nestjs/common';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decodeUserCursor, encodeUserCursor } from './users.cursor.js';
import type { SortOrder, UserCursor, UserSortField } from './users.cursor.js';
import { USERS_PAGE_DEFAULT } from './users.dto.js';
import type {
  GuardianLinkDto,
  ListUsersQueryDto,
  UserDetailDto,
  UserListDto,
  UserListItemDto,
  UserRoleSummaryDto,
} from './users.dto.js';
import { usersError } from './users.errors.js';

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

type SummaryRow = Prisma.UserGetPayload<{ select: typeof SUMMARY_SELECT }>;
type ListRow = Prisma.UserGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.UserGetPayload<{ select: typeof DETAIL_SELECT }>;

/** `%`, `_` and `\` matched literally inside a LIKE/ILIKE pattern (PostgreSQL escape character `\`). */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

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

function toSummary(row: SummaryRow) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    phone: row.phone,
    fullName: row.fullName,
    fullNameLatin: row.fullNameLatin,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    locale: row.locale,
    status: row.status,
    emailVerifiedAt: isoOrNull(row.emailVerifiedAt),
    lastLoginAt: isoOrNull(row.lastLoginAt),
    lockedUntil: isoOrNull(row.lockedUntil),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: isoOrNull(row.deletedAt),
  };
}

function toListItem(row: ListRow): UserListItemDto {
  return { ...toSummary(row), roles: row.roles.map((grant) => grant.role.key).sort() };
}

function toDetail(row: DetailRow): UserDetailDto {
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
    ...toSummary(row),
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

function searchClause(q: string): Prisma.UserWhereInput {
  const match = { contains: escapeLikePattern(q), mode: 'insensitive' } as const;
  return {
    OR: [{ email: match }, { username: match }, { fullName: match }, { fullNameLatin: match }, { displayName: match }],
  };
}

function orderBy(sort: UserSortField, order: SortOrder): Prisma.UserOrderByWithRelationInput[] {
  return sort === 'createdAt' ? [{ id: order }] : [{ fullName: order }, { id: order }];
}

/**
 * MOD-03-T01 — read side of user management. Permission checks (`users.read`,
 * `users.deactivate` for soft-deleted rows) are enforced by the controller and
 * the global guards; this service only shapes the queries and the responses.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListUsersQueryDto): Promise<UserListDto> {
    const sort: UserSortField = query.sort ?? 'createdAt';
    const order: SortOrder = query.order ?? (sort === 'createdAt' ? 'desc' : 'asc');
    const limit = query.limit ?? USERS_PAGE_DEFAULT;
    const cursor = query.cursor ? decodeUserCursor(query.cursor, sort, order) : null;

    const conditions: Prisma.UserWhereInput[] = [];
    if (!query.includeDeleted) conditions.push({ deletedAt: null });
    if (query.status) conditions.push({ status: query.status });
    if (query.role) conditions.push({ roles: { some: { role: { key: query.role } } } });
    if (query.q) conditions.push(searchClause(query.q));
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
    return { items: page.map(toListItem), nextCursor };
  }

  /** Throws `user_not_found` (404) for unknown ids and, unless `includeDeleted`, for soft-deleted users. */
  async getById(id: string, includeDeleted: boolean): Promise<UserDetailDto> {
    const row = await this.prisma.db.user.findFirst({
      where: includeDeleted ? { id } : { id, deletedAt: null },
      select: DETAIL_SELECT,
    });
    if (!row) throw usersError.userNotFound();
    return toDetail(row);
  }
}
