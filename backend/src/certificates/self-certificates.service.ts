import { Injectable } from '@nestjs/common';
import { readSettings } from '../academy/academy.settings.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { enrollmentWrite, nextEnrollmentStatus } from '../enrollments/enrollments.status.js';
import type { ClassStatus, EnrollmentStatus, Prisma } from '../generated/prisma/client.js';
import { GradebookService } from '../grades/gradebook.service.js';
import type { LearnerGrade } from '../grades/gradebook.service.js';
import { buildCurriculum } from '../learning/learning.curriculum.js';
import { progressOf } from '../learning/learning.progress.js';
import { loadCurriculumRows, loadLessonStates, stateOf } from '../learning/learning.read.js';
import { EMPTY_BATCH, NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { certificatesError } from './certificates.errors.js';
import { completionStateOf } from './certificates.policy.js';
import type { CompletionState } from './certificates.policy.js';
import { CERTIFICATE_SELECT, CertificatesService } from './certificates.service.js';
import { toMyCertificateItem } from './my-certificates.service.js';
import type { ClaimCertificateResultDto, EnrollmentCompletionDto } from './my-certificates.dto.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

/** A claim reads the whole class's grades under its lock: more than Prisma's default 2 s / 5 s on a large class. */
const CLAIM_TX = { maxWait: 10_000, timeout: 20_000 };

const OWN_STATUSES: readonly EnrollmentStatus[] = ['active', 'completed'];
const NO_GRADE: LearnerGrade = { work: [], pending: 0, grade: null };

interface OwnEnrollment {
  id: string;
  status: EnrollmentStatus;
  classId: string;
  class: { code: string; status: ClassStatus; courseId: string };
}

interface Lessons {
  required: number;
  completed: number;
  isComplete: boolean;
}

interface CertificateRef {
  id: string;
  serial: string;
  status: 'issued' | 'revoked';
}

/**
 * ADR-049 (J-F67) — a student takes their own certificate once they have
 * finished a course (API-070/071). Off unless the academy turned on
 * `settings.certificates.selfIssue`, so the office's flow (D-R52) stays the
 * rule elsewhere. By ownership of the enrollment, with `certificates.read_own`.
 * Every condition is the server's: the required published lessons are complete
 * (MOD-20, computed on read), each weighted assessment is finished and visible
 * to the student (`visibleResult()` of «my exams», a graded assignment), and
 * the grade they come to passes on the scheme of the student's final grade,
 * else the default one. The claim runs under the class-row lock — the lock of a
 * finalization and of the office's issuing — then the grade schemes' shared
 * lock; it fixes the student's final grade, completes their enrollment and
 * issues the certificate in one transaction with one `certificates.issued`
 * event. A revoked certificate never comes back this way (D-R55).
 */
@Injectable()
export class SelfCertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gradebook: GradebookService,
    private readonly certificates: CertificatesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** API-070 */
  async completion(enrollmentId: string, caller: AuthPrincipal): Promise<EnrollmentCompletionDto> {
    const db = this.prisma.db;
    const enrollment = await this.ownEnrollment(db, enrollmentId, caller);
    const lessons = await this.lessonsOf(db, enrollment.class.courseId, caller.id);
    const certificate = await this.certificateOf(db, enrollmentId);
    const selfIssue = await this.selfIssueOn(db);
    const learner = (await this.gradebook.learnerGrade(db, enrollment.classId, enrollmentId)) ?? NO_GRADE;
    return {
      enrollmentId,
      classId: enrollment.classId,
      courseId: enrollment.class.courseId,
      state: this.stateOf(enrollment.class.status, certificate, selfIssue, lessons, learner),
      lessons: { required: lessons.required, completed: lessons.completed },
      work: learner.work,
      grade: learner.grade
        ? { percent: Number(learner.grade.percent), label: learner.grade.bandLabel, letter: learner.grade.bandLetter, isPass: learner.grade.isPass }
        : null,
      certificate,
    };
  }

  /** API-071 */
  async claim(enrollmentId: string, caller: AuthPrincipal, ctx: RequestContext): Promise<ClaimCertificateResultDto> {
    const before = await this.ownEnrollment(this.prisma.db, enrollmentId, caller);
    // Read before the transaction: a completed lesson never reverts (D-R134), and these reads run side by side.
    const lessons = await this.lessonsOf(this.prisma.db, before.class.courseId, caller.id);
    const { row, created, batch } = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM classes WHERE id = ${before.classId}::uuid FOR NO KEY UPDATE`;
      const enrollment = await this.ownEnrollment(tx, enrollmentId, caller);
      const certificate = await this.certificateOf(tx, enrollmentId);
      if (certificate?.status === 'issued') {
        const existing = await tx.certificate.findUniqueOrThrow({ where: { id: certificate.id }, select: CERTIFICATE_SELECT });
        return { row: existing, created: false, batch: EMPTY_BATCH };
      }
      await this.gradebook.lockGradeSchemes(tx);
      const selfIssue = await this.selfIssueOn(tx);
      const learner = (await this.gradebook.learnerGrade(tx, enrollment.classId, enrollmentId)) ?? NO_GRADE;
      const state = this.stateOf(enrollment.class.status, certificate, selfIssue, lessons, learner);
      if (state !== 'ready') throw certificatesError.notReady(state);

      const final = await this.gradebook.fixLearnerGrade(tx, enrollment.classId, enrollmentId, caller.id);
      const completed = nextEnrollmentStatus('complete', enrollment.status);
      if (completed) await tx.enrollment.updateMany({ where: { id: enrollmentId, status: enrollment.status }, data: enrollmentWrite('complete', completed, new Date(), null) });
      const issued = await this.certificates.issueToLearner(tx, { id: enrollment.classId, code: enrollment.class.code }, final, caller, ctx);
      return { row: issued.row, created: true, batch: issued.batch };
    }, CLAIM_TX);
    this.notifications.dispatch(batch); // after the commit
    return { created, certificate: toMyCertificateItem(row, caller.id) };
  }

  // ---------------------------------------------------------------------------

  private stateOf(classStatus: ClassStatus, certificate: CertificateRef | null, selfIssue: boolean, lessons: Lessons, learner: LearnerGrade): CompletionState {
    return completionStateOf({
      certificate: certificate?.status ?? null,
      selfIssue,
      classStatus,
      lessonsComplete: lessons.isComplete,
      workCount: learner.work.length,
      pending: learner.pending,
      isPass: learner.grade?.isPass ?? null,
    });
  }

  /** The caller's own active or completed enrollment; anything else is the same 404. */
  private async ownEnrollment(db: Db, enrollmentId: string, caller: AuthPrincipal): Promise<OwnEnrollment> {
    const row = await db.enrollment.findFirst({
      where: { id: enrollmentId, studentUserId: caller.id, status: { in: [...OWN_STATUSES] } },
      select: { id: true, status: true, classId: true, class: { select: { code: true, status: true, courseId: true } } },
    });
    if (!row) throw certificatesError.enrollmentNotFound(enrollmentId);
    return row;
  }

  /** The required published lessons of the course and how many the student completed (MOD-20, D-R135). */
  private async lessonsOf(db: Db, courseId: string, studentId: string): Promise<Lessons> {
    const rows = (await loadCurriculumRows(db, [courseId])).get(courseId) ?? { sections: [], items: [] };
    const published = buildCurriculum(rows.sections, rows.items, { learner: true }).flatMap((group) => group.items);
    const states = await loadLessonStates(db, [studentId], [courseId], rows.items);
    const progress = progressOf(published, new Map(published.map((item) => [item.id, stateOf(states, studentId, item.id)])));
    return { required: progress.required, completed: progress.completedRequired, isComplete: progress.isComplete };
  }

  /** The issued certificate of the enrollment, else its latest revoked one, else null. */
  private async certificateOf(db: Db, enrollmentId: string): Promise<CertificateRef | null> {
    const rows = await db.certificate.findMany({ where: { enrollmentId }, orderBy: { id: 'desc' }, select: { id: true, serial: true, status: true } });
    return rows.find((row) => row.status === 'issued') ?? rows[0] ?? null;
  }

  private async selfIssueOn(db: Db): Promise<boolean> {
    const academy = await db.academy.findFirst({ select: { settings: true } });
    return readSettings(academy?.settings).certificates.selfIssue === true;
  }
}
