import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListMyClassesQueryDto, MyClassItemDto, MyClassListDto } from './my-classes.dto.js';
import { myClassStatuses, relationOf, seesChildren } from './my-classes.policy.js';

// Only what the caller may know about their own (or their child's) class:
// identity of the student without contact fields, the class and course
// summary, and the lead teacher by name. Never other students, the roster,
// `withdrawal_reason`, `created_by` or any account field of the teacher.
const MY_CLASS_SELECT = {
  id: true,
  status: true,
  enrolledAt: true,
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
      course: { select: { id: true, code: true, name: true } },
      teachers: { where: { role: 'lead' }, take: 1, select: { teacher: { select: { fullName: true, displayName: true } } } },
    },
  },
} satisfies Prisma.EnrollmentSelect;

type MyClassRow = Prisma.EnrollmentGetPayload<{ select: typeof MY_CLASS_SELECT }>;

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toItem(row: MyClassRow, callerId: string): MyClassItemDto {
  const lead = row.class.teachers[0]?.teacher ?? null;
  return {
    enrollmentId: row.id,
    enrollmentStatus: row.status,
    enrolledAt: row.enrolledAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    relation: relationOf(row.studentUserId, callerId),
    student: { id: row.student.id, fullName: row.student.fullName, displayName: row.student.displayName },
    class: {
      id: row.class.id,
      code: row.class.code,
      name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
      status: row.class.status,
      startsOn: dateOnly(row.class.startsOn),
      endsOn: dateOnly(row.class.endsOn),
      course: {
        id: row.class.course.id,
        code: row.class.course.code,
        name: readLocalizedText(row.class.course.name) ?? { ar: row.class.course.code },
      },
      leadTeacher: lead ? { fullName: lead.fullName, displayName: lead.displayName } : null,
    },
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
