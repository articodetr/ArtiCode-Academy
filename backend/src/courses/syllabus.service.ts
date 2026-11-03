import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { coursesError } from './courses.errors.js';
import { canManageCourses } from './courses.policy.js';
import { COURSES_ENTITY_TYPE } from './courses.service.js';
import { planSyllabusReplacement } from './syllabus.changes.js';
import type { ExistingSyllabusItem, RequestedSyllabusItem } from './syllabus.changes.js';
import type { ReplaceSyllabusDto, SyllabusDto, SyllabusItemDto } from './syllabus.dto.js';

export const SYLLABUS_AUDIT_ACTIONS = {
  changed: 'courses.syllabus.changed',
} as const;

const ITEM_SELECT = {
  id: true,
  sortOrder: true,
  title: true,
  description: true,
  estimatedMinutes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CourseSyllabusItemSelect;

type ItemRow = Prisma.CourseSyllabusItemGetPayload<{ select: typeof ITEM_SELECT }>;
type Tx = Prisma.TransactionClient;

function toItemDto(row: ItemRow): SyllabusItemDto {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    title: readLocalizedText(row.title) ?? { ar: '' },
    description: readLocalizedText(row.description),
    estimatedMinutes: row.estimatedMinutes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function existingOf(row: ItemRow): ExistingSyllabusItem {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    title: readLocalizedText(row.title) ?? { ar: '' },
    description: readLocalizedText(row.description),
    estimatedMinutes: row.estimatedMinutes,
  };
}

/** Optional localized jsonb: null is the database NULL (the CHECK refuses a JSON null). */
function optionalJson(value: LocalizedText | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/**
 * MOD-04-T04 — course syllabus. Reading follows the course's visibility
 * (`courses.read` sees the syllabus of a published course only — D-R13);
 * writing (`courses.manage`) replaces the whole syllabus in one transaction
 * that first locks the course row (`FOR NO KEY UPDATE`: concurrent
 * replacements of one course run one after the other, while rows of other
 * tables may still reference the course). The position swaps are legal because
 * `uq_course_syllabus_items_course_order` is deferred (ADR-046). Exactly one
 * `courses.syllabus.changed` event per effective write (counts only).
 */
@Injectable()
export class SyllabusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(courseId: string, caller: AuthPrincipal): Promise<SyllabusDto> {
    const course = await this.prisma.db.course.findUnique({ where: { id: courseId }, select: { status: true } });
    if (!course || (course.status !== 'published' && !canManageCourses(caller.permissions))) throw coursesError.courseNotFound(courseId);
    return this.read(this.prisma.db, courseId);
  }

  async replace(courseId: string, input: ReplaceSyllabusDto, caller: AuthPrincipal, ctx: RequestContext): Promise<SyllabusDto> {
    const requested: RequestedSyllabusItem[] = input.items.map((item) => ({
      ...(item.id !== undefined ? { id: item.id } : {}),
      title: toLocalizedText(item.title),
      description: item.description ? toLocalizedText(item.description) : null,
      estimatedMinutes: item.estimatedMinutes ?? null,
    }));

    return this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM courses WHERE id = ${courseId}::uuid FOR NO KEY UPDATE`;
      if (locked.length === 0) throw coursesError.courseNotFound(courseId);

      const rows = await tx.courseSyllabusItem.findMany({ where: { courseId }, orderBy: [{ sortOrder: 'asc' }], select: ITEM_SELECT });
      const plan = planSyllabusReplacement(rows.map(existingOf), requested);
      if (!plan.ok) throw coursesError.syllabusInvalid(plan.unknown, plan.duplicates);
      if (!plan.changed) return { courseId, items: rows.map(toItemDto) };

      if (plan.remove.length > 0) await tx.courseSyllabusItem.deleteMany({ where: { courseId, id: { in: plan.remove } } });
      for (const change of plan.update) {
        const data: Prisma.CourseSyllabusItemUpdateInput = {};
        if (change.sortOrder !== undefined) data.sortOrder = change.sortOrder;
        if (change.title !== undefined) data.title = change.title as Prisma.InputJsonValue;
        if (change.description !== undefined) data.description = optionalJson(change.description);
        if (change.estimatedMinutes !== undefined) data.estimatedMinutes = change.estimatedMinutes;
        await tx.courseSyllabusItem.update({ where: { id: change.id }, data, select: { id: true } });
      }
      if (plan.create.length > 0) {
        await tx.courseSyllabusItem.createMany({
          data: plan.create.map((item) => ({
            courseId,
            sortOrder: item.sortOrder,
            title: item.title as Prisma.InputJsonValue,
            description: optionalJson(item.description),
            estimatedMinutes: item.estimatedMinutes,
          })),
        });
      }
      await this.audit.record(
        {
          action: SYLLABUS_AUDIT_ACTIONS.changed,
          actorUserId: caller.id,
          entityType: COURSES_ENTITY_TYPE,
          entityId: courseId,
          metadata: { code: locked[0]!.code, ...plan.counts, items: requested.length },
          ...ctx,
        },
        tx,
      );
      return this.read(tx, courseId);
    });
  }

  private async read(db: Tx | PrismaService['db'], courseId: string): Promise<SyllabusDto> {
    const rows = await db.courseSyllabusItem.findMany({ where: { courseId }, orderBy: [{ sortOrder: 'asc' }], select: ITEM_SELECT });
    return { courseId, items: rows.map(toItemDto) };
  }
}
