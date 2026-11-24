import { Injectable, Logger } from '@nestjs/common';
import { readSettings, DEFAULT_CERTIFICATE_SERIAL_PREFIX } from '../academy/academy.settings.js';
import { AuditService } from '../audit/audit.service.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { buildCurriculum } from '../learning/learning.curriculum.js';
import { progressOf } from '../learning/learning.progress.js';
import { loadCurriculumRows, loadLessonStates, stateOf } from '../learning/learning.read.js';
import { learningAccessOf } from '../learning/my-learning.policy.js';
import { EMPTY_BATCH, NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { earnsAutomaticCertificate, examPassed, examsComplete, formatSerial, newVerificationCode, yearIn } from './certificates.policy.js';
import { reserveCertificateSerials } from './certificates.serials.js';

export interface AutoCertificate {
  id: string;
  serial: string;
}

const AWARD_ATTEMPTS = 2;
const AWARD_TX = { maxWait: 10_000, timeout: 15_000 };

function localized(value: Prisma.JsonValue, fallback: string): LocalizedText {
  return readLocalizedText(value) ?? { ar: fallback };
}

/**
 * CH-0363 — issues the course-completion certificate the moment a student has
 * completed every required published lesson of a course — and, since J-F67, done
 * every scheduled or published exam of their class, PASSED since CH-0244 (a lesson
 * completion, an exam submitted or closed, a result recorded, the results published
 * or regraded call it, whichever comes last): one per student and
 * course, without a grade, a staff action or a payment check. Called after the
 * completion is committed; a failure is logged and never fails the learner's
 * or the teacher's request.
 */
@Injectable()
export class AutoCertificatesService {
  private readonly logger = new Logger(AutoCertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async awardIfComplete(studentId: string, courseId: string): Promise<AutoCertificate | null> {
    for (let attempt = 1; attempt <= AWARD_ATTEMPTS; attempt += 1) {
      try {
        const { certificate, batch } = await this.prisma.db.$transaction((tx) => this.award(tx, studentId, courseId), AWARD_TX);
        // After the commit; only a certificate issued here has a notification to send (a check that issues
        // nothing — most of the calls after a publish — hands the dispatcher nothing).
        if (certificate) this.notifications.dispatch(batch);
        return certificate;
      } catch (error) {
        if (attempt === AWARD_ATTEMPTS) this.logger.error(`automatic certificate failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      }
    }
    return null;
  }

  /**
   * CH-0244 — after the commit of a write that released or changed the results of an exam (`publish` — API-117, a
   * key correction — API-272, a regrade — API-273): every student holding a result of the exam may now have passed
   * the last exam of their class, so their course's certificate is checked. Never throws.
   */
  async awardForExam(examId: string): Promise<void> {
    try {
      const exam = await this.prisma.db.exam.findUnique({ where: { id: examId }, select: { class: { select: { courseId: true } }, results: { select: { studentUserId: true } } } });
      if (!exam) return;
      for (const { studentUserId } of exam.results) await this.awardIfComplete(studentUserId, exam.class.courseId);
    } catch (error) {
      this.logger.error(`the certificate check after an exam's results changed failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    }
  }

  /**
   * J-F67 / CH-0244 — every scheduled or published exam of the class PASSED by the student (`examPassed()`): their
   * result is visible to them and at or above the pass mark (or excused). The counted result of an online exam is
   * its `exam_results` row, so the attempts themselves are not read.
   */
  private async examsPassed(tx: Prisma.TransactionClient, studentId: string, classId: string): Promise<boolean> {
    const exams = await tx.exam.findMany({
      where: { classId, status: { in: ['scheduled', 'published'] } },
      select: { id: true, status: true, delivery: true, resultsRelease: true, passScore: true },
    });
    if (exams.length === 0) return true;
    const ids = exams.map((exam) => exam.id);
    const results = await tx.examResult.findMany({ where: { examId: { in: ids }, studentUserId: studentId }, select: { examId: true, status: true, score: true, source: true } });
    const resultOf = new Map(results.map((row) => [row.examId, { status: row.status, score: row.score?.toString() ?? null, source: row.source }]));
    const passed = exams.filter((exam) =>
      examPassed({ status: exam.status, delivery: exam.delivery, resultsRelease: exam.resultsRelease, passScore: exam.passScore?.toString() ?? null }, resultOf.get(exam.id) ?? null),
    );
    return examsComplete(ids, new Set(passed.map((exam) => exam.id)));
  }

  private async award(tx: Prisma.TransactionClient, studentId: string, courseId: string) {
    const none = { certificate: null, batch: EMPTY_BATCH };
    // One decision at a time per (student, course), across all the classes of the course.
    const lockKey = `articode.certificates.auto:${studentId}:${courseId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const student = await tx.user.findUnique({ where: { id: studentId }, select: { fullName: true, fullNameLatin: true, displayName: true, deletedAt: true } });
    if (!student || student.deletedAt !== null) return none;
    const rows = await tx.enrollment.findMany({
      where: { studentUserId: studentId, class: { courseId } },
      select: { id: true, status: true, enrolledAt: true, classId: true },
    });
    const access = learningAccessOf(rows);
    if (!access.allowed) return none;
    const enrollment = access.enrollment;
    // The lock a manual issue takes, so the two never both certify one enrollment.
    await tx.$queryRaw`SELECT id FROM classes WHERE id = ${enrollment.classId}::uuid FOR NO KEY UPDATE`;

    const existing = await tx.certificate.count({ where: { studentUserId: studentId, courseId } });
    const curriculum = (await loadCurriculumRows(tx, [courseId])).get(courseId) ?? { sections: [], items: [] };
    const published = buildCurriculum(curriculum.sections, curriculum.items, { learner: true }).flatMap((group) => group.items);
    const states = await loadLessonStates(tx, [studentId], [courseId], curriculum.items);
    const progress = progressOf(published, new Map(published.map((item) => [item.id, stateOf(states, studentId, item.id)])));
    const examsPassed = await this.examsPassed(tx, studentId, enrollment.classId);
    if (!earnsAutomaticCertificate({ hasCertificateForCourse: existing > 0, enrolled: true, courseComplete: progress.isComplete, examsPassed })) return none;

    const now = new Date();
    const academy = await tx.academy.findFirst({ select: { name: true, timezone: true, settings: true } });
    const prefix = readSettings(academy?.settings).certificates.serialPrefix ?? DEFAULT_CERTIFICATE_SERIAL_PREFIX;
    const year = yearIn(academy?.timezone ?? 'UTC', now);
    const number = await reserveCertificateSerials(tx, year, 1);
    const details = await tx.class.findUniqueOrThrow({ where: { id: enrollment.classId }, select: { code: true, name: true, course: { select: { code: true, name: true } } } });
    const courseName = localized(details.course.name, details.course.code);
    const snapshot = {
      student: { fullName: student.fullName, fullNameLatin: student.fullNameLatin, displayName: student.displayName },
      course: { code: details.course.code, name: courseName },
      class: { code: details.code, name: localized(details.name, details.code) },
      academy: { name: academy ? localized(academy.name, '') : { ar: '' } },
      grade: null,
      completedAt: progress.completedAt?.toISOString() ?? now.toISOString(),
      issuedAt: now.toISOString(),
    };
    const created = await tx.certificate.create({
      data: {
        serial: formatSerial(prefix, year, number),
        verificationCode: newVerificationCode(),
        enrollmentId: enrollment.id,
        classId: enrollment.classId,
        courseId,
        studentUserId: studentId,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        issuedAt: now,
      },
      select: { id: true, serial: true },
    });
    await this.audit.record(
      {
        action: 'certificates.issued',
        actorUserId: null,
        entityType: 'classes',
        entityId: enrollment.classId,
        metadata: { code: details.code, count: 1, certificateIds: [created.id], source: 'course_completion' },
      },
      tx,
    );
    const batch = await this.notifications.notifyStudents(tx, 'certificate.issued', [
      { studentId, params: { certificateId: created.id, serial: created.serial, courseName } },
    ]);
    return { certificate: { id: created.id, serial: created.serial }, batch };
  }
}
