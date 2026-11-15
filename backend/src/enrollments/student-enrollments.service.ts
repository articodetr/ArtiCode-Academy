import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { MANAGE_ENROLLMENTS_PERMISSION } from '../classes/classes.policy.js';
import { classesError } from '../classes/classes.errors.js';
import { INVOICES_MANAGE_PERMISSION } from '../finance/finance.policy.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CLASS_SUMMARY_SELECT, toClassSummary } from './my-classes.service.js';
import type { ListStudentEnrollmentsQueryDto, StudentEnrollmentItemDto, StudentEnrollmentListDto } from './student-enrollments.dto.js';

/** API-200 is read with either key: the office that enrolls, or the office that invoices. */
export const STUDENT_ENROLLMENTS_READ_PERMISSIONS = [MANAGE_ENROLLMENTS_PERMISSION, INVOICES_MANAGE_PERMISSION] as const;

const STUDENT_ENROLLMENT_SELECT = {
  id: true,
  status: true,
  source: true,
  enrolledAt: true,
  activatedAt: true,
  completedAt: true,
  withdrawnAt: true,
  withdrawalReason: true,
  class: { select: CLASS_SUMMARY_SELECT },
} satisfies Prisma.EnrollmentSelect;

type StudentEnrollmentRow = Prisma.EnrollmentGetPayload<{ select: typeof STUDENT_ENROLLMENT_SELECT }>;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toItem(row: StudentEnrollmentRow, seesReason: boolean): StudentEnrollmentItemDto {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    enrolledAt: row.enrolledAt.toISOString(),
    activatedAt: iso(row.activatedAt),
    completedAt: iso(row.completedAt),
    withdrawnAt: iso(row.withdrawnAt),
    withdrawalReason: seesReason ? row.withdrawalReason : null,
    class: toClassSummary(row.class),
  };
}

/**
 * API-200 `GET /api/users/:id/enrollments` (CH-0226) — the enrollments of ONE
 * student across every class, for the office: a holder of `enrollments.manage`
 * (who already reads every roster) or `invoices.manage` (who must pick the
 * enrollment of an invoice draft, API-144). Academy-wide like both keys — no
 * class visibility; teachers read rosters per class (API-057). A
 * soft-deleted student keeps their history here, as in the roster.
 * The keys are checked by the controller (`missingAny()`). Read-only: no audit event.
 */
@Injectable()
export class StudentEnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(studentId: string, query: ListStudentEnrollmentsQueryDto, caller: AuthPrincipal): Promise<StudentEnrollmentListDto> {
    const student = await this.prisma.db.user.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!student) throw classesError.userNotFound(studentId);

    const rows = await this.prisma.db.enrollment.findMany({
      where: { studentUserId: studentId, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ id: 'desc' }],
      select: STUDENT_ENROLLMENT_SELECT,
    });
    const seesReason = caller.permissions.includes(MANAGE_ENROLLMENTS_PERMISSION);
    return { items: rows.map((row) => toItem(row, seesReason)) };
  }
}
