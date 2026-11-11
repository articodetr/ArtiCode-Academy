import { Injectable } from '@nestjs/common';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ClassStatus, ExamType } from '../generated/prisma/client.js';
import { cellOutcome } from '../grades/gradebook.calc.js';
import type { GradeComponent } from '../grades/gradebook.calc.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AcademicAssignmentsQueryDto,
  AcademicClassesQueryDto,
  AcademicExamsQueryDto,
  AssignmentSubmissionsReportDto,
  ClassPerformanceReportDto,
  ExamResultsReportDto,
  GradeBandCountDto,
} from './academic-reports.dto.js';
import { averageOf, capRows, meanOf, percentOf, round2 } from './reports.calc.js';
import { periodWindow, readReportContext, resolvePeriod } from './reports.period.js';
import type { PeriodWindow } from './reports.period.js';
import { ROW_CAP } from './reports.policy.js';

const D = Prisma.Decimal;

interface ClassRef {
  class_id: string;
  class_code: string;
  class_name: unknown;
  class_status: ClassStatus;
  course_id: string;
  course_code: string;
  course_name: unknown;
}

interface GradeSums {
  final_grades: number;
  percent_sum: string;
  passed: number;
}

interface AssignmentRow extends ClassRef {
  id: string;
  title: unknown;
  status: string;
  due_at: Date | null;
  published_at: Date;
  max_score: string;
  weight: string | null;
  late_penalty_percent: string | null;
  students: number;
  submitted: number;
  late: number;
  awaiting_review: number;
  graded: number;
  returned: number;
}

interface ExamRow extends ClassRef {
  id: string;
  title: unknown;
  type: ExamType;
  scheduled_at: Date | null;
  published_at: Date;
  max_score: string;
  pass_score: string | null;
  weight: string | null;
  students: number;
  scored: number;
  absent: number;
  excused: number;
}

const CLASS_REF = Prisma.sql`c.id AS class_id, c.code AS class_code, c.name AS class_name, c.status::text AS class_status,
  co.id AS course_id, co.code AS course_code, co.name AS course_name`;

function nameOf(value: unknown, code: string): LocalizedText {
  return readLocalizedText(value) ?? { ar: code };
}

function refs(row: ClassRef) {
  return {
    class: { id: row.class_id, code: row.class_code, name: nameOf(row.class_name, row.class_code), status: row.class_status },
    course: { id: row.course_id, code: row.course_code, name: nameOf(row.course_name, row.course_code) },
  };
}

function classFilters(alias: string, filters: { courseId?: string; classId?: string }): Prisma.Sql {
  const column = Prisma.raw(alias);
  return Prisma.sql`
    ${filters.courseId ? Prisma.sql`AND ${column}.course_id = ${filters.courseId}::uuid` : Prisma.empty}
    ${filters.classId ? Prisma.sql`AND ${column}.id = ${filters.classId}::uuid` : Prisma.empty}`;
}

function within(column: Prisma.Sql, window: PeriodWindow): Prisma.Sql {
  return Prisma.sql`${column} >= ${window.start.toISOString()}::timestamptz AND ${column} < ${window.end.toISOString()}::timestamptz`;
}

/** A value of `exact ÷ max × 100` (unrounded) for a cell that counts. */
function percentDecimal(exact: string, maxScore: string): Prisma.Decimal {
  return new D(exact).div(maxScore).mul(100);
}

/**
 * MOD-13-T02 — academic reports (API-158..160; D-R66..D-R73). Computed on
 * read; the grades of assignments and exams go through the gradebook's own
 * `cellOutcome()` (late penalty, absent = 0, excused left out), so a report
 * and the gradebook never disagree. Academy-wide, read-only, never audited.
 */
@Injectable()
export class AcademicReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** API-158: the final grades finalized in the period, per class and per course. */
  async classes(query: AcademicClassesQueryDto, now: Date = new Date()): Promise<ClassPerformanceReportDto> {
    const context = await readReportContext(this.prisma.db, now);
    const window = periodWindow(resolvePeriod(query, context.today), context.timeZone);
    const scope = Prisma.sql`
      SELECT fg.percent, fg.is_pass, fg.band_label, fg.band_letter, e.class_id, c.course_id
      FROM final_grades fg
      JOIN enrollments e ON e.id = fg.enrollment_id
      JOIN classes c ON c.id = e.class_id
      WHERE ${within(Prisma.sql`fg.finalized_at`, window)} ${classFilters('c', query)}`;
    const sums = Prisma.sql`count(*)::int AS final_grades, coalesce(sum(percent), 0)::text AS percent_sum, (count(*) FILTER (WHERE is_pass))::int AS passed`;

    const [classRows, bandRows, courseRows, totalsRows] = await Promise.all([
      this.prisma.db.$queryRaw<(ClassRef & GradeSums)[]>`
        WITH scoped AS (${scope})
        SELECT ${CLASS_REF}, g.final_grades, g.percent_sum, g.passed
        FROM (SELECT class_id, ${sums} FROM scoped GROUP BY class_id) g
        JOIN classes c ON c.id = g.class_id
        JOIN courses co ON co.id = c.course_id
        ORDER BY co.code, c.code, c.id
        LIMIT ${ROW_CAP + 1}`,
      this.prisma.db.$queryRaw<{ class_id: string; band_label: unknown; band_letter: string | null; count: number; top: string }[]>`
        WITH scoped AS (${scope})
        SELECT class_id, band_label, band_letter, count(*)::int AS count, max(percent)::text AS top
        FROM scoped
        GROUP BY class_id, band_label, band_letter`,
      this.prisma.db.$queryRaw<({ course_id: string; course_code: string; course_name: unknown; classes: number } & GradeSums)[]>`
        WITH scoped AS (${scope})
        SELECT co.id AS course_id, co.code AS course_code, co.name AS course_name, g.classes, g.final_grades, g.percent_sum, g.passed
        FROM (SELECT course_id, count(DISTINCT class_id)::int AS classes, ${sums} FROM scoped GROUP BY course_id) g
        JOIN courses co ON co.id = g.course_id
        ORDER BY co.code, co.id
        LIMIT ${ROW_CAP + 1}`,
      this.prisma.db.$queryRaw<({ classes: number } & GradeSums)[]>`
        WITH scoped AS (${scope})
        SELECT count(DISTINCT class_id)::int AS classes, ${sums} FROM scoped`,
    ]);

    const bandsByClass = new Map<string, (GradeBandCountDto & { top: string })[]>();
    for (const band of bandRows) {
      const list = bandsByClass.get(band.class_id) ?? [];
      list.push({ label: nameOf(band.band_label, band.band_letter ?? '—'), letter: band.band_letter, count: band.count, top: band.top });
      bandsByClass.set(band.class_id, list);
    }
    const classes = capRows(classRows);
    const courses = capRows(courseRows);
    const totals = totalsRows[0]!;
    return {
      period: window.period,
      timeZone: context.timeZone,
      generatedAt: context.generatedAt,
      truncated: classes.truncated || courses.truncated,
      rows: classes.rows.map((row) => ({
        ...refs(row),
        finalGrades: row.final_grades,
        averagePercent: averageOf(row.percent_sum, row.final_grades) ?? 0,
        passed: row.passed,
        passRate: percentOf(row.passed, row.final_grades) ?? 0,
        bands: (bandsByClass.get(row.class_id) ?? [])
          .sort((a, b) => new D(b.top).cmp(a.top) || (a.letter ?? '').localeCompare(b.letter ?? ''))
          .map(({ label, letter, count }) => ({ label, letter, count })),
      })),
      courses: courses.rows.map((row) => ({
        course: { id: row.course_id, code: row.course_code, name: nameOf(row.course_name, row.course_code) },
        classes: row.classes,
        finalGrades: row.final_grades,
        averagePercent: averageOf(row.percent_sum, row.final_grades) ?? 0,
        passed: row.passed,
        passRate: percentOf(row.passed, row.final_grades) ?? 0,
      })),
      totals: {
        classes: totals.classes,
        finalGrades: totals.final_grades,
        averagePercent: averageOf(totals.percent_sum, totals.final_grades),
        passed: totals.passed,
        passRate: percentOf(totals.passed, totals.final_grades),
      },
    };
  }

  /** API-159: the non-draft assignments due (else published) in the period, with their submission counts and averages. */
  async assignments(query: AcademicAssignmentsQueryDto, now: Date = new Date()): Promise<AssignmentSubmissionsReportDto> {
    const context = await readReportContext(this.prisma.db, now);
    const window = periodWindow(resolvePeriod(query, context.today), context.timeZone);
    const scope = Prisma.sql`
      SELECT a.id, a.class_id, a.title, a.status::text AS status, a.due_at, a.published_at,
             a.max_score::text AS max_score, a.weight::text AS weight, a.late_penalty_percent::text AS late_penalty_percent
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      WHERE a.status <> 'draft' AND ${within(Prisma.sql`coalesce(a.due_at, a.published_at)`, window)}
        ${classFilters('c', query)}
        ${query.status ? Prisma.sql`AND a.status = ${query.status}::assignment_status` : Prisma.empty}`;
    const counted = Prisma.sql`
      scoped AS (${scope}),
      roster AS (
        SELECT s.id AS assignment_id, e.student_user_id
        FROM scoped s JOIN enrollments e ON e.class_id = s.class_id AND e.status IN ('active', 'completed')
        UNION
        SELECT sub.assignment_id, sub.student_user_id
        FROM assignment_submissions sub JOIN scoped s ON s.id = sub.assignment_id
      ),
      latest AS (
        SELECT DISTINCT ON (sub.assignment_id, sub.student_user_id) sub.assignment_id, sub.status, sub.is_late
        FROM assignment_submissions sub JOIN scoped s ON s.id = sub.assignment_id
        ORDER BY sub.assignment_id, sub.student_user_id, sub.attempt_no DESC
      ),
      counts AS (
        SELECT s.id AS assignment_id,
               coalesce(rc.students, 0)::int AS students,
               coalesce(lc.submitted, 0)::int AS submitted,
               coalesce(lc.late, 0)::int AS late,
               coalesce(lc.awaiting_review, 0)::int AS awaiting_review,
               coalesce(lc.graded, 0)::int AS graded,
               coalesce(lc.returned, 0)::int AS returned
        FROM scoped s
        LEFT JOIN (SELECT assignment_id, count(*) AS students FROM roster GROUP BY assignment_id) rc ON rc.assignment_id = s.id
        LEFT JOIN (
          SELECT assignment_id, count(*) AS submitted,
                 count(*) FILTER (WHERE is_late) AS late,
                 count(*) FILTER (WHERE status = 'submitted') AS awaiting_review,
                 count(*) FILTER (WHERE status = 'graded') AS graded,
                 count(*) FILTER (WHERE status = 'returned') AS returned
          FROM latest GROUP BY assignment_id
        ) lc ON lc.assignment_id = s.id
      )`;

    const [read, totalsRows, cells] = await Promise.all([
      this.prisma.db.$queryRaw<AssignmentRow[]>`
        WITH ${counted}
        SELECT s.id, s.title, s.status, s.due_at, s.published_at, s.max_score, s.weight, s.late_penalty_percent, ${CLASS_REF},
               k.students, k.submitted, k.late, k.awaiting_review, k.graded, k.returned
        FROM scoped s
        JOIN counts k ON k.assignment_id = s.id
        JOIN classes c ON c.id = s.class_id
        JOIN courses co ON co.id = c.course_id
        ORDER BY coalesce(s.due_at, s.published_at), s.id
        LIMIT ${ROW_CAP + 1}`,
      this.prisma.db.$queryRaw<{ assignments: number; students: number; submitted: number; late: number; awaiting_review: number; graded: number; returned: number }[]>`
        WITH ${counted}
        SELECT count(*)::int AS assignments,
               coalesce(sum(students), 0)::int AS students, coalesce(sum(submitted), 0)::int AS submitted, coalesce(sum(late), 0)::int AS late,
               coalesce(sum(awaiting_review), 0)::int AS awaiting_review, coalesce(sum(graded), 0)::int AS graded, coalesce(sum(returned), 0)::int AS returned
        FROM counts`,
      // Each student's latest GRADED attempt — the one the gradebook counts (D-R43/D-R45).
      this.prisma.db.$queryRaw<{ assignment_id: string; score: string; is_late: boolean; status: string; max_score: string; weight: string | null; late_penalty_percent: string | null }[]>`
        WITH scoped AS (${scope})
        SELECT DISTINCT ON (sub.assignment_id, sub.student_user_id)
               sub.assignment_id, sub.score::text AS score, sub.is_late, s.status, s.max_score, s.weight, s.late_penalty_percent
        FROM assignment_submissions sub JOIN scoped s ON s.id = sub.assignment_id
        WHERE sub.status = 'graded'
        ORDER BY sub.assignment_id, sub.student_user_id, sub.attempt_no DESC`,
    ]);

    // The cells of every matching assignment (also beyond the row cap) feed the totals.
    const percentsByAssignment = new Map<string, Prisma.Decimal[]>();
    const allPercents: Prisma.Decimal[] = [];
    for (const cell of cells) {
      const component: GradeComponent = {
        kind: 'assignment',
        id: cell.assignment_id,
        weight: cell.weight,
        maxScore: cell.max_score,
        latePenaltyPercent: cell.late_penalty_percent,
        status: cell.status as GradeComponent['status'],
      };
      const outcome = cellOutcome(component, { kind: 'assignment', lastGradedScore: cell.score, lastGradedLate: cell.is_late, latestStatus: 'graded' });
      if (outcome.counts !== 'value' || outcome.exact === null) continue;
      const percent = percentDecimal(outcome.exact, cell.max_score);
      const list = percentsByAssignment.get(cell.assignment_id) ?? [];
      list.push(percent);
      percentsByAssignment.set(cell.assignment_id, list);
      allPercents.push(percent);
    }

    const { rows, truncated } = capRows(read);
    const totals = totalsRows[0]!;
    const onTimeTotal = totals.submitted - totals.late;
    return {
      period: window.period,
      timeZone: context.timeZone,
      generatedAt: context.generatedAt,
      truncated,
      rows: rows.map((row) => {
        const onTime = row.submitted - row.late;
        return {
          assignment: {
            id: row.id,
            title: nameOf(row.title, row.id),
            status: row.status,
            dueAt: row.due_at ? row.due_at.toISOString() : null,
            publishedAt: row.published_at.toISOString(),
            maxScore: round2(row.max_score),
            latePenaltyPercent: row.late_penalty_percent === null ? null : round2(row.late_penalty_percent),
          },
          ...refs(row),
          students: row.students,
          submitted: row.submitted,
          onTime,
          late: row.late,
          notSubmitted: Math.max(row.students - row.submitted, 0),
          awaitingReview: row.awaiting_review,
          graded: row.graded,
          returned: row.returned,
          submissionRate: percentOf(row.submitted, row.students),
          onTimeRate: percentOf(onTime, row.students),
          averagePercent: meanOf(percentsByAssignment.get(row.id) ?? []),
        };
      }),
      totals: {
        assignments: totals.assignments,
        students: totals.students,
        submitted: totals.submitted,
        onTime: onTimeTotal,
        late: totals.late,
        notSubmitted: Math.max(totals.students - totals.submitted, 0),
        awaitingReview: totals.awaiting_review,
        graded: totals.graded,
        returned: totals.returned,
        submissionRate: percentOf(totals.submitted, totals.students),
        onTimeRate: percentOf(onTimeTotal, totals.students),
        averagePercent: meanOf(allPercents),
      },
    };
  }

  /** API-160: the published exams scheduled (else published) in the period, with their results. */
  async exams(query: AcademicExamsQueryDto, now: Date = new Date()): Promise<ExamResultsReportDto> {
    const context = await readReportContext(this.prisma.db, now);
    const window = periodWindow(resolvePeriod(query, context.today), context.timeZone);
    const scope = Prisma.sql`
      SELECT x.id, x.class_id, x.title, x.type::text AS type, x.status::text AS status, x.scheduled_at, x.published_at,
             x.max_score::text AS max_score, x.pass_score::text AS pass_score, x.weight::text AS weight
      FROM exams x
      JOIN classes c ON c.id = x.class_id
      WHERE x.status = 'published' AND ${within(Prisma.sql`coalesce(x.scheduled_at, x.published_at)`, window)}
        ${classFilters('c', query)}
        ${query.type ? Prisma.sql`AND x.type = ${query.type}::exam_type` : Prisma.empty}`;
    const counted = Prisma.sql`
      scoped AS (${scope}),
      roster AS (
        SELECT s.id AS exam_id, e.student_user_id
        FROM scoped s JOIN enrollments e ON e.class_id = s.class_id AND e.status IN ('active', 'completed')
        UNION
        SELECT r.exam_id, r.student_user_id FROM exam_results r JOIN scoped s ON s.id = r.exam_id
      ),
      counts AS (
        SELECT s.id AS exam_id,
               coalesce(rc.students, 0)::int AS students,
               coalesce(xc.scored, 0)::int AS scored,
               coalesce(xc.absent, 0)::int AS absent,
               coalesce(xc.excused, 0)::int AS excused
        FROM scoped s
        LEFT JOIN (SELECT exam_id, count(*) AS students FROM roster GROUP BY exam_id) rc ON rc.exam_id = s.id
        LEFT JOIN (
          SELECT r.exam_id,
                 count(*) FILTER (WHERE r.status = 'scored') AS scored,
                 count(*) FILTER (WHERE r.status = 'absent') AS absent,
                 count(*) FILTER (WHERE r.status = 'excused') AS excused
          FROM exam_results r JOIN scoped s ON s.id = r.exam_id
          GROUP BY r.exam_id
        ) xc ON xc.exam_id = s.id
      )`;

    const [read, totalsRows, cells] = await Promise.all([
      this.prisma.db.$queryRaw<ExamRow[]>`
        WITH ${counted}
        SELECT s.id, s.title, s.type, s.scheduled_at, s.published_at, s.max_score, s.pass_score, s.weight, ${CLASS_REF},
               k.students, k.scored, k.absent, k.excused
        FROM scoped s
        JOIN counts k ON k.exam_id = s.id
        JOIN classes c ON c.id = s.class_id
        JOIN courses co ON co.id = c.course_id
        ORDER BY coalesce(s.scheduled_at, s.published_at), s.id
        LIMIT ${ROW_CAP + 1}`,
      this.prisma.db.$queryRaw<{ exams: number; students: number; scored: number; absent: number; excused: number }[]>`
        WITH ${counted}
        SELECT count(*)::int AS exams, coalesce(sum(students), 0)::int AS students, coalesce(sum(scored), 0)::int AS scored,
               coalesce(sum(absent), 0)::int AS absent, coalesce(sum(excused), 0)::int AS excused
        FROM counts`,
      this.prisma.db.$queryRaw<{ exam_id: string; status: 'scored' | 'absent' | 'excused'; score: string | null; max_score: string; pass_score: string | null; weight: string | null }[]>`
        WITH scoped AS (${scope})
        SELECT r.exam_id, r.status::text AS status, r.score::text AS score, s.max_score, s.pass_score, s.weight
        FROM exam_results r JOIN scoped s ON s.id = r.exam_id`,
    ]);

    interface ExamCells {
      values: Prisma.Decimal[];
      scoredPercents: Prisma.Decimal[];
      passed: number;
      judged: number;
    }
    const byExam = new Map<string, ExamCells>();
    const allValues: Prisma.Decimal[] = [];
    let passedTotal = 0;
    let judgedTotal = 0;
    for (const cell of cells) {
      const entry = byExam.get(cell.exam_id) ?? { values: [], scoredPercents: [], passed: 0, judged: 0 };
      const component: GradeComponent = { kind: 'exam', id: cell.exam_id, weight: cell.weight, maxScore: cell.max_score, latePenaltyPercent: null, status: 'published' };
      const outcome = cellOutcome(component, { kind: 'exam', status: cell.status, score: cell.score });
      if (outcome.counts === 'value' && outcome.exact !== null) {
        const percent = percentDecimal(outcome.exact, cell.max_score);
        entry.values.push(percent);
        allValues.push(percent);
        if (cell.status === 'scored') entry.scoredPercents.push(percent);
        if (cell.pass_score !== null) {
          entry.judged += 1;
          judgedTotal += 1;
          if (cell.status === 'scored' && cell.score !== null && new D(cell.score).gte(cell.pass_score)) {
            entry.passed += 1;
            passedTotal += 1;
          }
        }
      }
      byExam.set(cell.exam_id, entry);
    }

    const { rows, truncated } = capRows(read);
    const totals = totalsRows[0]!;
    const extreme = (values: Prisma.Decimal[], pick: 'min' | 'max'): number | null =>
      values.length === 0 ? null : round2(values.reduce((best, value) => (pick === 'min' ? (value.lt(best) ? value : best) : value.gt(best) ? value : best)));
    return {
      period: window.period,
      timeZone: context.timeZone,
      generatedAt: context.generatedAt,
      truncated,
      rows: rows.map((row) => {
        const entry = byExam.get(row.id) ?? { values: [], scoredPercents: [], passed: 0, judged: 0 };
        const results = row.scored + row.absent + row.excused;
        return {
          exam: {
            id: row.id,
            title: nameOf(row.title, row.id),
            type: row.type,
            scheduledAt: row.scheduled_at ? row.scheduled_at.toISOString() : null,
            publishedAt: row.published_at.toISOString(),
            maxScore: round2(row.max_score),
            passScore: row.pass_score === null ? null : round2(row.pass_score),
          },
          ...refs(row),
          students: row.students,
          scored: row.scored,
          absent: row.absent,
          excused: row.excused,
          missing: Math.max(row.students - results, 0),
          averagePercent: meanOf(entry.values),
          minPercent: extreme(entry.scoredPercents, 'min'),
          maxPercent: extreme(entry.scoredPercents, 'max'),
          passed: row.pass_score === null ? null : entry.passed,
          passRate: row.pass_score === null ? null : percentOf(entry.passed, entry.judged),
        };
      }),
      totals: {
        exams: totals.exams,
        students: totals.students,
        scored: totals.scored,
        absent: totals.absent,
        excused: totals.excused,
        missing: Math.max(totals.students - (totals.scored + totals.absent + totals.excused), 0),
        averagePercent: meanOf(allValues),
        passRate: percentOf(passedTotal, judgedTotal),
      },
    };
  }
}
