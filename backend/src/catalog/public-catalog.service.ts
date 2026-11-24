import { Injectable } from '@nestjs/common';
import { readSettings } from '../academy/academy.settings.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { readLessonContent, displayDurationSecondsOf } from '../learning/learning.content.js';
import { buildCurriculum } from '../learning/learning.curriculum.js';
import type { CurriculumItemRow, CurriculumSectionRow } from '../learning/learning.curriculum.js';
import { learningError } from '../learning/learning.errors.js';
import { loadCurriculumRows } from '../learning/learning.read.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { calendarDateIn } from '../schedule/schedule.time.js';
import { availableCourseIdsOf, codeCursorFilter, codePageOf, COURSE_CARD_SELECT, courseOfferOf, courseSearchFilter, selfServiceClassesOf } from './catalog.service.js';
import type { ClassRow } from './catalog.service.js';
import { catalogError } from './catalog.errors.js';
import { nextStartsOn } from './catalog.policy.js';
import { PUBLIC_CATALOG_PAGE_DEFAULT } from './public-catalog.dto.js';
import type { ListPublicCatalogQueryDto, PublicCatalogCourseDetailDto, PublicCatalogCourseDto, PublicCatalogListDto } from './public-catalog.dto.js';

type Db = PrismaService['db'];
type CourseCardRow = Prisma.CourseGetPayload<{ select: typeof COURSE_CARD_SELECT }>;

/** What every card needs from the academy row: its currency (D15) and today's calendar day in its zone (`nextStartsOn`). */
interface AcademyView {
  currency: string;
  today: string;
}

/** What the curriculum counts of a card need: levels and published lessons (no content). */
interface CurriculumShape {
  sections: CurriculumSectionRow[];
  items: CurriculumItemRow[];
}

/**
 * MOD-20 (roadmap §4q, D-R138) — the public catalog: API-236 (list) and
 * API-237 (one course) for visitors who are not signed in, open only while
 * `settings.catalog.publicBrowsing` is true (else 404 catalog_not_public,
 * before anything else). The courses, prices and seat availability follow
 * the signed-in catalog's own rules (API-219/220 — the helpers exported by
 * catalog.service.ts); the curriculum counts and the outline follow the
 * learner's view (`buildCurriculum(…, { learner: true })`): published lessons
 * only, no empty level. Never a teacher name, a class code or schedule, a
 * lesson id or its content, nor anything about a caller. Read-only, no audit.
 */
@Injectable()
export class PublicCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** API-236 */
  async list(query: ListPublicCatalogQueryDto): Promise<PublicCatalogListDto> {
    const db = this.prisma.db;
    const academy = await this.assertPublic(db);
    const limit = query.limit ?? PUBLIC_CATALOG_PAGE_DEFAULT;
    const filters: Prisma.CourseWhereInput[] = [{ status: 'published' }];
    if (query.q) filters.push(await courseSearchFilter(db, query.q));
    // PORTAL-01 (#205): the `pricing` and `available` filters of API-219, with the same meaning.
    if (query.pricing === 'free') filters.push({ enrollmentFeePlanId: null });
    if (query.pricing === 'paid') filters.push({ enrollmentFeePlanId: { not: null } });
    if (query.available !== undefined) {
      const ids = await availableCourseIdsOf(db);
      filters.push(query.available ? { id: { in: ids } } : { id: { notIn: ids } });
    }
    if (query.cursor) filters.push(codeCursorFilter(query.cursor));
    const rows = await db.course.findMany({ where: { AND: filters }, orderBy: [{ code: 'asc' }], take: limit + 1, select: COURSE_CARD_SELECT });
    const { page, nextCursor } = codePageOf(rows, limit);
    const courseIds = page.map((row) => row.id);
    const [open, shapes] = await Promise.all([selfServiceClassesOf(db, courseIds), this.curriculumShapes(db, courseIds)]);
    return {
      items: page.map((row) => toCard(row, open, shapes.get(row.id) ?? { sections: [], items: [] }, academy)),
      nextCursor,
    };
  }

  /** API-237 */
  async get(id: string): Promise<PublicCatalogCourseDetailDto> {
    const db = this.prisma.db;
    const academy = await this.assertPublic(db);
    const row = await db.course.findFirst({
      where: { id, status: 'published' },
      select: { ...COURSE_CARD_SELECT, description: true, minAge: true, maxAge: true },
    });
    if (!row) throw catalogError.courseNotFound(id);
    const [open, curricula] = await Promise.all([selfServiceClassesOf(db, [id]), loadCurriculumRows(db, [id])]);
    const { sections, items } = curricula.get(id) ?? { sections: [], items: [] };
    const groups = buildCurriculum(sections, items, { learner: true });
    return {
      ...toCard(row, open, { sections, items }, academy),
      description: readLocalizedText(row.description),
      minAge: row.minAge,
      maxAge: row.maxAge,
      outline: groups.map((group) => ({
        number: group.number,
        title: group.section ? readLocalizedText(group.section.title) : null,
        lessons: group.items.map((item) => ({
          title: readLocalizedText(item.title) ?? { ar: '—' },
          kind: item.kind,
          durationSeconds: displayDurationSecondsOf(item.kind, readLessonContent(item.kind, item.content), item.estimatedMinutes),
        })),
      })),
    };
  }

  // ---------------------------------------------------------------------------

  /** 404 catalog_not_public unless the academy opened its catalog to visitors (D-R138); returns the academy currency and today's day in its zone. */
  private async assertPublic(db: Db): Promise<AcademyView> {
    const academy = await db.academy.findFirst({ select: { settings: true, currency: true, timezone: true } });
    if (!academy || readSettings(academy.settings).catalog.publicBrowsing !== true) throw learningError.catalogNotPublic();
    return { currency: academy.currency, today: calendarDateIn(academy.timezone) };
  }

  /** The levels and the published lessons of these courses, without any content — enough to count what a learner sees. */
  private async curriculumShapes(db: Db, courseIds: readonly string[]): Promise<Map<string, CurriculumShape>> {
    const out = new Map<string, CurriculumShape>();
    for (const id of courseIds) out.set(id, { sections: [], items: [] });
    if (courseIds.length === 0) return out;
    const [sections, items] = await Promise.all([
      db.courseSection.findMany({ where: { courseId: { in: [...courseIds] } }, select: { id: true, courseId: true, sortOrder: true } }),
      db.courseSyllabusItem.findMany({
        where: { courseId: { in: [...courseIds] }, isPublished: true },
        select: { id: true, courseId: true, sectionId: true, sortOrder: true, isPublished: true },
      }),
    ]);
    for (const section of sections) out.get(section.courseId)?.sections.push(section);
    for (const item of items) out.get(item.courseId)?.items.push(item);
    return out;
  }
}

function toCard(row: CourseCardRow, open: readonly ClassRow[], curriculum: CurriculumShape, academy: AcademyView): PublicCatalogCourseDto {
  const { classes, available, price } = courseOfferOf(row, open, academy.currency);
  const groups = buildCurriculum(curriculum.sections, curriculum.items, { learner: true });
  return {
    id: row.id,
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    summary: readLocalizedText(row.summary),
    coverImageUrl: row.coverImageUrl,
    level: row.level ? { id: row.level.id, name: readLocalizedText(row.level.name) ?? { ar: row.level.code } } : null,
    durationHours: row.durationHours === null ? null : Number(row.durationHours),
    sessionsCount: row.sessionsCount,
    pricing: row.enrollmentFeePlan === null ? 'free' : 'paid',
    price: price ? { amount: price.total, currency: price.currency, installments: price.installments } : null,
    openClasses: classes.length,
    hasFreeSeat: available.length > 0,
    nextStartsOn: nextStartsOn(
      available.map((klass) => (klass.startsOn ? klass.startsOn.toISOString().slice(0, 10) : null)),
      academy.today,
    ),
    lessonCount: groups.reduce((sum, group) => sum + group.items.length, 0),
    levelCount: groups.length,
  };
}
