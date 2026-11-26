import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { GradebookService } from '../grades/gradebook.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { escapeLikePattern } from '../users/users.validation.js';
import type {
  ListTeachingStudentsQueryDto,
  TeachingAttendanceCountsDto,
  TeachingClassAttendanceDto,
  TeachingClassGradesDto,
  TeachingEnrollmentDto,
  TeachingStudentDetailDto,
  TeachingStudentDto,
  TeachingStudentListDto,
  TeachingStudentListItemDto,
} from './teaching-students.dto.js';
import { SHOWN_ENROLLMENT_STATUSES, TEACHING_STUDENTS_CAP, attendanceRate, emptyTally, enrollmentStatusesOf } from './teaching-students.policy.js';
import type { AttendanceTally } from './teaching-students.policy.js';
import { teachingError } from './teaching.errors.js';

const READ_ATTENDANCE = 'attendance.read';
const READ_GRADES = 'grades.read_all';

const STUDENT_SELECT = { id: true, fullName: true, displayName: true, avatarUrl: true, email: true, phone: true } satisfies Prisma.UserSelect;

const ENROLLMENT_SELECT = {
  id: true,
  status: true,
  classId: true,
  studentUserId: true,
  student: { select: STUDENT_SELECT },
  class: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.EnrollmentSelect;

type EnrollmentRow = Prisma.EnrollmentGetPayload<{ select: typeof ENROLLMENT_SELECT }>;
type StudentRow = Prisma.UserGetPayload<{ select: typeof STUDENT_SELECT }>;

function toStudent(row: StudentRow): TeachingStudentDto {
  return { id: row.id, fullName: row.fullName, displayName: row.displayName, avatarUrl: row.avatarUrl, email: row.email, phone: row.phone };
}

function toEnrollment(row: EnrollmentRow): TeachingEnrollmentDto {
  return {
    enrollmentId: row.id,
    enrollmentStatus: row.status,
    class: {
      id: row.class.id,
      code: row.class.code,
      name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
      status: row.class.status,
      course: { id: row.class.course.id, code: row.class.course.code, name: readLocalizedText(row.class.course.name) ?? { ar: row.class.course.code } },
    },
  };
}

function toCounts(tally: AttendanceTally): TeachingAttendanceCountsDto {
  return { ...tally, rate: attendanceRate(tally) };
}

function addRecord(tally: AttendanceTally, status: string): void {
  if (status === 'present' || status === 'late' || status === 'absent' || status === 'excused') tally[status] += 1;
}

/** Enrollments in the classes the caller teaches (lead or assistant), of a student who is not deleted. */
function taughtWhere(callerId: string): Prisma.EnrollmentWhereInput {
  return { class: { teachers: { some: { teacherUserId: callerId } } }, student: { deletedAt: null } };
}

/**
 * «طلابي» (CH-0370): the students of the classes the caller teaches — read
 * only, never anyone else's students (a class the caller does not teach
 * matches nothing; another student is 404). Contact fields and guardians are
 * shown because the caller teaches the student. The marks are the class
 * gradebook's own row (API-126) and the attendance the lesson records, so the
 * numbers are those of the other screens. Records no audit event.
 */
@Injectable()
export class TeachingStudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gradebook: GradebookService,
  ) {}

  /** API-301 */
  async list(query: ListTeachingStudentsQueryDto, caller: AuthPrincipal): Promise<TeachingStudentListDto> {
    const where: Prisma.EnrollmentWhereInput = { ...taughtWhere(caller.id), status: { in: enrollmentStatusesOf(query.status) } };
    if (query.classId) where.classId = query.classId;
    const q = query.q?.trim();
    if (q) {
      const pattern = escapeLikePattern(q);
      where.student = {
        deletedAt: null,
        OR: [
          { fullName: { contains: pattern, mode: 'insensitive' } },
          { displayName: { contains: pattern, mode: 'insensitive' } },
          { email: { contains: pattern, mode: 'insensitive' } },
          { phone: { contains: pattern } },
        ],
      };
    }
    const rows = await this.prisma.db.enrollment.findMany({
      where,
      orderBy: [{ student: { fullName: 'asc' } }, { studentUserId: 'asc' }, { id: 'asc' }],
      take: TEACHING_STUDENTS_CAP * 10,
      select: ENROLLMENT_SELECT,
    });

    const byStudent = new Map<string, { student: StudentRow; enrollments: EnrollmentRow[] }>();
    for (const row of rows) {
      const entry = byStudent.get(row.studentUserId) ?? { student: row.student, enrollments: [] };
      entry.enrollments.push(row);
      byStudent.set(row.studentUserId, entry);
    }
    const students = [...byStudent.values()];
    const shown = students.slice(0, TEACHING_STUDENTS_CAP);

    const tallies = new Map<string, AttendanceTally>();
    if (caller.permissions.includes(READ_ATTENDANCE) && shown.length > 0) {
      const records = await this.prisma.db.attendanceRecord.findMany({
        where: {
          studentUserId: { in: shown.map((entry) => entry.student.id) },
          lesson: { classId: { in: [...new Set(shown.flatMap((entry) => entry.enrollments.map((row) => row.classId)))] }, status: { not: 'cancelled' } },
        },
        select: { studentUserId: true, status: true, lesson: { select: { classId: true } } },
      });
      const shownClasses = new Map(shown.map((entry) => [entry.student.id, new Set(entry.enrollments.map((row) => row.classId))]));
      for (const record of records) {
        // Only the classes shown for this student (a withdrawn class stays out of an «active» list).
        if (!shownClasses.get(record.studentUserId)?.has(record.lesson.classId)) continue;
        const tally = tallies.get(record.studentUserId) ?? emptyTally();
        addRecord(tally, record.status);
        tallies.set(record.studentUserId, tally);
      }
    }

    const items: TeachingStudentListItemDto[] = shown.map(({ student, enrollments }) => ({
      student: toStudent(student),
      classes: enrollments.map(toEnrollment),
      attendance: caller.permissions.includes(READ_ATTENDANCE) ? toCounts(tallies.get(student.id) ?? emptyTally()) : null,
    }));
    return { items, truncated: students.length > TEACHING_STUDENTS_CAP || rows.length === TEACHING_STUDENTS_CAP * 10 };
  }

  /** API-302 */
  async detail(studentId: string, caller: AuthPrincipal): Promise<TeachingStudentDetailDto> {
    const enrollments = await this.prisma.db.enrollment.findMany({
      where: { ...taughtWhere(caller.id), studentUserId: studentId, status: { in: [...SHOWN_ENROLLMENT_STATUSES] } },
      orderBy: { id: 'asc' },
      select: ENROLLMENT_SELECT,
    });
    if (enrollments.length === 0) throw teachingError.studentNotFound(studentId);

    const links = await this.prisma.db.guardianStudent.findMany({
      where: { studentUserId: studentId, guardian: { deletedAt: null } },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: { relationship: true, isPrimary: true, guardian: { select: { id: true, fullName: true, displayName: true, email: true, phone: true } } },
    });

    const readsAttendance = caller.permissions.includes(READ_ATTENDANCE);
    const readsGrades = caller.permissions.includes(READ_GRADES);
    const classes = [];
    for (const row of enrollments) {
      classes.push({
        ...toEnrollment(row),
        attendance: readsAttendance ? await this.classAttendance(row.classId, studentId) : null,
        grades: readsGrades ? await this.classGrades(row.classId, studentId, caller) : null,
      });
    }

    return {
      student: toStudent(enrollments[0]!.student),
      guardians: links.map((link) => ({
        id: link.guardian.id,
        fullName: link.guardian.fullName,
        displayName: link.guardian.displayName,
        relationship: link.relationship,
        isPrimary: link.isPrimary,
        email: link.guardian.email,
        phone: link.guardian.phone,
      })),
      classes,
    };
  }

  /** The class's lessons that have started (not cancelled), newest first, with this student's record. */
  private async classAttendance(classId: string, studentId: string): Promise<TeachingClassAttendanceDto> {
    const lessons = await this.prisma.db.lesson.findMany({
      where: { classId, status: { not: 'cancelled' }, startsAt: { lte: new Date() } },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true, startsAt: true, status: true, attendance: { where: { studentUserId: studentId }, select: { status: true, minutesLate: true } } },
    });
    const tally = emptyTally();
    const rows = lessons.map((lesson) => {
      const record = lesson.attendance[0] ?? null;
      if (record) addRecord(tally, record.status);
      return {
        lessonId: lesson.id,
        title: readLocalizedText(lesson.title) ?? { ar: '' },
        startsAt: lesson.startsAt.toISOString(),
        lessonStatus: lesson.status,
        status: record?.status ?? null,
        minutesLate: record?.minutesLate ?? null,
      };
    });
    return { ...toCounts(tally), lessons: rows };
  }

  /** The student's row of the class gradebook (API-126), or null when the gradebook does not list them. */
  private async classGrades(classId: string, studentId: string, caller: AuthPrincipal): Promise<TeachingClassGradesDto | null> {
    const book = await this.gradebook.gradebook(classId, caller);
    const row = book.students.find((entry) => entry.student.id === studentId);
    if (!row) return null;
    return { components: book.components, cells: row.cells, current: row.current, projected: row.projected, final: row.final };
  }
}
