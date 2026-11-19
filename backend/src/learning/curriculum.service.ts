import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { coursesError } from '../courses/courses.errors.js';
import { canManageCourses } from '../courses/courses.policy.js';
import { COURSES_ENTITY_TYPE } from '../courses/courses.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { canonicalJson } from '../grades/gradebook.calc.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import type { LocalizedTextDto } from '../roles/roles.dto.js';
import { planCurriculumReplacement } from './curriculum.changes.js';
import type { ExistingItem, ExistingSection, RequestedItem, SectionTarget } from './curriculum.changes.js';
import { assertNoProgressOnDeletion } from './curriculum.deletion.js';
import type { CurriculumDto, CurriculumItemDto, CurriculumItemInputDto, ReplaceCurriculumDto, ReplaceLessonContentDto } from './curriculum.dto.js';
import { buildCurriculum } from './learning.curriculum.js';
import {
  completionModeOf,
  displayDurationSecondsOf,
  parseLessonContent,
  parseLessonResources,
  readLessonContent,
  readLessonResources,
} from './learning.content.js';
import { learningError } from './learning.errors.js';
import { ITEM_SELECT, SECTION_SELECT } from './learning.read.js';

export const CURRICULUM_AUDIT_ACTIONS = {
  changed: 'courses.curriculum.changed',
  contentChanged: 'courses.curriculum.content.changed',
} as const;

const CURRICULUM_ITEM_SELECT = { ...ITEM_SELECT, updatedAt: true } satisfies Prisma.CourseSyllabusItemSelect;

type Db = PrismaService['db'] | Prisma.TransactionClient;
type ItemRow = Prisma.CourseSyllabusItemGetPayload<{ select: typeof CURRICULUM_ITEM_SELECT }>;
type SectionRow = Prisma.CourseSectionGetPayload<{ select: typeof SECTION_SELECT }>;

/** Optional localized jsonb: null is the database NULL (the CHECKs refuse a JSON null). */
function optionalJson(value: LocalizedText | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function optionalText(dto: LocalizedTextDto | null | undefined): LocalizedText | null {
  return dto ? toLocalizedText(dto) : null;
}

function requestedItem(item: CurriculumItemInputDto): RequestedItem {
  return {
    ...(item.id !== undefined ? { id: item.id } : {}),
    title: toLocalizedText(item.title),
    description: optionalText(item.description),
    estimatedMinutes: item.estimatedMinutes ?? null,
    isRequired: item.isRequired,
    isPublished: item.isPublished,
  };
}

function toItemDto(row: ItemRow, progressCount: number): CurriculumItemDto {
  const content = readLessonContent(row.kind, row.content);
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    title: readLocalizedText(row.title) ?? { ar: '' },
    description: readLocalizedText(row.description),
    estimatedMinutes: row.estimatedMinutes,
    kind: row.kind,
    content: content as Record<string, unknown> | null,
    resources: readLessonResources(row.resources),
    isRequired: row.isRequired,
    isPublished: row.isPublished,
    completionMode: completionModeOf(row.kind, content),
    durationSeconds: displayDurationSecondsOf(row.kind, content, row.estimatedMinutes),
    progressCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function existingSectionOf(row: SectionRow): ExistingSection {
  return { id: row.id, sortOrder: row.sortOrder, title: readLocalizedText(row.title), description: readLocalizedText(row.description) };
}

function existingItemOf(row: ItemRow): ExistingItem {
  return {
    id: row.id,
    sectionId: row.sectionId,
    sortOrder: row.sortOrder,
    title: readLocalizedText(row.title) ?? { ar: '' },
    description: readLocalizedText(row.description),
    estimatedMinutes: row.estimatedMinutes,
    isRequired: row.isRequired,
    isPublished: row.isPublished,
  };
}

/** `content: …` / `resources: …` — which half of the body a problem belongs to. */
function prefixed(root: 'content' | 'resources', problems: readonly string[]): string[] {
  return problems.map((problem) => `${root}: ${problem}`);
}

/**
 * MOD-20 «My School» — the course curriculum for authors (API-226..228;
 * roadmap §4q, D-R130..D-R135). A course is divided into levels
 * (`course_sections`), each holding lessons (`course_syllabus_items`), each
 * with its content. Reading is open to the holders of `courses.manage` and to
 * the teachers of a class of the course (any `class_teachers` row) — anyone
 * else, like an unknown course, is `404 course_not_found`. Writing needs
 * `courses.manage`; every write runs in one transaction that first locks the
 * course row (`FOR NO KEY UPDATE`, like the syllabus PUT API-049, so the two
 * never interleave) and records exactly one audit event, nothing when nothing
 * differs. The position swaps are legal because both order uniques are
 * deferred (ADR-046).
 */
@Injectable()
export class CurriculumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** API-226. */
  async get(courseId: string, caller: AuthPrincipal): Promise<CurriculumDto> {
    const db = this.prisma.db;
    const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true, code: true } });
    if (!course) throw coursesError.courseNotFound(courseId);
    const canManage = canManageCourses(caller.permissions);
    if (!canManage) {
      const teaches = await db.classTeacher.findFirst({ where: { teacherUserId: caller.id, class: { courseId } }, select: { classId: true } });
      if (!teaches) throw coursesError.courseNotFound(courseId);
    }
    return this.read(db, course, canManage);
  }

  /** API-227: the complete structure. */
  async replace(courseId: string, input: ReplaceCurriculumDto, caller: AuthPrincipal, ctx: RequestContext): Promise<CurriculumDto> {
    const requested = {
      sections: input.sections.map((section) => ({
        ...(section.id !== undefined ? { id: section.id } : {}),
        title: optionalText(section.title),
        description: optionalText(section.description),
        items: section.items.map(requestedItem),
      })),
      looseItems: (input.looseItems ?? []).map(requestedItem),
    };
    const canManage = canManageCourses(caller.permissions);

    return this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM courses WHERE id = ${courseId}::uuid FOR NO KEY UPDATE`;
      if (locked.length === 0) throw coursesError.courseNotFound(courseId);
      const course = { id: courseId, code: locked[0]!.code };

      const sectionRows = await tx.courseSection.findMany({ where: { courseId }, orderBy: [{ sortOrder: 'asc' }], select: SECTION_SELECT });
      const itemRows = await tx.courseSyllabusItem.findMany({ where: { courseId }, orderBy: [{ sortOrder: 'asc' }], select: CURRICULUM_ITEM_SELECT });
      const plan = planCurriculumReplacement(sectionRows.map(existingSectionOf), itemRows.map(existingItemOf), requested);
      if (!plan.ok) {
        const { unknownSections, duplicateSections, unknownItems, duplicateItems } = plan;
        throw learningError.curriculumInvalid({ unknownSections, duplicateSections, unknownItems, duplicateItems });
      }
      if (!plan.changed) return this.read(tx, course, canManage);
      await assertNoProgressOnDeletion(tx, plan.items.remove);

      if (plan.items.remove.length > 0) await tx.courseSyllabusItem.deleteMany({ where: { courseId, id: { in: plan.items.remove } } });
      if (plan.sections.remove.length > 0) await tx.courseSection.deleteMany({ where: { courseId, id: { in: plan.sections.remove } } });
      for (const change of plan.sections.update) {
        const data: Prisma.CourseSectionUncheckedUpdateInput = {};
        if (change.sortOrder !== undefined) data.sortOrder = change.sortOrder;
        if (change.title !== undefined) data.title = optionalJson(change.title);
        if (change.description !== undefined) data.description = optionalJson(change.description);
        await tx.courseSection.update({ where: { id: change.id }, data, select: { id: true } });
      }
      const createdSectionIds: string[] = [];
      for (const section of plan.sections.create) {
        const created = await tx.courseSection.create({
          data: { courseId, sortOrder: section.sortOrder, title: optionalJson(section.title), description: optionalJson(section.description) },
          select: { id: true },
        });
        createdSectionIds.push(created.id);
      }
      const sectionIdOf = (target: SectionTarget): string | null =>
        target === null ? null : 'existingId' in target ? target.existingId : createdSectionIds[target.createIndex]!;

      for (const change of plan.items.update) {
        const data: Prisma.CourseSyllabusItemUncheckedUpdateInput = {};
        if (change.sortOrder !== undefined) data.sortOrder = change.sortOrder;
        if (change.section !== undefined) data.sectionId = sectionIdOf(change.section);
        if (change.title !== undefined) data.title = change.title as Prisma.InputJsonValue;
        if (change.description !== undefined) data.description = optionalJson(change.description);
        if (change.estimatedMinutes !== undefined) data.estimatedMinutes = change.estimatedMinutes;
        if (change.isRequired !== undefined) data.isRequired = change.isRequired;
        if (change.isPublished !== undefined) data.isPublished = change.isPublished;
        await tx.courseSyllabusItem.update({ where: { id: change.id }, data, select: { id: true } });
      }
      if (plan.items.create.length > 0) {
        await tx.courseSyllabusItem.createMany({
          data: plan.items.create.map((item) => ({
            courseId,
            sectionId: sectionIdOf(item.section),
            sortOrder: item.sortOrder,
            title: item.title as Prisma.InputJsonValue,
            description: optionalJson(item.description),
            estimatedMinutes: item.estimatedMinutes,
            isRequired: item.isRequired,
            isPublished: item.isPublished,
          })),
        });
      }

      await this.audit.record(
        {
          action: CURRICULUM_AUDIT_ACTIONS.changed,
          actorUserId: caller.id,
          entityType: COURSES_ENTITY_TYPE,
          entityId: courseId,
          metadata: { code: course.code, ...plan.counts },
          ...ctx,
        },
        tx,
      );
      return this.read(tx, course, canManage);
    });
  }

  /** API-228: one lesson's kind, content and resources. */
  async replaceContent(courseId: string, itemId: string, input: ReplaceLessonContentDto, caller: AuthPrincipal, ctx: RequestContext): Promise<CurriculumItemDto> {
    const contentCheck = parseLessonContent(input.kind, input.content);
    const resourcesCheck = parseLessonResources(input.resources);
    const problems = [
      ...(contentCheck.ok ? [] : prefixed('content', contentCheck.problems)),
      ...(resourcesCheck.ok ? [] : prefixed('resources', resourcesCheck.problems)),
    ];
    if (!contentCheck.ok || !resourcesCheck.ok) throw learningError.contentInvalid(problems);
    const content = contentCheck.content;
    const resources = resourcesCheck.resources;

    return this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM courses WHERE id = ${courseId}::uuid FOR NO KEY UPDATE`;
      if (locked.length === 0) throw coursesError.courseNotFound(courseId);
      const row = await tx.courseSyllabusItem.findFirst({ where: { id: itemId, courseId }, select: CURRICULUM_ITEM_SELECT });
      if (!row) throw learningError.lessonNotFound(itemId);

      const same =
        row.kind === input.kind && canonicalJson(row.content ?? null) === canonicalJson(content) && canonicalJson(row.resources) === canonicalJson(resources);
      let current = row;
      if (!same) {
        current = await tx.courseSyllabusItem.update({
          where: { id: itemId },
          data: {
            kind: input.kind,
            content: content === null ? Prisma.DbNull : (content as unknown as Prisma.InputJsonValue),
            resources: resources as unknown as Prisma.InputJsonValue,
          },
          select: CURRICULUM_ITEM_SELECT,
        });
        await this.audit.record(
          {
            action: CURRICULUM_AUDIT_ACTIONS.contentChanged,
            actorUserId: caller.id,
            entityType: COURSES_ENTITY_TYPE,
            entityId: courseId,
            metadata: { code: locked[0]!.code, itemId, kind: input.kind, previousKind: row.kind, resources: resources.length },
            ...ctx,
          },
          tx,
        );
      }
      const progressCount = await tx.learningProgress.count({ where: { syllabusItemId: itemId } });
      return toItemDto(current, progressCount);
    });
  }

  private async read(db: Db, course: { id: string; code: string }, canManage: boolean): Promise<CurriculumDto> {
    const sections = await db.courseSection.findMany({ where: { courseId: course.id }, orderBy: [{ sortOrder: 'asc' }], select: SECTION_SELECT });
    const items = await db.courseSyllabusItem.findMany({ where: { courseId: course.id }, orderBy: [{ sortOrder: 'asc' }], select: CURRICULUM_ITEM_SELECT });
    const counts = await db.learningProgress.groupBy({ by: ['syllabusItemId'], where: { courseId: course.id }, _count: { _all: true } });
    const progressByItem = new Map(counts.map((row) => [row.syllabusItemId, row._count._all]));
    const groups = buildCurriculum(sections, items, { learner: false });
    const itemDto = (row: ItemRow) => toItemDto(row, progressByItem.get(row.id) ?? 0);
    return {
      courseId: course.id,
      courseCode: course.code,
      canManage,
      sections: groups.flatMap((group) =>
        group.section === null
          ? []
          : [
              {
                id: group.section.id,
                number: group.number,
                sortOrder: group.section.sortOrder,
                title: readLocalizedText(group.section.title),
                description: readLocalizedText(group.section.description),
                items: group.items.map(itemDto),
              },
            ],
      ),
      looseItems: groups.find((group) => group.section === null)?.items.map(itemDto) ?? [],
    };
  }
}
