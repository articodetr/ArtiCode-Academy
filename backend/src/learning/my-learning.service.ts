import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ownedEnrollmentsWhere } from '../lessons/my-lessons.policy.js';
import { relationOf } from '../enrollments/my-classes.policy.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { displayTimeZone } from '../schedule/timetable.policy.js';
import { completionModeOf, displayDurationSecondsOf, playbackDurationOf, readLessonContent, readLessonResources } from './learning.content.js';
import type { CompletionMode, LessonContent } from './learning.content.js';
import { buildCurriculum, learningOrder, neighborsOf, resumeTargetOf } from './learning.curriculum.js';
import type { CurriculumGroup } from './learning.curriculum.js';
import { learningError } from './learning.errors.js';
import { learningActionOf, planPlayback, progressOf, readStoredRanges } from './learning.progress.js';
import type { ProgressCounts } from './learning.progress.js';
import { ITEM_SELECT, loadCurriculumRows, loadLastOpened, loadLessonStates, stateOf } from './learning.read.js';
import type { ItemRow, LessonStates, SectionRow, StoredLessonState } from './learning.read.js';
import type {
  LearningCompleteResultDto,
  LearningItemDto,
  LearningPlaybackResultDto,
  LearningVisitResultDto,
  LearningWorkspaceDto,
  MyLearningCourseDto,
  MyLearningItemProgressDto,
  MyLearningListDto,
  MyLearningProgressCountsDto,
  OwnedEnrollmentStatus,
  SavePlaybackDto,
  WorkspaceItemDto,
} from './my-learning.dto.js';
import { compareMyLearning, completionPercentOf, lastActivityOf, learningAccessOf, MY_LEARNING_ITEMS_MAX, watchedPercentOf } from './my-learning.policy.js';

type Db = PrismaService['db'] | Prisma.TransactionClient;
type Group = CurriculumGroup<SectionRow, ItemRow>;

/** The academy's time zone while its row is missing (as «my lessons»). */
const FALLBACK_TIME_ZONE = 'UTC';
/** Sessions of one lesson shown at most (a lesson is normally covered by one session per class). */
const SESSIONS_MAX = 100;

// Only what a learner may know about their own (or their child's) enrollment:
// the student's identity, the class and course summary, the lead teacher by name.
const ENROLLMENT_SELECT = {
  id: true,
  status: true,
  enrolledAt: true,
  activatedAt: true,
  completedAt: true,
  studentUserId: true,
  student: { select: { id: true, fullName: true, displayName: true } },
  class: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      startsOn: true,
      endsOn: true,
      course: { select: { id: true, code: true, name: true, summary: true, coverImageUrl: true, level: { select: { id: true, name: true } } } },
      teachers: { where: { role: 'lead' }, take: 1, select: { teacher: { select: { fullName: true, displayName: true } } } },
    },
  },
} satisfies Prisma.EnrollmentSelect;

type EnrollmentRow = Prisma.EnrollmentGetPayload<{ select: typeof ENROLLMENT_SELECT }>;

const ACCESS_SELECT = { id: true, status: true, enrolledAt: true, class: { select: { id: true, code: true, name: true } } } satisfies Prisma.EnrollmentSelect;
type AccessRow = Prisma.EnrollmentGetPayload<{ select: typeof ACCESS_SELECT }>;

const SESSION_SELECT = {
  id: true,
  classId: true,
  title: true,
  startsAt: true,
  endsAt: true,
  status: true,
  deliveryMode: true,
  meetingUrl: true,
  room: { select: { branch: { select: { timezone: true } } } },
} satisfies Prisma.LessonSelect;

interface AcademyLearning {
  completionPercent: number;
  timeZone: string;
}

/** One course as the learner sees it: the levels with their published lessons, and the learner's states. */
interface CourseView {
  items: ItemRow[];
  groups: Group[];
  published: ItemRow[];
  states: Map<string, StoredLessonState>;
  lastOpened: { itemId: string; at: Date } | null;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function titleOf(value: unknown): LocalizedText {
  return readLocalizedText(value) ?? { ar: '' };
}

/** The states of one student on the given lessons, by lesson id (a missing one is `not_started`). */
function statesFor(states: LessonStates, studentId: string, items: readonly ItemRow[]): Map<string, StoredLessonState> {
  return new Map(items.map((item) => [item.id, stateOf(states, studentId, item.id)]));
}

function toCounts(counts: ProgressCounts): MyLearningProgressCountsDto {
  return { ...counts, completedAt: iso(counts.completedAt) };
}

function contentOf(item: ItemRow): LessonContent | null {
  return readLessonContent(item.kind, item.content);
}

function toItemProgress(state: StoredLessonState, item: ItemRow): MyLearningItemProgressDto {
  const duration = playbackDurationOf(item.kind, contentOf(item));
  return {
    state: state.state,
    completedAt: iso(state.completedAt),
    completionSource: state.state === 'completed' ? state.completionSource : null,
    positionSeconds: state.positionSeconds,
    watchedSeconds: state.watchedSeconds,
    watchedPercent: watchedPercentOf(state.watchedSeconds, duration),
  };
}

function groupOf(groups: readonly Group[], itemId: string): Group | undefined {
  return groups.find((group) => group.items.some((item) => item.id === itemId));
}

function ownedStatus(status: string): OwnedEnrollmentStatus {
  return status === 'completed' ? 'completed' : 'active';
}

/**
 * MOD-20 — «My School», the learner's side (roadmap §4q, API-229..234). By
 * ownership, no permission key (D-R132): the caller's own `active`/`completed`
 * enrollments open a course's content; a guardian reads their linked children's
 * progress on «My School» (API-229) and nothing else. Every read and write is
 * keyed by the caller's own id — no route takes a student id. The progress is
 * computed on read from the stored per-lesson rows and the attendance of live
 * lessons (ADR-078, D-R133..D-R135); the writes (visit, playback, completion)
 * record no audit event (D-R139).
 */
@Injectable()
export class MyLearningService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // API-229 — «مدرستي»
  // -------------------------------------------------------------------------

  async list(caller: AuthPrincipal): Promise<MyLearningListDto> {
    const db = this.prisma.db;
    const enrollments = await db.enrollment.findMany({
      where: ownedEnrollmentsWhere(caller),
      orderBy: [{ enrolledAt: 'desc' }, { id: 'desc' }],
      take: MY_LEARNING_ITEMS_MAX,
      select: ENROLLMENT_SELECT,
    });
    if (enrollments.length === 0) return { items: [] };
    const courseIds = [...new Set(enrollments.map((row) => row.class.course.id))];
    const studentIds = [...new Set(enrollments.map((row) => row.studentUserId))];
    const curricula = await loadCurriculumRows(db, courseIds);
    const allItems = [...curricula.values()].flatMap((rows) => rows.items);
    const states = await loadLessonStates(db, studentIds, courseIds, allItems);
    const lastOpened = await loadLastOpened(db, studentIds, courseIds);

    const groupsByCourse = new Map<string, Group[]>();
    for (const [courseId, rows] of curricula) groupsByCourse.set(courseId, buildCurriculum(rows.sections, rows.items, { learner: true }));

    const items = enrollments.map((row) => {
      const courseId = row.class.course.id;
      const rows = curricula.get(courseId) ?? { sections: [], items: [] };
      const groups = groupsByCourse.get(courseId) ?? [];
      const published = groups.flatMap((group) => group.items);
      const progress = progressOf(published, statesFor(states, row.studentUserId, published));
      const courseStates = [...statesFor(states, row.studentUserId, rows.items).values()];
      const opened = lastOpened.get(`${row.studentUserId}|${courseId}`) ?? null;
      const relation = relationOf(row.studentUserId, caller.id);
      const hasHistory = opened !== null || courseStates.some((state) => state.state !== 'not_started');
      const lastActivityAt = lastActivityOf(courseStates);
      return { row, relation, lastActivityAt, dto: this.toCourseItem(row, relation, groups, progress, opened, lastActivityAt, hasHistory) };
    });
    items.sort((a, b) =>
      compareMyLearning(
        { relation: a.relation, lastActivityAt: a.lastActivityAt, enrolledAt: a.row.enrolledAt, enrollmentId: a.row.id },
        { relation: b.relation, lastActivityAt: b.lastActivityAt, enrolledAt: b.row.enrolledAt, enrollmentId: b.row.id },
      ),
    );
    return { items: items.map((item) => item.dto) };
  }

  private toCourseItem(
    row: EnrollmentRow,
    relation: 'self' | 'child',
    groups: readonly Group[],
    progress: ProgressCounts,
    opened: { itemId: string; at: Date } | null,
    lastActivityAt: Date | null,
    hasHistory: boolean,
  ): MyLearningCourseDto {
    const course = row.class.course;
    const lead = row.class.teachers[0]?.teacher ?? null;
    const openedGroup = opened ? groupOf(groups, opened.itemId) : undefined;
    const openedItem = opened && openedGroup ? openedGroup.items.find((item) => item.id === opened.itemId) : undefined;
    return {
      enrollmentId: row.id,
      relation,
      student: { id: row.student.id, fullName: row.student.fullName, displayName: row.student.displayName },
      enrollment: { status: ownedStatus(row.status), enrolledAt: row.enrolledAt.toISOString(), activatedAt: iso(row.activatedAt), completedAt: iso(row.completedAt) },
      class: {
        id: row.class.id,
        code: row.class.code,
        name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
        status: row.class.status,
        startsOn: dateOnly(row.class.startsOn),
        endsOn: dateOnly(row.class.endsOn),
      },
      course: {
        id: course.id,
        code: course.code,
        name: readLocalizedText(course.name) ?? { ar: course.code },
        summary: readLocalizedText(course.summary),
        coverImageUrl: course.coverImageUrl,
        level: course.level ? { id: course.level.id, name: readLocalizedText(course.level.name) ?? { ar: '' } } : null,
      },
      leadTeacher: lead ? { fullName: lead.fullName, displayName: lead.displayName } : null,
      progress: toCounts(progress),
      lastLesson:
        opened && openedGroup && openedItem
          ? {
              id: openedItem.id,
              title: titleOf(openedItem.title),
              sectionNumber: openedGroup.number,
              sectionTitle: openedGroup.section ? readLocalizedText(openedGroup.section.title) : null,
              openedAt: opened.at.toISOString(),
            }
          : null,
      lastActivityAt: iso(lastActivityAt),
      action: relation === 'self' ? learningActionOf(hasHistory, progress) : null,
      canLearn: relation === 'self',
    };
  }

  // -------------------------------------------------------------------------
  // API-230 — the workspace
  // -------------------------------------------------------------------------

  async workspace(courseId: string, caller: AuthPrincipal): Promise<LearningWorkspaceDto> {
    const db = this.prisma.db;
    const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true, code: true, name: true, coverImageUrl: true } });
    if (!course) throw learningError.courseNotFound(courseId);
    const access = await this.requireAccess(db, caller.id, courseId);
    const view = await this.courseView(db, caller.id, courseId);
    const academy = await this.academy(db);

    const sortKey = new Map(view.items.map((item) => [item.id, item.sortOrder]));
    const order = learningOrder(view.groups);
    const completed = new Set([...view.states].filter(([, state]) => state.state === 'completed').map(([id]) => id));
    const target = resumeTargetOf(
      order,
      view.lastOpened ? { itemId: view.lastOpened.itemId, sortKey: sortKey.get(view.lastOpened.itemId) ?? -1 } : null,
      completed,
      (id) => sortKey.get(id) ?? -1,
    );
    const targetItem = target ? view.published.find((item) => item.id === target.itemId) : undefined;
    const targetState = targetItem ? view.states.get(targetItem.id) : undefined;
    const tracksPosition = targetItem !== undefined && playbackDurationOf(targetItem.kind, contentOf(targetItem)) !== null;

    return {
      course: { id: course.id, code: course.code, name: readLocalizedText(course.name) ?? { ar: course.code }, coverImageUrl: course.coverImageUrl },
      enrollment: {
        id: access.enrollment.id,
        status: ownedStatus(access.enrollment.status),
        class: {
          id: access.enrollment.class.id,
          code: access.enrollment.class.code,
          name: readLocalizedText(access.enrollment.class.name) ?? { ar: access.enrollment.class.code },
        },
      },
      completionPercent: academy.completionPercent,
      sections: view.groups.map((group) => ({
        id: group.section?.id ?? null,
        number: group.number,
        title: group.section ? readLocalizedText(group.section.title) : null,
        description: group.section ? readLocalizedText(group.section.description) : null,
        items: group.items.map((item) => this.toWorkspaceItem(item, view.states.get(item.id)!)),
        progress: toCounts(progressOf(group.items, view.states)),
      })),
      progress: toCounts(progressOf(view.published, view.states)),
      resume: target ? { itemId: target.itemId, reason: target.reason, positionSeconds: tracksPosition ? (targetState?.positionSeconds ?? null) : null } : null,
    };
  }

  private toWorkspaceItem(item: ItemRow, state: StoredLessonState): WorkspaceItemDto {
    const content = contentOf(item);
    return {
      id: item.id,
      title: titleOf(item.title),
      kind: item.kind,
      isRequired: item.isRequired,
      estimatedMinutes: item.estimatedMinutes,
      durationSeconds: displayDurationSecondsOf(item.kind, content, item.estimatedMinutes),
      completionMode: completionModeOf(item.kind, content),
      state: state.state,
      completedAt: iso(state.completedAt),
    };
  }

  // -------------------------------------------------------------------------
  // API-231 — one lesson (read-only)
  // -------------------------------------------------------------------------

  async item(itemId: string, caller: AuthPrincipal): Promise<LearningItemDto> {
    const db = this.prisma.db;
    const item = await this.publishedItem(db, itemId);
    const access = await this.requireAccess(db, caller.id, item.courseId);
    const view = await this.courseView(db, caller.id, item.courseId);
    const academy = await this.academy(db);
    const content = contentOf(item);
    const group = groupOf(view.groups, item.id);
    const order = learningOrder(view.groups);
    const neighbors = neighborsOf(order, item.id);
    const byId = new Map(view.published.map((row) => [row.id, row]));
    const neighbor = (id: string | null) => {
      const row = id === null ? undefined : byId.get(id);
      return row ? { id: row.id, title: titleOf(row.title) } : null;
    };

    const classIds = access.owned.map((row) => row.class.id);
    const sessions = await db.lesson.findMany({
      where: { classId: { in: classIds }, syllabusItemId: item.id },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: SESSIONS_MAX,
      select: SESSION_SELECT,
    });
    const sessionIds = sessions.map((row) => row.id);
    const zoneOf = new Map(sessions.map((row) => [row.id, displayTimeZone(row.room?.branch?.timezone, academy.timeZone)]));
    const [records, assignments, exams] =
      sessionIds.length === 0
        ? [[], [], []]
        : [
            await db.attendanceRecord.findMany({ where: { lessonId: { in: sessionIds }, studentUserId: caller.id }, select: { lessonId: true, status: true, minutesLate: true } }),
            await db.assignment.findMany({
              where: { lessonId: { in: sessionIds }, status: { not: 'draft' } },
              orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
              select: { id: true, classId: true, lessonId: true, title: true, dueAt: true, status: true },
            }),
            await db.exam.findMany({
              where: { lessonId: { in: sessionIds }, status: { in: ['scheduled', 'published'] } },
              orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
              select: { id: true, classId: true, title: true, type: true, scheduledAt: true, status: true },
            }),
          ];
    const recordOf = new Map(records.map((row) => [row.lessonId, row]));

    return {
      id: item.id,
      courseId: item.courseId,
      title: titleOf(item.title),
      description: readLocalizedText(item.description),
      kind: item.kind,
      content: content as unknown as Record<string, unknown> | null,
      resources: readLessonResources(item.resources),
      isRequired: item.isRequired,
      estimatedMinutes: item.estimatedMinutes,
      durationSeconds: displayDurationSecondsOf(item.kind, content, item.estimatedMinutes),
      section: group
        ? { id: group.section?.id ?? null, number: group.number, title: group.section ? readLocalizedText(group.section.title) : null }
        : { id: null, number: 1, title: null },
      completionMode: completionModeOf(item.kind, content),
      completionPercent: academy.completionPercent,
      progress: toItemProgress(view.states.get(item.id) ?? (await this.itemState(db, caller.id, item)), item),
      neighbors: { previous: neighbor(neighbors.previous), next: neighbor(neighbors.next) },
      sessions: sessions.map((row) => {
        const record = recordOf.get(row.id);
        return {
          id: row.id,
          classId: row.classId,
          title: titleOf(row.title),
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          status: row.status,
          deliveryMode: row.deliveryMode,
          meetingUrl: row.status === 'cancelled' ? null : row.meetingUrl,
          timeZone: zoneOf.get(row.id) ?? academy.timeZone,
          attendance: record ? { status: record.status, minutesLate: record.minutesLate } : null,
        };
      }),
      assignments: assignments.map((row) => ({
        id: row.id,
        classId: row.classId,
        title: titleOf(row.title),
        dueAt: iso(row.dueAt),
        status: row.status,
        timeZone: (row.lessonId ? zoneOf.get(row.lessonId) : undefined) ?? academy.timeZone,
      })),
      exams: exams.map((row) => ({ id: row.id, classId: row.classId, title: titleOf(row.title), type: row.type, scheduledAt: iso(row.scheduledAt), status: row.status })),
    };
  }

  // -------------------------------------------------------------------------
  // API-232 — opening a lesson
  // -------------------------------------------------------------------------

  async visit(itemId: string, caller: AuthPrincipal): Promise<LearningVisitResultDto> {
    const db = this.prisma.db;
    const item = await this.publishedItem(db, itemId);
    await this.requireAccess(db, caller.id, item.courseId);
    const now = new Date().toISOString();
    // One statement: a new row is `in_progress`; an existing one only moves `last_opened_at` (a completed lesson stays completed).
    await db.$executeRaw`
      INSERT INTO learning_progress (student_user_id, syllabus_item_id, course_id, status, first_opened_at, last_opened_at, created_at, updated_at)
      VALUES (${caller.id}::uuid, ${item.id}::uuid, ${item.courseId}::uuid, 'in_progress'::learning_status, ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (student_user_id, syllabus_item_id) DO UPDATE SET last_opened_at = EXCLUDED.last_opened_at, updated_at = EXCLUDED.updated_at`;
    return { progress: toItemProgress(await this.itemState(db, caller.id, item), item) };
  }

  // -------------------------------------------------------------------------
  // API-233 — playback coverage
  // -------------------------------------------------------------------------

  async playback(itemId: string, body: SavePlaybackDto, caller: AuthPrincipal): Promise<LearningPlaybackResultDto> {
    const db = this.prisma.db;
    const item = await this.publishedItem(db, itemId);
    await this.requireAccess(db, caller.id, item.courseId);
    const duration = playbackDurationOf(item.kind, contentOf(item));
    if (duration === null) throw learningError.playbackNotTracked(item.id);
    const { completionPercent } = await this.academy(db);

    const plan = await db.$transaction(async (tx) => {
      const now = new Date();
      const at = now.toISOString();
      const key = { studentUserId_syllabusItemId: { studentUserId: caller.id, syllabusItemId: item.id } };
      // Lock the learner's row on this lesson, creating it first when the medium plays before any visit.
      await tx.$executeRaw`
        INSERT INTO learning_progress (student_user_id, syllabus_item_id, course_id, status, first_opened_at, last_opened_at, created_at, updated_at)
        VALUES (${caller.id}::uuid, ${item.id}::uuid, ${item.courseId}::uuid, 'in_progress'::learning_status, ${at}::timestamptz, ${at}::timestamptz, ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT (student_user_id, syllabus_item_id) DO NOTHING`;
      await tx.$queryRaw`SELECT 1 FROM learning_progress WHERE student_user_id = ${caller.id}::uuid AND syllabus_item_id = ${item.id}::uuid FOR UPDATE`;
      const row = await tx.learningProgress.findUniqueOrThrow({ where: key, select: { status: true, lastOpenedAt: true, lastPlaybackAt: true, watchedRanges: true } });
      const planned = planPlayback(
        { ranges: readStoredRanges(row.watchedRanges, duration), lastPlaybackAt: row.lastPlaybackAt, lastOpenedAt: row.lastOpenedAt, completed: row.status === 'completed' },
        { positionSeconds: body.positionSeconds, ranges: body.ranges },
        duration,
        completionPercent,
        now,
      );
      await tx.learningProgress.update({
        where: key,
        data: {
          watchedRanges: planned.ranges,
          watchedSeconds: planned.watchedSeconds,
          positionSeconds: planned.positionSeconds,
          mediaDurationSeconds: duration,
          lastPlaybackAt: now,
          ...(planned.completes ? { status: 'completed' as const, completedAt: now, completionSource: 'playback' as const } : {}),
        },
      });
      return planned;
    });

    const view = await this.courseView(db, caller.id, item.courseId);
    const state = view.states.get(item.id) ?? (await this.itemState(db, caller.id, item));
    return { progress: toItemProgress(state, item), course: toCounts(progressOf(view.published, view.states)), completedNow: plan.completes, capped: plan.capped };
  }

  // -------------------------------------------------------------------------
  // API-234 — «mark as complete»
  // -------------------------------------------------------------------------

  async complete(itemId: string, caller: AuthPrincipal): Promise<LearningCompleteResultDto> {
    const db = this.prisma.db;
    const item = await this.publishedItem(db, itemId);
    await this.requireAccess(db, caller.id, item.courseId);
    const mode: CompletionMode = completionModeOf(item.kind, contentOf(item));
    if (mode === 'playback') throw learningError.completionByPlayback(item.id, (await this.academy(db)).completionPercent);
    if (mode === 'attendance') throw learningError.completionByAttendance(item.id);

    const now = new Date().toISOString();
    // One statement: insert completed, or complete an in-progress row; an already completed row is not touched (0 rows).
    const written = await db.$executeRaw`
      INSERT INTO learning_progress (student_user_id, syllabus_item_id, course_id, status, completion_source, first_opened_at, last_opened_at, completed_at, created_at, updated_at)
      VALUES (${caller.id}::uuid, ${item.id}::uuid, ${item.courseId}::uuid, 'completed'::learning_status, 'manual'::learning_completion_source,
              ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (student_user_id, syllabus_item_id) DO UPDATE
        SET status = 'completed'::learning_status, completion_source = 'manual'::learning_completion_source, completed_at = EXCLUDED.completed_at, updated_at = EXCLUDED.updated_at
        WHERE learning_progress.status <> 'completed'::learning_status`;

    const view = await this.courseView(db, caller.id, item.courseId);
    const group = groupOf(view.groups, item.id);
    const state = view.states.get(item.id) ?? (await this.itemState(db, caller.id, item));
    return {
      progress: toItemProgress(state, item),
      section: toCounts(progressOf(group?.items ?? [], view.states)),
      course: toCounts(progressOf(view.published, view.states)),
      completedNow: written > 0,
    };
  }

  // -------------------------------------------------------------------------
  // Shared reads
  // -------------------------------------------------------------------------

  /** A published lesson, else `404 lesson_not_found` (an unknown and an unpublished lesson look the same). */
  private async publishedItem(db: Db, itemId: string): Promise<ItemRow> {
    const item = await db.courseSyllabusItem.findUnique({ where: { id: itemId }, select: ITEM_SELECT });
    if (!item || !item.isPublished) throw learningError.lessonNotFound(itemId);
    return item;
  }

  /** The caller's own enrollment that opens the course (D-R132), else `403 not_enrolled { reason }`. */
  private async requireAccess(db: Db, callerId: string, courseId: string): Promise<{ enrollment: AccessRow; owned: AccessRow[] }> {
    const rows = await db.enrollment.findMany({ where: { studentUserId: callerId, class: { courseId } }, select: ACCESS_SELECT });
    const access = learningAccessOf(rows);
    if (!access.allowed) throw learningError.notEnrolled(courseId, access.reason);
    return { enrollment: access.enrollment, owned: access.owned };
  }

  private async courseView(db: Db, studentId: string, courseId: string): Promise<CourseView> {
    const rows = (await loadCurriculumRows(db, [courseId])).get(courseId) ?? { sections: [], items: [] };
    const groups = buildCurriculum(rows.sections, rows.items, { learner: true });
    const published = groups.flatMap((group) => group.items);
    const states = await loadLessonStates(db, [studentId], [courseId], rows.items);
    const lastOpened = (await loadLastOpened(db, [studentId], [courseId])).get(`${studentId}|${courseId}`) ?? null;
    return { items: rows.items, groups, published, states: statesFor(states, studentId, rows.items), lastOpened };
  }

  private async itemState(db: Db, studentId: string, item: ItemRow): Promise<StoredLessonState> {
    const states = await loadLessonStates(db, [studentId], [item.courseId], [item]);
    return stateOf(states, studentId, item.id);
  }

  private async academy(db: Db): Promise<AcademyLearning> {
    const row = await db.academy.findFirst({ select: { timezone: true, settings: true } });
    return { completionPercent: completionPercentOf(row?.settings), timeZone: row?.timezone ?? FALLBACK_TIME_ZONE };
  }
}
