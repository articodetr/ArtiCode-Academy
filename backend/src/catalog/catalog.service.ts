import { Injectable } from '@nestjs/common';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { classesError } from '../classes/classes.errors.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { coursesError } from '../courses/courses.errors.js';
import { isClosedRequest, requestPayment, requestStateOf } from '../enrollments/enrollment-requests.policy.js';
import { EnrollmentRequestsService } from '../enrollments/enrollment-requests.service.js';
import { assertEnrollableStudent, EnrollmentRequestsWriter, lockJoinClass } from '../enrollments/enrollment-requests.writer.js';
import type { NotificationBatch } from '../notifications/notifications.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { calendarDateIn, columnToCalendarDate, columnToClockTime } from '../schedule/schedule.time.js';
import { escapeLikePattern } from '../users/users.validation.js';
import { CARD_TEACHERS_MAX, CATALOG_PAGE_DEFAULT } from './catalog.dto.js';
import type {
  CatalogClassDto,
  CatalogCourseCardDto,
  CatalogCourseDetailDto,
  CatalogEnrollResultDto,
  CatalogListDto,
  CatalogSlotDto,
  ListCatalogQueryDto,
} from './catalog.dto.js';
import { catalogError } from './catalog.errors.js';
import { classBlocker, isSelfServiceOpen, seatsLeft, selfServiceReason } from './catalog.policy.js';
import { COURSE_PLAN_SELECT, coursePlanUsable, toCourseFeePlan } from './course-pricing.js';
import type { CourseFeePlan, CoursePlanRow } from './course-pricing.js';

const CATALOG_SORT = 'code';
const CATALOG_ORDER = 'asc';

export const COURSE_CARD_SELECT = {
  id: true,
  code: true,
  name: true,
  summary: true,
  coverImageUrl: true,
  durationHours: true,
  sessionsCount: true,
  level: { select: { id: true, code: true, name: true } },
  enrollmentFeePlan: { select: COURSE_PLAN_SELECT },
  // MOD-20 (D-R135): an unpublished lesson is hidden from learners — the catalog counts and lists published lessons only.
  _count: { select: { syllabusItems: { where: { isPublished: true } } } },
} satisfies Prisma.CourseSelect;

type CourseCardRow = Prisma.CourseGetPayload<{ select: typeof COURSE_CARD_SELECT }>;

const CLASS_SELECT = {
  id: true,
  courseId: true,
  code: true,
  name: true,
  status: true,
  capacity: true,
  startsOn: true,
  endsOn: true,
  selfEnrollment: true,
  teachers: { where: { role: 'lead' }, take: 1, select: { teacher: { select: { fullName: true, displayName: true } } } },
  _count: { select: { enrollments: { where: { status: 'active' } } } },
} satisfies Prisma.ClassSelect;

export type ClassRow = Prisma.ClassGetPayload<{ select: typeof CLASS_SELECT }>;

type Db = PrismaService['db'];

// ---------------------------------------------------------------------------
// Shared with the public catalog (MOD-20, D-R138 — API-236/237 in
// public-catalog.service.ts): the published-course search, the code keyset,
// the classes open to self-service and a course's price and availability. One
// rule set, so a visitor and a signed-in reader see the same courses, prices
// and seats.
// ---------------------------------------------------------------------------

/** `q` of API-219: the code (literal, case-insensitive) or the Arabic/English name (the KI-048 rule). */
export async function courseSearchFilter(db: Db, q: string): Promise<Prisma.CourseWhereInput> {
  const pattern = escapeLikePattern(q);
  return { OR: [{ code: { contains: pattern, mode: 'insensitive' } }, { id: { in: await courseIdsByName(db, pattern) } }] };
}

/** The code keyset of API-219: the courses after the cursor; 400 cursor_invalid for a malformed or foreign one. */
export function codeCursorFilter(cursor: string): Prisma.CourseWhereInput {
  const decoded = decodeKeysetCursor(cursor, CATALOG_SORT, CATALOG_ORDER, true, () => coursesError.cursorInvalid());
  return { code: { gt: String(decoded.key) } };
}

/** The page of rows read with `take: limit + 1` (by code), and the cursor of the next page. */
export function codePageOf<T extends { id: string; code: string }>(rows: readonly T[], limit: number): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: CATALOG_SORT, order: CATALOG_ORDER, key: last.code, id: last.id }) : null;
  return { page, nextCursor };
}

/** The classes of these courses open to self-service now (D-R123). */
export async function selfServiceClassesOf(db: Db, courseIds: readonly string[]): Promise<ClassRow[]> {
  if (courseIds.length === 0) return [];
  const rows = await db.class.findMany({
    where: { courseId: { in: [...courseIds] }, selfEnrollment: true, status: { in: ['open', 'running'] } },
    orderBy: { code: 'asc' },
    select: CLASS_SELECT,
  });
  return rows.filter(isSelfServiceOpen);
}

export interface CourseOffer {
  /** The course's classes open to self-service now. */
  classes: ClassRow[];
  /** Of those, the ones with a free seat (and, for a paid course, a plan that can price a request). */
  available: ClassRow[];
  /** The course price (D-R122); null for a free course or a paid one whose plan cannot price a request now. */
  price: CourseFeePlan | null;
}

/** What a course card says about its price and its open classes (API-219 and the public catalog). */
export function courseOfferOf(row: { id: string; enrollmentFeePlan: CoursePlanRow | null }, open: readonly ClassRow[], currency: string): CourseOffer {
  const classes = open.filter((klass) => klass.courseId === row.id);
  const plan = row.enrollmentFeePlan;
  const priceUsable = plan !== null && coursePlanUsable(plan, row.id);
  const price = plan !== null && priceUsable ? toCourseFeePlan(plan, currency) : null;
  const available = classes.filter((klass) => klass._count.enrollments < klass.capacity && (plan === null || priceUsable));
  return { classes, available, price };
}

/** The academy currency (D15); `XXX` without the academy row. */
export async function academyCurrency(db: Db): Promise<string> {
  const academy = await db.academy.findFirst({ select: { currency: true } });
  return academy?.currency ?? 'XXX';
}

/** The KI-048 rule of the course list: a parameterised ILIKE with the backslash as ESCAPE on the Arabic and English names. */
async function courseIdsByName(db: Db, pattern: string): Promise<string[]> {
  const like = `%${pattern}%`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM courses
    WHERE name ->> 'ar' ILIKE ${like} ESCAPE '\\' OR name ->> 'en' ILIKE ${like} ESCAPE '\\'`;
  return rows.map((row) => row.id);
}

const MINE_SELECT = {
  id: true,
  classId: true,
  status: true,
  activatedAt: true,
  rejectedAt: true,
  class: { select: { courseId: true } },
  invoices: { select: { status: true, totalAmount: true, paidAmount: true } },
} satisfies Prisma.EnrollmentSelect;

type MineRow = Prisma.EnrollmentGetPayload<{ select: typeof MINE_SELECT }>;

const dateOnly = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);

/**
 * MOD-19 (roadmap §4p, D-R121..D-R129) — the course catalog and the
 * self-service enrollment. Reading needs `courses.read` (every seeded role
 * holds it): published courses only, whatever the reader's other keys; the
 * classes a reader sees are the ones the office opened to self-service and
 * that run or take students, plus any class holding the reader's own
 * enrollment or pending request; teachers by name only, seats as counts.
 * Enrolling oneself (API-221) needs `enrollments.self_enroll` and the
 * `student` role; it goes through the same writer as the office's API-058.
 * The catalog never opens a lesson, an assignment or an exam: those stay
 * behind an `active` enrollment (the «my …» rule).
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: EnrollmentRequestsWriter,
    private readonly requests: EnrollmentRequestsService,
  ) {}

  /** API-219 */
  async list(query: ListCatalogQueryDto, caller: AuthPrincipal): Promise<CatalogListDto> {
    const db = this.prisma.db;
    const limit = query.limit ?? CATALOG_PAGE_DEFAULT;
    const filters: Prisma.CourseWhereInput[] = [{ status: 'published' }];
    if (query.levelId) filters.push({ levelId: query.levelId });
    if (query.pricing === 'free') filters.push({ enrollmentFeePlanId: null });
    if (query.pricing === 'paid') filters.push({ enrollmentFeePlanId: { not: null } });
    if (query.q) filters.push(await courseSearchFilter(db, query.q));
    if (query.available !== undefined) {
      const ids = await this.availableCourseIds();
      filters.push(query.available ? { id: { in: ids } } : { id: { notIn: ids } });
    }
    if (query.cursor) filters.push(codeCursorFilter(query.cursor));
    const rows = await db.course.findMany({ where: { AND: filters }, orderBy: [{ code: 'asc' }], take: limit + 1, select: COURSE_CARD_SELECT });
    const { page, nextCursor } = codePageOf(rows, limit);

    const courseIds = page.map((row) => row.id);
    const [classes, mine, currency] = await Promise.all([this.openClasses(courseIds), this.mineIn(caller.id, courseIds), this.currency()]);
    return { items: page.map((row) => this.toCard(row, classes, mine, currency)), nextCursor };
  }

  /** API-220 */
  async get(id: string, caller: AuthPrincipal): Promise<CatalogCourseDetailDto> {
    const db = this.prisma.db;
    const row = await db.course.findFirst({
      where: { id, status: 'published' },
      select: {
        ...COURSE_CARD_SELECT,
        description: true,
        minAge: true,
        maxAge: true,
        syllabusItems: { where: { isPublished: true }, orderBy: { sortOrder: 'asc' }, select: { title: true, description: true, estimatedMinutes: true } },
      },
    });
    if (!row) throw catalogError.courseNotFound(id);
    const [open, mine, currency, academyZone] = await Promise.all([this.openClasses([id]), this.mineIn(caller.id, [id]), this.currency(), this.academyZone()]);
    const card = this.toCard(row, open, mine, currency);

    // The open classes and every class holding the reader's own row (a closed request alone does not keep a class).
    const ownIds = mine.filter((item) => !isClosedRequest(item)).map((item) => item.classId);
    const extra = ownIds.filter((classId) => !open.some((klass) => klass.id === classId));
    const others = extra.length > 0 ? await db.class.findMany({ where: { id: { in: extra } }, select: CLASS_SELECT }) : [];
    const classes = [...open, ...others].sort((a, b) => a.code.localeCompare(b.code));
    const slots = await this.slotsOf(classes.map((klass) => klass.id), academyZone);
    const reason = selfServiceReason(caller);
    const coursePaid = row.enrollmentFeePlan !== null;
    const priceUsable = row.enrollmentFeePlan !== null && coursePlanUsable(row.enrollmentFeePlan, row.id);

    return {
      ...card,
      description: readLocalizedText(row.description),
      minAge: row.minAge,
      maxAge: row.maxAge,
      syllabus: row.syllabusItems.map((item) => ({
        title: readLocalizedText(item.title) ?? { ar: '—' },
        description: readLocalizedText(item.description),
        estimatedMinutes: item.estimatedMinutes,
      })),
      classes: classes.map((klass) => this.toClass(klass, mine, slots.get(klass.id) ?? [], { selfService: reason === null, coursePaid, priceUsable })),
      selfService: { allowed: reason === null, reason },
    };
  }

  /**
   * API-221 — the reader enrolls themself: a free course → `active` at once;
   * a paid course → a `pending` request with an issued invoice (D-R125).
   * Refused, in order: a class the reader cannot enroll in by themself — not
   * opened to self-service, or of an unpublished course — 404 class_not_found;
   * no `student` role 422 not_a_student; then the writer's checks (409
   * request_pending / already_enrolled / class_not_enrollable / class_full /
   * course_price_unavailable). Everything under the class-row lock.
   */
  async enroll(classId: string, caller: AuthPrincipal, ctx: RequestContext): Promise<CatalogEnrollResultDto> {
    let result: { enrollmentId: string; outcome: 'enrolled' | 'requested'; batches: NotificationBatch[] };
    result = await this.prisma.db.$transaction(async (tx) => {
      const klass = await lockJoinClass(tx, classId);
      if (!klass || !klass.selfEnrollment || klass.courseStatus !== 'published') throw classesError.classNotFound(classId);
      const student = await assertEnrollableStudent(tx, caller.id);
      return this.writer.join(tx, klass, student, caller.id, 'self', ctx);
    });
    this.writer.dispatch(result.batches);
    return { outcome: result.outcome, enrollment: await this.requests.myItem(result.enrollmentId, caller) };
  }

  // ---------------------------------------------------------------------------

  private toCard(row: CourseCardRow, open: readonly ClassRow[], mine: readonly MineRow[], currency: string): CatalogCourseCardDto {
    const { classes, available, price } = courseOfferOf(row, open, currency);
    const plan = row.enrollmentFeePlan;
    const teachers = new Map<string, { fullName: string; displayName: string | null }>();
    for (const klass of classes) {
      const lead = klass.teachers[0]?.teacher;
      if (lead && teachers.size < CARD_TEACHERS_MAX) teachers.set(`${lead.fullName}|${lead.displayName ?? ''}`, { fullName: lead.fullName, displayName: lead.displayName });
    }
    const own = mine.filter((item) => item.class.courseId === row.id);
    return {
      id: row.id,
      code: row.code,
      name: readLocalizedText(row.name) ?? { ar: row.code },
      summary: readLocalizedText(row.summary),
      coverImageUrl: row.coverImageUrl,
      level: row.level ? { id: row.level.id, code: row.level.code, name: readLocalizedText(row.level.name) ?? { ar: row.level.code } } : null,
      durationHours: row.durationHours === null ? null : Number(row.durationHours),
      sessionsCount: row.sessionsCount,
      syllabusCount: row._count.syllabusItems,
      pricing: plan === null ? 'free' : 'paid',
      price: price ? { amount: price.total, currency: price.currency, installments: price.installments } : null,
      openClasses: classes.length,
      availableClasses: available.length,
      teachers: [...teachers.values()],
      mine: {
        enrolled: own.some((item) => item.status === 'active' || item.status === 'completed'),
        pending: own.some((item) => item.status === 'pending'),
      },
    };
  }

  private toClass(
    klass: ClassRow,
    mine: readonly MineRow[],
    schedule: CatalogSlotDto[],
    course: { selfService: boolean; coursePaid: boolean; priceUsable: boolean },
  ): CatalogClassDto {
    const own = mine.find((item) => item.classId === klass.id) ?? null;
    const blocker = classBlocker({
      selfService: course.selfService,
      mine: own,
      selfEnrollment: klass.selfEnrollment,
      status: klass.status,
      capacity: klass.capacity,
      enrolledCount: klass._count.enrollments,
      coursePaid: course.coursePaid,
      priceUsable: course.priceUsable,
    });
    const lead = klass.teachers[0]?.teacher ?? null;
    return {
      id: klass.id,
      code: klass.code,
      name: readLocalizedText(klass.name) ?? { ar: klass.code },
      status: klass.status,
      startsOn: dateOnly(klass.startsOn),
      endsOn: dateOnly(klass.endsOn),
      capacity: klass.capacity,
      enrolledCount: klass._count.enrollments,
      seatsLeft: seatsLeft(klass.capacity, klass._count.enrollments),
      leadTeacher: lead ? { fullName: lead.fullName, displayName: lead.displayName } : null,
      schedule,
      selfEnrollment: klass.selfEnrollment,
      enrollable: blocker === null,
      blocker,
      myEnrollment:
        own && !isClosedRequest(own)
          ? { id: own.id, status: own.status, state: requestStateOf(own, requestPayment(course.coursePaid, own.invoices).state) }
          : null,
    };
  }

  /** The classes of these courses open to self-service now (D-R123). */
  private openClasses(courseIds: readonly string[]): Promise<ClassRow[]> {
    return selfServiceClassesOf(this.prisma.db, courseIds);
  }

  /** The reader's own enrollments in classes of these courses (any status; closed requests are filtered by the callers). */
  private async mineIn(userId: string, courseIds: readonly string[]): Promise<MineRow[]> {
    if (courseIds.length === 0) return [];
    return this.prisma.db.enrollment.findMany({ where: { studentUserId: userId, class: { courseId: { in: [...courseIds] } } }, select: MINE_SELECT });
  }

  /** Weekly slots effective today or later, by class, in weekday and time order; each in its room's branch zone, else the academy's. */
  private async slotsOf(classIds: readonly string[], academyZone: string): Promise<Map<string, CatalogSlotDto[]>> {
    const map = new Map<string, CatalogSlotDto[]>();
    if (classIds.length === 0) return map;
    const today = calendarDateIn(academyZone);
    const rows = await this.prisma.db.classSchedule.findMany({
      where: { classId: { in: [...classIds] }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(`${today}T00:00:00.000Z`) } }] },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
      select: { classId: true, weekday: true, startTime: true, endTime: true, effectiveFrom: true, effectiveTo: true, room: { select: { branch: { select: { timezone: true } } } } },
    });
    for (const row of rows) {
      const list = map.get(row.classId) ?? [];
      list.push({
        weekday: row.weekday,
        startTime: columnToClockTime(row.startTime),
        endTime: columnToClockTime(row.endTime),
        timeZone: row.room?.branch?.timezone ?? academyZone,
        effectiveFrom: columnToCalendarDate(row.effectiveFrom),
        effectiveTo: row.effectiveTo ? columnToCalendarDate(row.effectiveTo) : null,
      });
      map.set(row.classId, list);
    }
    return map;
  }

  /** The `available` filter of API-219 (`availableCourseIdsOf()`). */
  private availableCourseIds(): Promise<string[]> {
    return availableCourseIdsOf(this.prisma.db);
  }

  private currency(): Promise<string> {
    return academyCurrency(this.prisma.db);
  }

  private async academyZone(): Promise<string> {
    const academy = await this.prisma.db.academy.findFirst({ select: { timezone: true } });
    return academy?.timezone ?? 'UTC';
  }
}

/**
 * Published courses with at least one class a reader could enroll in now:
 * open to self-service, a free seat, and for a paid course a plan that can
 * price a request (active, no class, this course or none — D-R122). The
 * `available` filter of API-219 and of the public API-236 (PORTAL-01, #205).
 */
export async function availableCourseIdsOf(db: Db): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT c.course_id AS id
    FROM classes c JOIN courses co ON co.id = c.course_id
    WHERE c.self_enrollment AND c.status IN ('open', 'running') AND co.status = 'published'
      AND (SELECT count(*) FROM enrollments e WHERE e.class_id = c.id AND e.status = 'active') < c.capacity
      AND (co.enrollment_fee_plan_id IS NULL OR EXISTS (
        SELECT 1 FROM fee_plans p
        WHERE p.id = co.enrollment_fee_plan_id AND p.is_active AND p.class_id IS NULL AND (p.course_id IS NULL OR p.course_id = co.id)))`;
  return rows.map((row) => row.id);
}
