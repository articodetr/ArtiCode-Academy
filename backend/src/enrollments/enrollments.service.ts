import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { classesError } from '../classes/classes.errors.js';
import { ELIGIBLE_USER_STATUSES, MANAGE_ENROLLMENTS_PERMISSION, STUDENT_ROLE_KEY } from '../classes/classes.policy.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ClassStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { READ_CONTACT_PERMISSION } from '../users/users.policy.js';
import type { UsersProjection } from '../users/users.service.js';
import { ENROLLMENTS_PAGE_DEFAULT } from './enrollments.dto.js';
import type {
  ChangeEnrollmentStatusDto,
  CreateEnrollmentDto,
  EnrollmentDto,
  EnrollmentListDto,
  EnrollmentStudentDto,
  ListEnrollmentsQueryDto,
} from './enrollments.dto.js';
import { enrollmentsError } from './enrollments.errors.js';
import {
  allowedEnrollmentActions,
  canReadRoster,
  enrollmentWrite,
  hasFreeSeat,
  isEnrollableClass,
  nextEnrollmentStatus,
  takesSeat,
} from './enrollments.status.js';

export const ENROLLMENTS_AUDIT_ACTIONS = {
  created: 'enrollments.created',
  statusChanged: 'enrollments.status.changed',
} as const;

/** Audit `entity_type` of enrollment events (`entity_id` = the enrollment). */
export const ENROLLMENTS_ENTITY_TYPE = 'enrollments';

/** The roster keyset sorts by the time-ordered primary key alone (enrollment order). */
const ROSTER_SORT = 'createdAt';
const ROSTER_ORDER = 'asc';

// The student as the roster shows it: identity only, contact fields nulled in
// the reduced projection (D-R07). Never the password hash, the login counters
// or the security timestamps.
const STUDENT_SELECT = {
  id: true,
  fullName: true,
  fullNameLatin: true,
  displayName: true,
  avatarUrl: true,
  status: true,
  email: true,
  username: true,
  phone: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

const ENROLLMENT_SELECT = {
  id: true,
  classId: true,
  status: true,
  source: true,
  enrolledAt: true,
  activatedAt: true,
  completedAt: true,
  withdrawnAt: true,
  withdrawalReason: true,
  createdAt: true,
  updatedAt: true,
  student: { select: STUDENT_SELECT },
} satisfies Prisma.EnrollmentSelect;

type EnrollmentRow = Prisma.EnrollmentGetPayload<{ select: typeof ENROLLMENT_SELECT }>;
type StudentRow = Prisma.UserGetPayload<{ select: typeof STUDENT_SELECT }>;

/** The class row as the enrollment writes read it under the lock. */
interface LockedClass {
  code: string;
  status: ClassStatus;
  capacity: number;
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * What the caller sees of an enrollment: contact identifiers for holders of
 * `users.read_contact` only (D-R07), and the withdrawal reason for holders of
 * `enrollments.manage` only — an assigned teacher reading the roster gets
 * `null` (owner decision in the PR #14 review). `student.deletedAt` stays
 * visible to every roster reader.
 */
interface EnrollmentView {
  contact: UsersProjection;
  withdrawalReason: boolean;
}

function viewOf(caller: AuthPrincipal): EnrollmentView {
  return {
    contact: caller.permissions.includes(READ_CONTACT_PERMISSION) ? 'full' : 'reduced',
    withdrawalReason: caller.permissions.includes(MANAGE_ENROLLMENTS_PERMISSION),
  };
}

function toStudentDto(row: StudentRow, view: UsersProjection): EnrollmentStudentDto {
  const full = view === 'full';
  return {
    id: row.id,
    fullName: row.fullName,
    fullNameLatin: row.fullNameLatin,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    status: row.status,
    email: full ? row.email : null,
    username: full ? row.username : null,
    phone: full ? row.phone : null,
    deletedAt: isoOrNull(row.deletedAt),
  };
}

function toEnrollmentDto(row: EnrollmentRow, view: EnrollmentView): EnrollmentDto {
  return {
    id: row.id,
    classId: row.classId,
    status: row.status,
    source: row.source,
    enrolledAt: row.enrolledAt.toISOString(),
    activatedAt: isoOrNull(row.activatedAt),
    completedAt: isoOrNull(row.completedAt),
    withdrawnAt: isoOrNull(row.withdrawnAt),
    withdrawalReason: view.withdrawalReason ? row.withdrawalReason : null,
    student: toStudentDto(row.student, view.contact),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Locks the class row with the lock of every class-dependent write of MOD-05
 * (T02 capacity/status, T03 teachers): `FOR NO KEY UPDATE`. It serialises the
 * writes of one class without blocking the `FOR KEY SHARE` that inserting an
 * enrollment takes for its foreign key. Anything counted after it must be
 * counted in a later statement, which sees every commit made before the lock
 * was granted (KI-041 lesson, READ COMMITTED).
 */
async function lockClass(tx: Prisma.TransactionClient, classId: string): Promise<LockedClass | null> {
  const rows = await tx.$queryRaw<LockedClass[]>`
    SELECT code, status, capacity FROM classes WHERE id = ${classId}::uuid FOR NO KEY UPDATE`;
  return rows[0] ?? null;
}

/**
 * MOD-05-T04 — enrollments (roadmap §4d.4, D-R16/D-R18). The roster of a class
 * is read by holders of `enrollments.manage` or by a teacher assigned to the
 * class (everyone else 404); `enrollments.manage` enrolls a student straight
 * to `active` and runs the enrollment actions. Enrolling and reactivating
 * check the student, the class state and the hard capacity behind the
 * class-row lock, so two requests for the last seat cannot both succeed.
 * Every write is one transaction with exactly one audit event
 * (`enrollments.*`); a refusal writes and records nothing.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(classId: string, query: ListEnrollmentsQueryDto, caller: AuthPrincipal): Promise<EnrollmentListDto> {
    await this.assertRosterReadable(classId, caller);
    const limit = query.limit ?? ENROLLMENTS_PAGE_DEFAULT;
    const filters: Prisma.EnrollmentWhereInput[] = [{ classId }];
    if (query.status) filters.push({ status: query.status });
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, ROSTER_SORT, ROSTER_ORDER, false, () => classesError.cursorInvalid());
      filters.push({ id: { gt: cursor.id } });
    }
    const rows = await this.prisma.db.enrollment.findMany({
      where: { AND: filters },
      orderBy: [{ id: 'asc' }],
      take: limit + 1,
      select: ENROLLMENT_SELECT,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: ROSTER_SORT, order: ROSTER_ORDER, key: null, id: last.id }) : null;
    const view = viewOf(caller);
    return { items: page.map((row) => toEnrollmentDto(row, view)), nextCursor };
  }

  /**
   * Enrolls an invited or active student who holds the `student` role into an
   * open or running class with a free seat. Checks, in order: class (404),
   * student (404 / 422 user_not_eligible / 422 not_a_student), an existing
   * enrollment in any status (409 already_enrolled — reactivate it instead),
   * class state (409 class_not_enrollable), capacity (409 class_full).
   */
  async enroll(classId: string, input: CreateEnrollmentDto, caller: AuthPrincipal, ctx: RequestContext): Promise<EnrollmentDto> {
    const studentId = input.studentId;
    let enrollmentId: string;
    try {
      enrollmentId = await this.prisma.db.$transaction(async (tx) => {
        const klass = await lockClass(tx, classId);
        if (!klass) throw classesError.classNotFound(classId);
        await this.assertEnrollableStudent(tx, studentId);

        const existing = await tx.enrollment.findUnique({
          where: { classId_studentUserId: { classId, studentUserId: studentId } },
          select: { id: true, status: true },
        });
        if (existing) throw classesError.alreadyEnrolled(existing.id, existing.status);
        if (!isEnrollableClass(klass.status)) throw classesError.classNotEnrollable(klass.status);
        const activeCount = await tx.enrollment.count({ where: { classId, status: 'active' } });
        if (!hasFreeSeat(klass.capacity, activeCount)) throw classesError.classFull(klass.capacity, activeCount);

        const now = new Date();
        const created = await tx.enrollment.create({
          data: { classId, studentUserId: studentId, status: 'active', source: 'admin', enrolledAt: now, activatedAt: now, createdById: caller.id },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: ENROLLMENTS_AUDIT_ACTIONS.created,
            actorUserId: caller.id,
            entityType: ENROLLMENTS_ENTITY_TYPE,
            entityId: created.id,
            metadata: { classId, classCode: klass.code, studentUserId: studentId, status: 'active', source: 'admin' },
            ...ctx,
          },
          tx,
        );
        return created.id;
      });
    } catch (error) {
      throw await this.translateEnrollError(error, classId, studentId);
    }
    return this.getById(enrollmentId, viewOf(caller));
  }

  /**
   * withdraw / complete / cancel / reactivate (enrollments.status.ts). The
   * class row is locked first, so the action runs one after the other with
   * enrollments, capacity changes and the class's own complete/cancel (which
   * move active enrollments). `reactivate` opens a new active period, so it
   * re-checks everything a new enrollment checks: the student (404 / 422
   * user_not_eligible / 422 not_a_student — a student deleted, suspended or
   * stripped of the role after the withdrawal gets no seat), then the class
   * state and the capacity.
   */
  async changeStatus(id: string, input: ChangeEnrollmentStatusDto, caller: AuthPrincipal, ctx: RequestContext): Promise<EnrollmentDto> {
    const target = await this.prisma.db.enrollment.findUnique({ where: { id }, select: { classId: true } });
    if (!target) throw classesError.enrollmentNotFound(id);
    const classId = target.classId;
    const reason = input.reason ?? null;

    await this.prisma.db.$transaction(async (tx) => {
      // A class with enrollments cannot be deleted (Restrict), so the row exists.
      const klass = await lockClass(tx, classId);
      if (!klass) throw classesError.enrollmentNotFound(id);
      const current = await tx.enrollment.findUnique({ where: { id }, select: { status: true, studentUserId: true } });
      if (!current) throw classesError.enrollmentNotFound(id);
      const to = nextEnrollmentStatus(input.action, current.status);
      if (to === null) throw enrollmentsError.invalidTransition(current.status, input.action, allowedEnrollmentActions(current.status));

      if (takesSeat(input.action)) {
        await this.assertEnrollableStudent(tx, current.studentUserId);
        if (!isEnrollableClass(klass.status)) throw classesError.classNotEnrollable(klass.status);
        const activeCount = await tx.enrollment.count({ where: { classId, status: 'active' } });
        if (!hasFreeSeat(klass.capacity, activeCount)) throw classesError.classFull(klass.capacity, activeCount);
      }

      // Conditional on the status read under the lock (belt and braces: every
      // writer of this class's enrollments takes the same lock).
      const written = await tx.enrollment.updateMany({
        where: { id, status: current.status },
        data: enrollmentWrite(input.action, to, new Date(), reason),
      });
      if (written.count !== 1) throw enrollmentsError.invalidTransition(current.status, input.action, allowedEnrollmentActions(current.status));

      await this.audit.record(
        {
          action: ENROLLMENTS_AUDIT_ACTIONS.statusChanged,
          actorUserId: caller.id,
          entityType: ENROLLMENTS_ENTITY_TYPE,
          entityId: id,
          metadata: {
            classId,
            classCode: klass.code,
            studentUserId: current.studentUserId,
            action: input.action,
            from: current.status,
            to,
            ...(reason !== null ? { reason } : {}),
          },
          ...ctx,
        },
        tx,
      );
    });
    return this.getById(id, viewOf(caller));
  }

  /** D-R16: the roster belongs to enrollment managers and to the class's assigned teachers; anyone else gets 404 as for an unknown class. */
  private async assertRosterReadable(classId: string, caller: AuthPrincipal): Promise<void> {
    const klass = await this.prisma.db.class.findUnique({
      where: { id: classId },
      select: { teachers: { where: { teacherUserId: caller.id }, select: { teacherUserId: true } } },
    });
    const manages = caller.permissions.includes(MANAGE_ENROLLMENTS_PERMISSION);
    if (!klass || !canReadRoster(manages, klass.teachers.length > 0)) throw classesError.classNotFound(classId);
  }

  /**
   * For enroll and reactivate: unknown or soft-deleted 404, not invited/active
   * 422 user_not_eligible, no `student` role row 422 not_a_student (the T03
   * order for teachers).
   */
  private async assertEnrollableStudent(tx: Prisma.TransactionClient, studentId: string): Promise<void> {
    const student = await tx.user.findUnique({
      where: { id: studentId },
      select: { status: true, deletedAt: true, roles: { where: { role: { key: STUDENT_ROLE_KEY } }, select: { roleId: true } } },
    });
    if (!student || student.deletedAt !== null) throw classesError.userNotFound(studentId);
    if (!(ELIGIBLE_USER_STATUSES as readonly string[]).includes(student.status)) throw classesError.userNotEligible(studentId, student.status);
    if (student.roles.length === 0) throw classesError.notAStudent(studentId);
  }

  /**
   * The class-row lock serialises enrollments of one class, so the friendly
   * checks normally win; a unique violation (P2002 on
   * uq_enrollments_class_student) or a vanished student (P2003) can still come
   * from a writer that bypassed the API.
   */
  private async translateEnrollError(error: unknown, classId: string, studentId: string): Promise<unknown> {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
    if (error.code === 'P2002') {
      const existing = await this.prisma.db.enrollment.findUnique({
        where: { classId_studentUserId: { classId, studentUserId: studentId } },
        select: { id: true, status: true },
      });
      if (existing) return classesError.alreadyEnrolled(existing.id, existing.status);
    }
    if (error.code === 'P2003') return classesError.userNotFound(studentId);
    return error;
  }

  private async getById(id: string, view: EnrollmentView): Promise<EnrollmentDto> {
    const row = await this.prisma.db.enrollment.findUnique({ where: { id }, select: ENROLLMENT_SELECT });
    if (!row) throw classesError.enrollmentNotFound(id);
    return toEnrollmentDto(row, view);
  }
}
