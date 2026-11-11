import { Injectable } from '@nestjs/common';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ClassStatus, EnrollmentStatus } from '../generated/prisma/client.js';
import type { AttendanceCountsDto } from '../lessons/lessons.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AttendanceClassesQueryDto,
  AttendanceClassesReportDto,
  AttendanceStudentsQueryDto,
  AttendanceStudentsReportDto,
} from './attendance-reports.dto.js';
import { absenceRate, attendanceRate, capRows } from './reports.calc.js';
import type { AttendanceCounts } from './reports.calc.js';
import { periodWindow, readReportContext, resolvePeriod } from './reports.period.js';
import type { PeriodWindow } from './reports.period.js';
import { ROW_CAP } from './reports.policy.js';

interface CountsRow {
  present: number;
  late: number;
  absent: number;
  excused: number;
}

interface ClassRow extends CountsRow {
  class_id: string;
  class_code: string;
  class_name: unknown;
  class_status: ClassStatus;
  course_id: string;
  course_code: string;
  course_name: unknown;
  lessons: number;
  completed_lessons: number;
  recorded_lessons: number;
  completed_without: number;
}

interface ClassTotalsRow extends CountsRow {
  classes: number;
  lessons: number;
  completed_lessons: number;
  recorded_lessons: number;
  completed_without: number;
}

interface StudentRow extends CountsRow {
  student_user_id: string;
  full_name: string;
  display_name: string | null;
  class_id: string;
  class_code: string;
  class_name: unknown;
  class_status: ClassStatus;
  course_id: string;
  course_code: string;
  course_name: unknown;
  enrollment_status: EnrollmentStatus | null;
}

interface StudentTotalsRow extends CountsRow {
  rows: number;
  students: number;
}

/** The four counters of attendance records, by status (`a` = attendance_records). */
const RECORD_COUNTS = Prisma.sql`
  (count(*) FILTER (WHERE a.status = 'present'))::int AS present,
  (count(*) FILTER (WHERE a.status = 'late'))::int AS late,
  (count(*) FILTER (WHERE a.status = 'absent'))::int AS absent,
  (count(*) FILTER (WHERE a.status = 'excused'))::int AS excused`;

/**
 * The lessons a report counts (D-R70): not cancelled, starting inside the
 * period's instant window, of the classes the filters keep. Parameters only —
 * the fragments are fixed text.
 */
function lessonScope(window: PeriodWindow, filters: { courseId?: string; classId?: string; classStatus?: ClassStatus }): Prisma.Sql {
  return Prisma.sql`
    SELECT l.id, l.class_id, l.status, l.attendance_taken_at
    FROM lessons l
    JOIN classes c ON c.id = l.class_id
    WHERE l.status <> 'cancelled'
      AND l.starts_at >= ${window.start.toISOString()}::timestamptz
      AND l.starts_at < ${window.end.toISOString()}::timestamptz
      ${filters.courseId ? Prisma.sql`AND c.course_id = ${filters.courseId}::uuid` : Prisma.empty}
      ${filters.classId ? Prisma.sql`AND c.id = ${filters.classId}::uuid` : Prisma.empty}
      ${filters.classStatus ? Prisma.sql`AND c.status = ${filters.classStatus}::class_status` : Prisma.empty}`;
}

function countsOf(row: CountsRow): AttendanceCountsDto {
  return { recorded: row.present + row.late + row.absent + row.excused, present: row.present, absent: row.absent, late: row.late, excused: row.excused };
}

function nameOf(value: unknown, code: string): LocalizedText {
  return readLocalizedText(value) ?? { ar: code };
}

/**
 * MOD-13-T01 — attendance reports (API-156/157; D-R66..D-R73). Computed on
 * read from `lessons` + `attendance_records` (no tables, no cache), for every
 * class of the academy (no class visibility — D-R68), in the academy's days
 * (D-R69); read-only, so nothing is audited (D-R73).
 */
@Injectable()
export class AttendanceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** API-156: one row per class with lessons in the period. */
  async classes(query: AttendanceClassesQueryDto, now: Date = new Date()): Promise<AttendanceClassesReportDto> {
    const context = await readReportContext(this.prisma.db, now);
    const window = periodWindow(resolvePeriod(query, context.today), context.timeZone);
    const scope = lessonScope(window, query);

    const [read, totalsRows] = await Promise.all([
      this.prisma.db.$queryRaw<ClassRow[]>`
        WITH scoped AS (${scope}),
        lesson_counts AS (
          SELECT class_id,
                 count(*)::int AS lessons,
                 (count(*) FILTER (WHERE status = 'completed'))::int AS completed_lessons,
                 (count(*) FILTER (WHERE attendance_taken_at IS NOT NULL))::int AS recorded_lessons,
                 (count(*) FILTER (WHERE status = 'completed' AND attendance_taken_at IS NULL))::int AS completed_without
          FROM scoped
          GROUP BY class_id
        ),
        record_counts AS (
          SELECT s.class_id, ${RECORD_COUNTS}
          FROM scoped s
          JOIN attendance_records a ON a.lesson_id = s.id
          GROUP BY s.class_id
        )
        SELECT c.id AS class_id, c.code AS class_code, c.name AS class_name, c.status::text AS class_status,
               co.id AS course_id, co.code AS course_code, co.name AS course_name,
               lc.lessons, lc.completed_lessons, lc.recorded_lessons, lc.completed_without,
               coalesce(rc.present, 0)::int AS present, coalesce(rc.late, 0)::int AS late,
               coalesce(rc.absent, 0)::int AS absent, coalesce(rc.excused, 0)::int AS excused
        FROM lesson_counts lc
        JOIN classes c ON c.id = lc.class_id
        JOIN courses co ON co.id = c.course_id
        LEFT JOIN record_counts rc ON rc.class_id = lc.class_id
        ORDER BY co.code, c.code, c.id
        LIMIT ${ROW_CAP + 1}`,
      this.prisma.db.$queryRaw<ClassTotalsRow[]>`
        WITH scoped AS (${scope})
        SELECT (SELECT count(DISTINCT class_id)::int FROM scoped) AS classes,
               (SELECT count(*)::int FROM scoped) AS lessons,
               (SELECT count(*)::int FROM scoped WHERE status = 'completed') AS completed_lessons,
               (SELECT count(*)::int FROM scoped WHERE attendance_taken_at IS NOT NULL) AS recorded_lessons,
               (SELECT count(*)::int FROM scoped WHERE status = 'completed' AND attendance_taken_at IS NULL) AS completed_without,
               r.present, r.late, r.absent, r.excused
        FROM (SELECT ${RECORD_COUNTS} FROM scoped s JOIN attendance_records a ON a.lesson_id = s.id) r`,
    ]);

    const { rows, truncated } = capRows(read);
    const totals = totalsRows[0]!;
    return {
      period: window.period,
      timeZone: context.timeZone,
      generatedAt: context.generatedAt,
      truncated,
      rows: rows.map((row) => ({
        class: { id: row.class_id, code: row.class_code, name: nameOf(row.class_name, row.class_code), status: row.class_status },
        course: { id: row.course_id, code: row.course_code, name: nameOf(row.course_name, row.course_code) },
        lessons: row.lessons,
        completedLessons: row.completed_lessons,
        recordedLessons: row.recorded_lessons,
        completedWithoutAttendance: row.completed_without,
        records: countsOf(row),
        attendanceRate: attendanceRate(row),
      })),
      totals: {
        classes: totals.classes,
        lessons: totals.lessons,
        completedLessons: totals.completed_lessons,
        recordedLessons: totals.recorded_lessons,
        completedWithoutAttendance: totals.completed_without,
        records: countsOf(totals),
        attendanceRate: attendanceRate(totals),
      },
    };
  }

  /** API-157: one row per (student × class) with records in the period's lessons. */
  async students(query: AttendanceStudentsQueryDto, now: Date = new Date()): Promise<AttendanceStudentsReportDto> {
    const context = await readReportContext(this.prisma.db, now);
    const window = periodWindow(resolvePeriod(query, context.today), context.timeZone);
    const scope = lessonScope(window, query);
    const filtered = Prisma.sql`
      SELECT p.*,
             CASE WHEN p.present + p.late + p.absent = 0 THEN NULL ELSE 100.0 * p.absent / (p.present + p.late + p.absent) END AS absence_rate
      FROM (
        SELECT a.student_user_id, s.class_id, ${RECORD_COUNTS}
        FROM scoped s
        JOIN attendance_records a ON a.lesson_id = s.id
        GROUP BY a.student_user_id, s.class_id
      ) p
      ${query.minAbsences !== undefined ? Prisma.sql`WHERE p.absent >= ${query.minAbsences}` : Prisma.empty}`;
    // The rate filter compares the unrounded rate: 33.333… passes a threshold of 33.33.
    const rateFilter = query.minAbsenceRate !== undefined ? Prisma.sql`WHERE f.absence_rate >= ${query.minAbsenceRate}::numeric` : Prisma.empty;

    const [read, totalsRows] = await Promise.all([
      this.prisma.db.$queryRaw<StudentRow[]>`
        WITH scoped AS (${scope}), filtered AS (${filtered})
        SELECT f.student_user_id, f.class_id, f.present, f.late, f.absent, f.excused,
               u.full_name, u.display_name,
               c.code AS class_code, c.name AS class_name, c.status::text AS class_status,
               co.id AS course_id, co.code AS course_code, co.name AS course_name,
               e.status::text AS enrollment_status
        FROM filtered f
        JOIN users u ON u.id = f.student_user_id
        JOIN classes c ON c.id = f.class_id
        JOIN courses co ON co.id = c.course_id
        LEFT JOIN enrollments e ON e.class_id = f.class_id AND e.student_user_id = f.student_user_id
        ${rateFilter}
        ORDER BY f.absent DESC, f.absence_rate DESC NULLS LAST, u.full_name, c.code, f.student_user_id, f.class_id
        LIMIT ${ROW_CAP + 1}`,
      this.prisma.db.$queryRaw<StudentTotalsRow[]>`
        WITH scoped AS (${scope}), filtered AS (${filtered})
        SELECT count(*)::int AS rows, count(DISTINCT f.student_user_id)::int AS students,
               coalesce(sum(f.present), 0)::int AS present, coalesce(sum(f.late), 0)::int AS late,
               coalesce(sum(f.absent), 0)::int AS absent, coalesce(sum(f.excused), 0)::int AS excused
        FROM filtered f
        ${rateFilter}`,
    ]);

    const { rows, truncated } = capRows(read);
    const totals = totalsRows[0]!;
    const totalCounts: AttendanceCounts = totals;
    return {
      period: window.period,
      timeZone: context.timeZone,
      generatedAt: context.generatedAt,
      truncated,
      rows: rows.map((row) => ({
        student: { id: row.student_user_id, fullName: row.full_name, displayName: row.display_name },
        class: { id: row.class_id, code: row.class_code, name: nameOf(row.class_name, row.class_code), status: row.class_status },
        course: { id: row.course_id, code: row.course_code, name: nameOf(row.course_name, row.course_code) },
        enrollmentStatus: row.enrollment_status,
        records: countsOf(row),
        attendanceRate: attendanceRate(row),
        absenceRate: absenceRate(row),
      })),
      totals: {
        rows: totals.rows,
        students: totals.students,
        records: countsOf(totals),
        attendanceRate: attendanceRate(totalCounts),
        absenceRate: absenceRate(totalCounts),
      },
    };
  }
}
