import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { authError } from '../auth/auth.errors.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import type { CourseStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { escapeLikePattern } from '../users/users.validation.js';
import { hoursToDecimalString, invalidAgeRange, isEmptyCoursePatch, planCourseUpdate } from './courses.changes.js';
import type { CoursePatch, CourseValues } from './courses.changes.js';
import { COURSES_PAGE_DEFAULT } from './courses.dto.js';
import type {
  ChangeCourseStatusDto,
  CourseDto,
  CourseListDto,
  CourseSortField,
  CreateCourseDto,
  ListCoursesQueryDto,
  UpdateCourseDto,
} from './courses.dto.js';
import { coursesError } from './courses.errors.js';
import { canManageCourses, MANAGE_COURSES_PERMISSION } from './courses.policy.js';
import { allowedCourseActions, isDeletable, nextCourseStatus } from './courses.status.js';

export const COURSES_AUDIT_ACTIONS = {
  created: 'courses.created',
  updated: 'courses.updated',
  statusChanged: 'courses.status.changed',
  deleted: 'courses.deleted',
} as const;

/** Audit `entity_type` of course events. */
export const COURSES_ENTITY_TYPE = 'courses';

const COURSE_SELECT = {
  id: true,
  code: true,
  name: true,
  summary: true,
  description: true,
  status: true,
  durationHours: true,
  sessionsCount: true,
  minAge: true,
  maxAge: true,
  createdAt: true,
  updatedAt: true,
  level: { select: { id: true, code: true, name: true, isActive: true } },
  _count: { select: { syllabusItems: true } },
} satisfies Prisma.CourseSelect;

type CourseRow = Prisma.CourseGetPayload<{ select: typeof COURSE_SELECT }>;

function toCourseDto(row: CourseRow): CourseDto {
  return {
    id: row.id,
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    summary: readLocalizedText(row.summary),
    description: readLocalizedText(row.description),
    level: row.level
      ? { id: row.level.id, code: row.level.code, name: readLocalizedText(row.level.name) ?? { ar: row.level.code }, isActive: row.level.isActive }
      : null,
    status: row.status,
    durationHours: row.durationHours === null ? null : Number(row.durationHours),
    sessionsCount: row.sessionsCount,
    minAge: row.minAge,
    maxAge: row.maxAge,
    syllabusCount: row._count.syllabusItems,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function valuesOf(row: CourseRow): CourseValues {
  return {
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    summary: readLocalizedText(row.summary),
    description: readLocalizedText(row.description),
    levelId: row.level?.id ?? null,
    durationHours: row.durationHours === null ? null : hoursToDecimalString(row.durationHours.toString()),
    sessionsCount: row.sessionsCount,
    minAge: row.minAge,
    maxAge: row.maxAge,
  };
}

/** Optional localized jsonb: null is the database NULL (the CHECK refuses a JSON null). */
function optionalJson(value: LocalizedText | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function toUpdateInput(data: CoursePatch): Prisma.CourseUncheckedUpdateInput {
  const input: Prisma.CourseUncheckedUpdateInput = {};
  if (data.code !== undefined) input.code = data.code;
  if (data.name !== undefined) input.name = data.name as Prisma.InputJsonValue;
  if (data.summary !== undefined) input.summary = optionalJson(data.summary);
  if (data.description !== undefined) input.description = optionalJson(data.description);
  if (data.levelId !== undefined) input.levelId = data.levelId;
  if (data.durationHours !== undefined) input.durationHours = data.durationHours;
  if (data.sessionsCount !== undefined) input.sessionsCount = data.sessionsCount;
  if (data.minAge !== undefined) input.minAge = data.minAge;
  if (data.maxAge !== undefined) input.maxAge = data.maxAge;
  return input;
}

/**
 * Concurrent requests can beat the friendly checks: a duplicate code (P2002),
 * a level deleted meanwhile (P2003 on courses.level_id) or a course deleted
 * meanwhile (P2025).
 */
function translateKnownError(error: unknown, courseId: string | null, code: string | null, levelId: string | null): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
  if (error.code === 'P2002' && code !== null) return coursesError.courseCodeTaken(code);
  if (error.code === 'P2003' && levelId !== null) return coursesError.levelNotFound(levelId);
  if (error.code === 'P2025' && courseId !== null) return coursesError.courseNotFound(courseId);
  return error;
}

/**
 * MOD-04-T03 — courses. `courses.read` sees published courses only (any other
 * state is 404 and a non-published status filter is 403 — D-R13);
 * `courses.manage` sees every state and writes. Archiving replaces deletion:
 * only a draft can be deleted (D-R14). Every write is one transaction with
 * exactly one audit event (`courses.*`); metadata holds the code, the status
 * transition or field names — never values.
 */
@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCoursesQueryDto, caller: AuthPrincipal): Promise<CourseListDto> {
    const manager = canManageCourses(caller.permissions);
    if (!manager && query.status !== undefined && query.status !== 'published') {
      throw authError.permissionDenied([MANAGE_COURSES_PERMISSION]);
    }
    const sort: CourseSortField = query.sort ?? 'code';
    const order: SortOrder = query.order ?? (sort === 'code' ? 'asc' : 'desc');
    const limit = query.limit ?? COURSES_PAGE_DEFAULT;

    const filters: Prisma.CourseWhereInput[] = [];
    const status: CourseStatus | undefined = manager ? query.status : 'published';
    if (status) filters.push({ status });
    if (query.levelId) filters.push({ levelId: query.levelId });
    if (query.q) {
      const pattern = escapeLikePattern(query.q);
      filters.push({
        OR: [
          { code: { contains: pattern, mode: 'insensitive' } },
          { name: { path: ['ar'], string_contains: query.q } },
          { name: { path: ['en'], string_contains: query.q } },
        ],
      });
    }
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, sort, order, sort === 'code', () => coursesError.cursorInvalid());
      const cmp = order === 'asc' ? 'gt' : 'lt';
      filters.push(sort === 'code' ? { code: { [cmp]: cursor.key as string } } : { id: { [cmp]: cursor.id } });
    }

    const rows = await this.prisma.db.course.findMany({
      where: { AND: filters },
      orderBy: sort === 'code' ? [{ code: order }] : [{ id: order }],
      take: limit + 1,
      select: COURSE_SELECT,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeKeysetCursor({ sort, order, key: sort === 'code' ? last.code : null, id: last.id })
        : null;
    return { items: page.map(toCourseDto), nextCursor };
  }

  async get(id: string, caller: AuthPrincipal): Promise<CourseDto> {
    const row = await this.prisma.db.course.findUnique({ where: { id }, select: COURSE_SELECT });
    if (!row || (row.status !== 'published' && !canManageCourses(caller.permissions))) throw coursesError.courseNotFound(id);
    return toCourseDto(row);
  }

  async create(input: CreateCourseDto, caller: AuthPrincipal, ctx: RequestContext): Promise<CourseDto> {
    const minAge = input.minAge ?? null;
    const maxAge = input.maxAge ?? null;
    if (minAge !== null && maxAge !== null && maxAge < minAge) throw coursesError.ageRangeInvalid(minAge, maxAge);
    const clash = await this.prisma.db.course.findUnique({ where: { code: input.code }, select: { id: true } });
    if (clash) throw coursesError.courseCodeTaken(input.code);
    if (input.levelId) await this.assertLevelExists(input.levelId);

    let courseId: string;
    try {
      courseId = await this.prisma.db.$transaction(async (tx) => {
        const course = await tx.course.create({
          data: {
            code: input.code,
            name: toLocalizedText(input.name) as Prisma.InputJsonValue,
            summary: optionalJson(input.summary ? toLocalizedText(input.summary) : null),
            description: optionalJson(input.description ? toLocalizedText(input.description) : null),
            levelId: input.levelId ?? null,
            durationHours: input.durationHours === undefined ? null : hoursToDecimalString(input.durationHours),
            sessionsCount: input.sessionsCount ?? null,
            minAge,
            maxAge,
            createdById: caller.id,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: COURSES_AUDIT_ACTIONS.created,
            actorUserId: caller.id,
            entityType: COURSES_ENTITY_TYPE,
            entityId: course.id,
            metadata: { code: input.code, status: 'draft' },
            ...ctx,
          },
          tx,
        );
        return course.id;
      });
    } catch (error) {
      throw translateKnownError(error, null, input.code, input.levelId ?? null);
    }
    return this.getForManager(courseId);
  }

  async update(id: string, input: UpdateCourseDto, caller: AuthPrincipal, ctx: RequestContext): Promise<CourseDto> {
    if (isEmptyCoursePatch(input)) throw coursesError.nothingToUpdate();
    const row = await this.prisma.db.course.findUnique({ where: { id }, select: COURSE_SELECT });
    if (!row) throw coursesError.courseNotFound(id);

    const patch: CoursePatch = {};
    if (input.code !== undefined) patch.code = input.code;
    if (input.name !== undefined) patch.name = toLocalizedText(input.name);
    if (input.summary !== undefined) patch.summary = input.summary === null ? null : toLocalizedText(input.summary);
    if (input.description !== undefined) patch.description = input.description === null ? null : toLocalizedText(input.description);
    if (input.levelId !== undefined) patch.levelId = input.levelId;
    if (input.durationHours !== undefined) patch.durationHours = hoursToDecimalString(input.durationHours);
    if (input.sessionsCount !== undefined) patch.sessionsCount = input.sessionsCount;
    if (input.minAge !== undefined) patch.minAge = input.minAge;
    if (input.maxAge !== undefined) patch.maxAge = input.maxAge;

    const current = valuesOf(row);
    const badRange = invalidAgeRange(current, patch);
    if (badRange) throw coursesError.ageRangeInvalid(badRange.minAge, badRange.maxAge);
    const plan = planCourseUpdate(current, patch);
    if (plan.fields.length === 0) return toCourseDto(row);

    if (plan.data.code !== undefined) {
      const clash = await this.prisma.db.course.findUnique({ where: { code: plan.data.code }, select: { id: true } });
      if (clash && clash.id !== id) throw coursesError.courseCodeTaken(plan.data.code);
    }
    if (plan.data.levelId) await this.assertLevelExists(plan.data.levelId);

    try {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.course.update({ where: { id }, data: toUpdateInput(plan.data), select: { id: true } });
        await this.audit.record(
          {
            action: COURSES_AUDIT_ACTIONS.updated,
            actorUserId: caller.id,
            entityType: COURSES_ENTITY_TYPE,
            entityId: id,
            metadata: { code: plan.data.code ?? row.code, fields: plan.fields },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, id, plan.data.code ?? null, plan.data.levelId ?? null);
    }
    return this.getForManager(id);
  }

  /** publish / unpublish / archive / restore (courses.status.ts); a conditional update guards against a concurrent change. */
  async changeStatus(id: string, input: ChangeCourseStatusDto, caller: AuthPrincipal, ctx: RequestContext): Promise<CourseDto> {
    const row = await this.prisma.db.course.findUnique({ where: { id }, select: { id: true, code: true, status: true } });
    if (!row) throw coursesError.courseNotFound(id);
    const to = nextCourseStatus(input.action, row.status);
    if (to === null) throw coursesError.invalidTransition(row.status, input.action, allowedCourseActions(row.status));

    await this.prisma.db.$transaction(async (tx) => {
      const written = await tx.course.updateMany({ where: { id, status: row.status }, data: { status: to } });
      if (written.count === 0) {
        // Changed (or deleted) between the read and the write: report the state now.
        const now = await tx.course.findUnique({ where: { id }, select: { status: true } });
        if (!now) throw coursesError.courseNotFound(id);
        throw coursesError.invalidTransition(now.status, input.action, allowedCourseActions(now.status));
      }
      await this.audit.record(
        {
          action: COURSES_AUDIT_ACTIONS.statusChanged,
          actorUserId: caller.id,
          entityType: COURSES_ENTITY_TYPE,
          entityId: id,
          metadata: { code: row.code, action: input.action, from: row.status, to },
          ...ctx,
        },
        tx,
      );
    });
    return this.getForManager(id);
  }

  /** Deletes a draft (its syllabus cascades); any other state is 409 course_not_deletable — archive it instead. */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    const row = await this.prisma.db.course.findUnique({ where: { id }, select: { id: true, code: true, status: true } });
    if (!row) throw coursesError.courseNotFound(id);
    if (!isDeletable(row.status)) throw coursesError.courseNotDeletable(row.status);
    await this.prisma.db.$transaction(async (tx) => {
      const deleted = await tx.course.deleteMany({ where: { id, status: 'draft' } });
      if (deleted.count === 0) {
        const now = await tx.course.findUnique({ where: { id }, select: { status: true } });
        if (!now) throw coursesError.courseNotFound(id);
        throw coursesError.courseNotDeletable(now.status);
      }
      await this.audit.record(
        {
          action: COURSES_AUDIT_ACTIONS.deleted,
          actorUserId: caller.id,
          entityType: COURSES_ENTITY_TYPE,
          entityId: id,
          metadata: { code: row.code },
          ...ctx,
        },
        tx,
      );
    });
  }

  private async getForManager(id: string): Promise<CourseDto> {
    const row = await this.prisma.db.course.findUnique({ where: { id }, select: COURSE_SELECT });
    if (!row) throw coursesError.courseNotFound(id);
    return toCourseDto(row);
  }

  private async assertLevelExists(levelId: string): Promise<void> {
    const level = await this.prisma.db.level.findUnique({ where: { id: levelId }, select: { id: true } });
    if (!level) throw coursesError.levelNotFound(levelId);
  }
}
