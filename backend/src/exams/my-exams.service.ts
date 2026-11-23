import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import type { EnrollmentStatus, Prisma } from '../generated/prisma/client.js';
import { gradesError } from '../grades/grades.errors.js';
import { expandLessonOwnership, ownedClassIds, ownedEnrollmentsWhere, ownershipOf } from '../lessons/my-lessons.policy.js';
import type { LessonOwnership } from '../lessons/my-lessons.policy.js';
import { toInstant, toIso } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { displayTimeZone } from '../schedule/timetable.policy.js';
import { isResultReleased, remainingSeconds, takeState } from './attempts.policy.js';
import { EXAMS_PAGE_DEFAULT } from './exams.dto.js';
import { EXAM_SORT_FIELD, afterExamCursor, examCursorKey, examOrderBy } from './exams.keyset.js';
import { TAKE_EXAMS_PERMISSION } from './exams.policy.js';
import type { ListMyExamsQueryDto, MyExamItemDto, MyExamListDto, MyExamOnlineDto } from './my-exams.dto.js';
import { MY_EXAM_STATUSES, visibleResult } from './my-exams.policy.js';
import type { MyExamResultView, MyExamStatus, ResultSourceValue } from './my-exams.policy.js';

/** The academy's time zone for `timeZone` (D-R41), or UTC while the academy row is missing. */
const FALLBACK_TIME_ZONE = 'UTC';

// Only what a learner may know about an exam of their class: never the weight
// (the final grade explains it through «my grades»), `created_by`, the results
// sheet or anyone else's result — and of an online exam never a question or a
// key: the questions are served by the attempt alone, once it has started.
const MY_EXAM_SELECT = {
  id: true,
  classId: true,
  title: true,
  description: true,
  type: true,
  status: true,
  scheduledAt: true,
  durationMinutes: true,
  maxScore: true,
  passScore: true,
  publishedAt: true,
  delivery: true,
  closesAt: true,
  attemptsAllowed: true,
  resultsRelease: true,
  revealAnswers: true,
  lesson: { select: { id: true, title: true, startsAt: true, room: { select: { branch: { select: { timezone: true } } } } } },
  class: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.ExamSelect;

const MY_ATTEMPT_SELECT = {
  id: true,
  examId: true,
  studentUserId: true,
  attemptNo: true,
  status: true,
  startedAt: true,
  expiresAt: true,
  submittedAt: true,
  score: true,
} satisfies Prisma.ExamAttemptSelect;

type MyExamRow = Prisma.ExamGetPayload<{ select: typeof MY_EXAM_SELECT }>;
type MyAttemptRow = Prisma.ExamAttemptGetPayload<{ select: typeof MY_ATTEMPT_SELECT }>;

/** What the online side of an item is computed from, beside the exam itself. */
interface OnlineContext {
  attempts: readonly MyAttemptRow[];
  questionCount: number;
  enrollmentStatus: EnrollmentStatus | null;
  mayTake: boolean;
  now: Date;
}

function resultKey(examId: string, studentId: string): string {
  return `${examId}|${studentId}`;
}

/** The online side of one item at the server clock (D-R152..D-R156): the same `takeState()` the start of an attempt enforces. */
function toOnline(row: MyExamRow, ownership: LessonOwnership, context: OnlineContext): MyExamOnlineDto {
  const state = takeState({
    relation: ownership.relation,
    mayTake: context.mayTake,
    examStatus: row.status,
    classStatus: row.class.status,
    enrollmentStatus: context.enrollmentStatus,
    scheduledAt: row.scheduledAt,
    closesAt: row.closesAt,
    attemptsAllowed: row.attemptsAllowed,
    attempts: context.attempts,
    now: context.now,
  });
  const released = isResultReleased(row);
  return {
    closesAt: row.closesAt ? toIso(row.closesAt) : null,
    attemptsAllowed: row.attemptsAllowed,
    attemptsUsed: state.attemptsUsed,
    questionCount: context.questionCount,
    resultsRelease: row.resultsRelease,
    revealAnswers: row.revealAnswers,
    canStart: state.canStart,
    blocker: state.blocker,
    inProgress: state.inProgress
      ? { id: state.inProgress.id, attemptNo: state.inProgress.attemptNo, expiresAt: toIso(state.inProgress.expiresAt), remainingSeconds: remainingSeconds(state.inProgress.expiresAt, context.now) }
      : null,
    attempts: context.attempts.map((attempt) => ({
      id: attempt.id,
      attemptNo: attempt.attemptNo,
      status: attempt.status,
      startedAt: toIso(attempt.startedAt),
      submittedAt: attempt.submittedAt ? toIso(attempt.submittedAt) : null,
      score: released && attempt.score !== null ? Number(attempt.score) : null,
    })),
    serverNow: toIso(context.now),
  };
}

/** A stored result with where it came from — the source decides when an unpublished exam shows it. */
type SourcedResult = MyExamResultView & { source: ResultSourceValue };

function toItem(row: MyExamRow, ownership: LessonOwnership, stored: SourcedResult | null, academyTimeZone: string, online: OnlineContext | null): MyExamItemDto {
  const result: MyExamResultView | null = stored ? { status: stored.status, score: stored.score, feedback: stored.feedback } : null;
  return {
    id: row.id,
    title: readLocalizedText(row.title) ?? { ar: '' },
    description: readLocalizedText(row.description),
    type: row.type,
    status: row.status as MyExamStatus,
    delivery: row.delivery,
    scheduledAt: row.scheduledAt ? toIso(row.scheduledAt) : null,
    durationMinutes: row.durationMinutes,
    timeZone: displayTimeZone(row.lesson?.room?.branch?.timezone, academyTimeZone),
    maxScore: Number(row.maxScore),
    passScore: row.passScore === null ? null : Number(row.passScore),
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
    lesson: row.lesson ? { id: row.lesson.id, title: readLocalizedText(row.lesson.title) ?? { ar: '' }, startsAt: toIso(row.lesson.startsAt) } : null,
    class: {
      id: row.class.id,
      code: row.class.code,
      name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
      status: row.class.status,
      course: { id: row.class.course.id, code: row.class.course.code, name: readLocalizedText(row.class.course.name) ?? { ar: row.class.course.code } },
    },
    relation: ownership.relation,
    student: ownership.student,
    result: visibleResult(row.status, result, row, stored?.source),
    online: online ? toOnline(row, ownership, online) : null,
  };
}

/**
 * MOD-09-T04 — «my exams» (`GET /api/me/exams`, API-121). Ownership instead of
 * a permission key (D-R48 — as API-112): the scheduled and published exams of
 * the classes the caller is enrolled in, now or finished (`self`), plus —
 * while the caller holds the `guardian` role — those of the classes their
 * linked, not soft-deleted children are enrolled in (`child`). Drafts are
 * never listed. One item per (exam × ownership), keyset-paginated on
 * `(scheduled_at NULLS LAST, id)` like API-113 (`limit` counts exams), each
 * with that student's own result once the results are published (D-R47) —
 * never the weight, the recorder or anyone else's result. A user with no owned
 * enrollment gets an empty list. Read-only: no audit event.
 *
 * Since MOD-09 phase 2 (roadmap §4r) each item names the exam's `delivery`
 * and, for an online exam, its `online` side for that student at the server
 * clock: the window, the attempts used and allowed, whether an attempt can be
 * started or resumed now and why not, the attempt in progress and the
 * student's attempts — a score only once the result is released, which for an
 * exam that releases on submit is as soon as it exists (D-R156). Never a
 * question or a key. Still read-only: an attempt whose time is up is closed by
 * the learner's next write or by the sweeper, never here.
 */
@Injectable()
export class MyExamsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMyExamsQueryDto, caller: AuthPrincipal): Promise<MyExamListDto> {
    const enrollments = await this.prisma.db.enrollment.findMany({
      where: ownedEnrollmentsWhere(caller, query.studentId),
      select: { classId: true, studentUserId: true, status: true, student: { select: { id: true, fullName: true, displayName: true } } },
    });
    const ownerships = enrollments.map((row) => ownershipOf(row, caller.id));
    const enrollmentStatusOf = new Map(enrollments.map((row) => [resultKey(row.classId, row.studentUserId), row.status]));
    const classIds = ownedClassIds(ownerships, query.classId);
    if (classIds.length === 0) return { items: [], nextCursor: null };
    const relevant = ownerships.filter((ownership) => classIds.includes(ownership.classId));

    const order: SortOrder = query.order ?? 'asc';
    const limit = query.limit ?? EXAMS_PAGE_DEFAULT;
    const filters: Prisma.ExamWhereInput[] = [{ classId: { in: classIds } }, { status: query.status ?? { in: [...MY_EXAM_STATUSES] } }];
    if (query.from) filters.push({ scheduledAt: { gte: toInstant(query.from) } });
    if (query.to) filters.push({ scheduledAt: { lte: toInstant(query.to) } });
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, EXAM_SORT_FIELD, order, true, () => gradesError.cursorInvalid());
      const after = afterExamCursor(cursor.key as string, cursor.id, order);
      if (after === null) throw gradesError.cursorInvalid();
      filters.push(after);
    }
    const rows = await this.prisma.db.exam.findMany({ where: { AND: filters }, orderBy: examOrderBy(order), take: limit + 1, select: MY_EXAM_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: EXAM_SORT_FIELD, order, key: examCursorKey(last.scheduledAt), id: last.id }) : null;
    if (page.length === 0) return { items: [], nextCursor };

    const expanded = expandLessonOwnership(page, relevant);
    const studentIds = [...new Set(expanded.map(({ ownership }) => ownership.student.id))];
    // Only the released results are ever shown — published, or online and released on submit (D-R156); the others are not even read.
    const releasedIds = page.filter((row) => isResultReleased(row)).map((row) => row.id);
    const results =
      releasedIds.length === 0
        ? []
        : await this.prisma.db.examResult.findMany({
            where: { examId: { in: releasedIds }, studentUserId: { in: studentIds } },
            select: { examId: true, studentUserId: true, status: true, score: true, feedback: true, source: true },
          });
    const byKey = new Map(
      results.map((row): [string, SourcedResult] => [resultKey(row.examId, row.studentUserId), { status: row.status, score: row.score === null ? null : Number(row.score), feedback: row.feedback, source: row.source }]),
    );
    const academy = await this.prisma.db.academy.findFirst({ select: { timezone: true } });
    const timeZone = academy?.timezone ?? FALLBACK_TIME_ZONE;

    // The online side: the owned students' attempts and the number of questions, read once for the page.
    const onlineIds = page.filter((row) => row.delivery === 'online').map((row) => row.id);
    const attempts =
      onlineIds.length === 0
        ? []
        : await this.prisma.db.examAttempt.findMany({ where: { examId: { in: onlineIds }, studentUserId: { in: studentIds } }, orderBy: [{ examId: 'asc' }, { attemptNo: 'asc' }], select: MY_ATTEMPT_SELECT });
    const attemptsOf = new Map<string, MyAttemptRow[]>();
    for (const attempt of attempts) {
      const key = resultKey(attempt.examId, attempt.studentUserId);
      const list = attemptsOf.get(key) ?? [];
      list.push(attempt);
      attemptsOf.set(key, list);
    }
    const questionCounts = onlineIds.length === 0 ? [] : await this.prisma.db.examQuestion.groupBy({ by: ['examId'], where: { examId: { in: onlineIds } }, _count: { _all: true } });
    const questionCountOf = new Map(questionCounts.map((group) => [group.examId, group._count._all]));
    const mayTake = caller.permissions.includes(TAKE_EXAMS_PERMISSION);
    const now = new Date();

    return {
      items: expanded.map(({ lesson: row, ownership }) =>
        toItem(
          row,
          ownership,
          byKey.get(resultKey(row.id, ownership.student.id)) ?? null,
          timeZone,
          row.delivery === 'online'
            ? {
                attempts: attemptsOf.get(resultKey(row.id, ownership.student.id)) ?? [],
                questionCount: questionCountOf.get(row.id) ?? 0,
                enrollmentStatus: enrollmentStatusOf.get(resultKey(row.classId, ownership.student.id)) ?? null,
                mayTake,
                now,
              }
            : null,
        ),
      ),
      nextCursor,
    };
  }
}
