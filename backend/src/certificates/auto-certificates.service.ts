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
import { earnsAutomaticCertificate, formatSerial, newVerificationCode, yearIn } from './certificates.policy.js';
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
 * completed every required published lesson of a course: one per student and
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
        this.notifications.dispatch(batch); // after the commit
        return certificate;
      } catch (error) {
        if (attempt === AWARD_ATTEMPTS) this.logger.error(`automatic certificate failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      }
    }
    return null;
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
    if (!earnsAutomaticCertificate({ hasCertificateForCourse: existing > 0, enrolled: true, courseComplete: progress.isComplete })) return none;

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
