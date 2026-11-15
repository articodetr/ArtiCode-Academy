import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListMyClassesQueryDto, MyClassItemDto, MyClassListDto, MyClassSummaryDto } from './my-classes.dto.js';
import { myClassStatuses, relationOf, seesChildren } from './my-classes.policy.js';

// Only what the caller may know about their own (or their child's) class:
// identity of the student without contact fields, the class and course
// summary, and the lead teacher by name. Never other students, the roster,
// `withdrawal_reason`, `created_by` or any account field of the teacher.
/** The class summary of «my classes», shared with API-200 (a student's enrollments). */
export const CLASS_SUMMARY_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  startsOn: true,
  endsOn: true,
  course: { select: { id: true, code: true, name: true } },
  teachers: { where: { role: 'lead' }, take: 1, select: { teacher: { select: { fullName: true, displayName: true } } } },
} satisfies Prisma.ClassSelect;

type ClassSummaryRow = Prisma.ClassGetPayload<{ select: typeof CLASS_SUMMARY_SELECT }>;

const MY_CLASS_SELECT = {
  id: true,
  status: true,
  enrolledAt: true,
  completedAt: true,
  withdrawnAt: true,
  studentUserId: true,
  student: { select: { id: true, fullName: true, displayName: true } },
  class: { select: CLASS_SUMMARY_SELECT },
} satisfies Prisma.EnrollmentSelect;

type MyClassRow = Prisma.EnrollmentGetPayload<{ select: typeof MY_CLASS_SELECT }>;

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** The class, its course and the lead teacher by name — no roster, no account field. */
export function toClassSummary(klass: ClassSummaryRow): MyClassSummaryDto {
  const lead = klass.teachers[0]?.teacher ?? null;
  return {
    id: klass.id,
    code: klass.code,
    name: readLocalizedText(klass.name) ?? { ar: klass.code },
    status: klass.status,
    startsOn: dateOnly(klass.startsOn),
    endsOn: dateOnly(klass.endsOn),
    course: {
      id: klass.course.id,
      code: klass.course.code,
      name: readLocalizedText(klass.course.name) ?? { ar: klass.course.code },
    },
    leadTeacher: lead ? { fullName: lead.fullName, displayName: lead.displayName } : null,
  };
}

function toItem(row: MyClassRow, callerId: string): MyClassItemDto {
  return {
    enrollmentId: row.id,
    enrollmentStatus: row.status,
    enrolledAt: row.enrolledAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
    relation: relationOf(row.studentUserId, callerId),
    student: { id: row.student.id, fullName: row.student.fullName, displayName: row.student.displayName },
    class: toClassSummary(row.class),
  };
}

/**
 * MOD-05-T05 — "my classes" (`GET /api/me/classes`). Ownership instead of a
 * permission key (D-R16 — the student and guardian roles hold no class keys):
 * the caller's own enrollments, plus — while the caller holds the `guardian`
 * role (owner decision, issue #19) — those of the students linked to the
 * caller in `guardian_students` (soft-deleted children hidden, as in the
 * guardian links of MOD-03-T09). A user with neither gets an empty list.
 * The caller's role keys are read from the database on every request.
 */
@Injectable()
export class MyClassesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMyClassesQueryDto, caller: AuthPrincipal): Promise<MyClassListDto> {
    const owned: Prisma.EnrollmentWhereInput[] = [{ studentUserId: caller.id }];
    if (seesChildren(caller.roles)) owned.push({ student: { deletedAt: null, guardians: { some: { guardianUserId: caller.id } } } });
    const rows = await this.prisma.db.enrollment.findMany({
      where: { status: { in: myClassStatuses(query.status) }, OR: owned },
      orderBy: [{ id: 'desc' }],
      select: MY_CLASS_SELECT,
    });
    return { items: rows.map((row) => toItem(row, caller.id)) };
  }
}
