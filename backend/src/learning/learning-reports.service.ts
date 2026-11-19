import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { classesError } from '../classes/classes.errors.js';
import { MANAGE_ENROLLMENTS_PERMISSION } from '../classes/classes.policy.js';
import { canReadRoster } from '../enrollments/enrollments.status.js';
import { ROSTER_STUDENT_SELECT, rosterProjectionOf, toRosterStudentDto } from '../enrollments/roster-student.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CLASS_PROGRESS_ENROLLMENT_STATUSES } from './learning-reports.dto.js';
import type { ClassLearningCountsDto, ClassLearningProgressDto, ClassLearningStudentDto, ClassProgressEnrollmentStatus } from './learning-reports.dto.js';
import { buildCurriculum } from './learning.curriculum.js';
import { progressOf } from './learning.progress.js';
import type { ProgressCounts } from './learning.progress.js';
import { loadCurriculumRows, loadLastOpened, loadLessonStates, stateOf } from './learning.read.js';
import type { LessonStates, StoredLessonState } from './learning.read.js';

function toCounts(progress: ProgressCounts): ClassLearningCountsDto {
  return { ...progress, completedAt: progress.completedAt ? progress.completedAt.toISOString() : null };
}

/** The latest opening or completion among the states (the «my learning» rule of API-229); null when there is none. */
function lastActivityOf(states: Iterable<Pick<StoredLessonState, 'lastOpenedAt' | 'completedAt'>>): Date | null {
  let latest: Date | null = null;
  for (const state of states) {
    for (const at of [state.lastOpenedAt, state.completedAt]) {
      if (at !== null && (latest === null || at > latest)) latest = at;
    }
  }
  return latest;
}

/** One student's states on these lessons, keyed by lesson id (what `progressOf()` reads). */
function statesOfStudent(states: LessonStates, studentId: string, itemIds: readonly string[]): Map<string, StoredLessonState> {
  return new Map(itemIds.map((itemId) => [itemId, stateOf(states, studentId, itemId)]));
}

/**
 * MOD-20 (roadmap §4q, D-R137) — API-235: the learning progress of a class
 * for its teachers and the office. `enrollments.read` at the controller; the
 * class must be readable as its roster is (API-057, D-R16): a holder of
 * `enrollments.manage`, or a teacher assigned to the class — anyone else, and
 * an unknown class, 404 class_not_found. One row per `active` or `completed`
 * enrollment in enrollment order, the student in the caller's D-R07
 * projection. The numbers come from the learner's own rules
 * (`loadLessonStates()` + `buildCurriculum(…, { learner: true })` +
 * `progressOf()`), so they equal what the learner sees in «My School»; the
 * progress is the student's on the COURSE (it follows them across its
 * classes — D-R133). Read-only, no audit event.
 */
@Injectable()
export class LearningReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async classProgress(classId: string, caller: AuthPrincipal): Promise<ClassLearningProgressDto> {
    const db = this.prisma.db;
    const klass = await db.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        course: { select: { id: true, code: true, name: true } },
        teachers: { where: { teacherUserId: caller.id }, select: { teacherUserId: true } },
      },
    });
    const manages = caller.permissions.includes(MANAGE_ENROLLMENTS_PERMISSION);
    if (!klass || !canReadRoster(manages, klass.teachers.length > 0)) throw classesError.classNotFound(classId);
    const courseId = klass.course.id;

    const [enrollments, curricula] = await Promise.all([
      db.enrollment.findMany({
        where: { classId, status: { in: [...CLASS_PROGRESS_ENROLLMENT_STATUSES] } },
        orderBy: [{ id: 'asc' }],
        select: { id: true, status: true, studentUserId: true, student: { select: ROSTER_STUDENT_SELECT } },
      }),
      loadCurriculumRows(db, [courseId]),
    ]);
    const rows = curricula.get(courseId) ?? { sections: [], items: [] };
    const groups = buildCurriculum(rows.sections, rows.items, { learner: true });
    const published = groups.flatMap((group) => group.items);
    const publishedById = new Map(published.map((item) => [item.id, item]));
    const allItemIds = rows.items.map((item) => item.id);
    const publishedIds = published.map((item) => item.id);

    const studentIds = [...new Set(enrollments.map((row) => row.studentUserId))];
    const [states, lastOpened] = await Promise.all([
      loadLessonStates(db, studentIds, [courseId], rows.items),
      loadLastOpened(db, studentIds, [courseId]),
    ]);
    const view = rosterProjectionOf(caller);

    const students: ClassLearningStudentDto[] = enrollments.map((row) => {
      const progress = progressOf(published, statesOfStudent(states, row.studentUserId, publishedIds));
      const opened = lastOpened.get(`${row.studentUserId}|${courseId}`) ?? null;
      const openedItem = opened ? publishedById.get(opened.itemId) : undefined;
      return {
        enrollmentId: row.id,
        enrollmentStatus: row.status as ClassProgressEnrollmentStatus,
        student: toRosterStudentDto(row.student, view),
        progress: toCounts(progress),
        lastActivityAt: lastActivityOf(statesOfStudent(states, row.studentUserId, allItemIds).values())?.toISOString() ?? null,
        lastLesson: openedItem ? { id: openedItem.id, title: readLocalizedText(openedItem.title) ?? { ar: '—' } } : null,
      };
    });

    return {
      classId: klass.id,
      course: { id: courseId, code: klass.course.code, name: readLocalizedText(klass.course.name) ?? { ar: klass.course.code } },
      totals: { lessons: published.length, required: published.filter((item) => item.isRequired).length },
      students,
    };
  }
}
