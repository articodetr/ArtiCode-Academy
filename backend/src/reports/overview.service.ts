import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AcademicReportsService } from './academic-reports.service.js';
import { AttendanceReportsService } from './attendance-reports.service.js';
import { FinancialReportsService } from './financial-reports.service.js';
import type { ReportsOverviewDto } from './overview.dto.js';
import { periodWindow, readReportContext } from './reports.period.js';
import { REPORTS_ACADEMIC_PERMISSION, REPORTS_ATTENDANCE_PERMISSION, REPORTS_FINANCIAL_PERMISSION } from './reports.policy.js';

/**
 * MOD-13-T04 — the dashboard overview (API-164; D-R67). One general section
 * for any report key, and one section per key computed by the detailed
 * reports themselves (their default periods, their totals), so a tile and
 * its report never disagree. Academy-wide, read-only, never audited.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceReportsService,
    private readonly academic: AcademicReportsService,
    private readonly financial: FinancialReportsService,
  ) {}

  async overview(caller: AuthPrincipal, now: Date = new Date()): Promise<ReportsOverviewDto> {
    const context = await readReportContext(this.prisma.db, now);
    const holds = (key: string) => caller.permissions.includes(key);
    const today = periodWindow({ from: context.today, to: context.today }, context.timeZone);
    const monthStart = `${context.today.slice(0, 7)}-01`;

    const [general, attendance, academic, awaiting, collections, receivables] = await Promise.all([
      this.prisma.db.$queryRaw<{ active_students: number; open_classes: number; running_classes: number; lessons_today: number }[]>`
        SELECT (SELECT count(DISTINCT student_user_id)::int FROM enrollments WHERE status = 'active') AS active_students,
               (SELECT count(*)::int FROM classes WHERE status = 'open') AS open_classes,
               (SELECT count(*)::int FROM classes WHERE status = 'running') AS running_classes,
               (SELECT count(*)::int FROM lessons
                 WHERE status <> 'cancelled'
                   AND starts_at >= ${today.start.toISOString()}::timestamptz AND starts_at < ${today.end.toISOString()}::timestamptz) AS lessons_today`,
      holds(REPORTS_ATTENDANCE_PERMISSION) ? this.attendance.classes({}, now) : null,
      holds(REPORTS_ACADEMIC_PERMISSION) ? this.academic.classes({}, now) : null,
      holds(REPORTS_ACADEMIC_PERMISSION)
        ? this.prisma.db.$queryRaw<{ awaiting: number }[]>`
            SELECT count(*)::int AS awaiting
            FROM (
              SELECT DISTINCT ON (sub.assignment_id, sub.student_user_id) sub.status
              FROM assignment_submissions sub
              JOIN assignments a ON a.id = sub.assignment_id
              WHERE a.status <> 'draft'
              ORDER BY sub.assignment_id, sub.student_user_id, sub.attempt_no DESC
            ) latest
            WHERE latest.status = 'submitted'`
        : null,
      holds(REPORTS_FINANCIAL_PERMISSION) ? this.financial.collections({ from: monthStart, to: context.today }, now) : null,
      holds(REPORTS_FINANCIAL_PERMISSION) ? this.financial.receivables({}, now) : null,
    ]);

    const counts = general[0]!;
    return {
      asOf: context.today,
      timeZone: context.timeZone,
      generatedAt: context.generatedAt,
      general: { activeStudents: counts.active_students, openClasses: counts.open_classes, runningClasses: counts.running_classes, lessonsToday: counts.lessons_today },
      attendance: attendance ? { period: attendance.period, records: attendance.totals.records, attendanceRate: attendance.totals.attendanceRate } : null,
      academic: academic
        ? {
            period: academic.period,
            finalGrades: academic.totals.finalGrades,
            averagePercent: academic.totals.averagePercent,
            passRate: academic.totals.passRate,
            awaitingReview: awaiting?.[0]?.awaiting ?? 0,
          }
        : null,
      financial:
        collections && receivables
          ? {
              period: collections.period,
              collected: collections.totals.map(({ currency, payments, amount }) => ({ currency, payments, amount })),
              outstanding: receivables.totals.map(({ currency, balance, overdue }) => ({
                currency,
                balance,
                overdue,
                studentsOverdue: receivables.rows.filter((row) => row.currency === currency && row.overdue > 0).length,
              })),
            }
          : null,
    };
  }
}
