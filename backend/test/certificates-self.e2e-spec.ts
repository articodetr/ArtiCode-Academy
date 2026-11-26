// TEST-189 — ADR-049 (J-F67): a student takes their own certificate once they
// have finished a course (API-070/071), through the API with the seeded
// `teacher` and `student` roles and a custom office role: the switch of the
// academy, the required lessons, an online exam that releases on submit, a
// failing then a passing attempt, the certificate with its final grade and its
// completed enrollment, exactly one event, the repeated request, a class
// finalization beside it and a revocation that only the office can undo.
// Against the live database; the suite restores the academy's settings and is
// skipped when no database is reachable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import { available, bootHarness, choiceBody, pickAnswers } from './online-exams.helpers.js';
import type { AttemptQuestionBody, Harness } from './online-exams.helpers.js';

const ACADEMY = '/api/academy';

describe.skipIf(!available)('a student takes their own certificate (e2e, TEST-189 — ADR-049)', () => {
  let h: Harness;
  let storedSettings: Prisma.JsonValue | null = null;
  let academyId: string;
  let enrollmentId: string;
  let otherEnrollmentId: string;
  let withdrawnEnrollmentId: string;
  let examId: string;
  const lessonIds: string[] = [];

  const completion = (user: string, id = enrollmentId) => h.api().get(`/api/me/enrollments/${id}/completion`).set(h.as(user));
  const claim = (user: string, id = enrollmentId) => h.api().post(`/api/me/enrollments/${id}/certificate`).set(h.as(user)).send();

  /** One attempt at the exam, answered with these option indexes and handed in. */
  async function attempt(picks: readonly number[]): Promise<void> {
    const started = (await h.startAttempt('student', examId).expect(201)).body as { id: string; questions: AttemptQuestionBody[] };
    await h.saveAnswers('student', started.id, pickAnswers(started.questions, picks)).expect(200);
    await h.submitAttempt('student', started.id).expect(200);
  }

  beforeAll(async () => {
    h = await bootHarness('TEST-189');
    const academy = await h.prisma.academy.findFirstOrThrow({ select: { id: true, settings: true } });
    academyId = academy.id;
    storedSettings = academy.settings;
    await h.prisma.academy.update({ where: { id: academyId }, data: { settings: {} }, select: { id: true } });

    const teacher = await h.systemRole('teacher');
    const student = await h.systemRole('student');
    await h.createUser('office', [
      await h.createRole('office', ['academy.settings.manage', 'classes.read', 'classes.manage', 'exams.read', 'exams.manage', 'grades.read_all', 'grades.manage', 'certificates.read_all', 'certificates.revoke']),
    ]);
    await h.createUser('nokey', [await h.createRole('nokey', ['courses.read'])]);
    await h.createUser('teacher', [teacher]);
    await h.createUser('student', [student]);
    await h.createUser('other', [student]);
    await h.createUser('left', [student]);

    const courseId = await h.course('S');
    for (const [index, title] of ['الدرس الأول', 'الدرس الثاني'].entries()) {
      const lesson = await h.prisma.courseSyllabusItem.create({ data: { courseId, sortOrder: index, title: { ar: title }, kind: 'text', content: { body: { ar: 'نص الدرس' } } }, select: { id: true } });
      lessonIds.push(lesson.id);
    }
    await h.klass('C', 'S', ['teacher'], 'running');
    enrollmentId = await h.enroll('C', 'student');
    otherEnrollmentId = await h.enroll('C', 'other');
    withdrawnEnrollmentId = await h.enroll('C', 'left', 'withdrawn');
  }, 90_000);

  afterAll(async () => {
    if (!h) return;
    try {
      await h.prisma.academy.update({ where: { id: academyId }, data: { settings: (storedSettings ?? {}) as Prisma.InputJsonValue }, select: { id: true } });
      await h.prisma.learningProgress.deleteMany({ where: { syllabusItemId: { in: lessonIds } } });
    } finally {
      await h.close();
    }
  });

  it('is off until the academy turns it on, then asks for the lessons, then for an assessment', async () => {
    expect((await completion('student').expect(200)).body).toMatchObject({ enrollmentId, classId: h.classes['C'], courseId: h.courses['S'], state: 'not_offered', lessons: { required: 2, completed: 0 }, work: [], grade: null, certificate: null });
    expect((await claim('student').expect(409)).body).toMatchObject({ code: 'certificate_not_ready', state: 'not_offered' });

    const patched = await h.api().patch(ACADEMY).set(h.as('office')).send({ settings: { certificates: { selfIssue: true } } }).expect(200);
    expect(patched.body.settings.certificates).toEqual({ serialPrefix: null, selfIssue: true });
    for (const bad of ['yes', 1]) await h.api().patch(ACADEMY).set(h.as('office')).send({ settings: { certificates: { selfIssue: bad } } }).expect(400);

    expect((await completion('student').expect(200)).body.state).toBe('lessons_pending');
    expect((await claim('student').expect(409)).body.state).toBe('lessons_pending');
    for (const id of lessonIds) await h.api().post(`/api/me/learning/items/${id}/complete`).set(h.as('student')).send({}).expect(200);
    expect((await completion('student').expect(200)).body).toMatchObject({ state: 'no_assessments', lessons: { required: 2, completed: 2 } });
  });

  it('counts an exam only once its result is out, gives no grade before, and refuses a failing grade until a better attempt', async () => {
    const bank = await h.bank('teacher', { name: { ar: 'بنك الدورة' }, courseId: h.courses['S'] });
    const first = await h.question('teacher', bank.id, choiceBody('السؤال الأول', ['خطأ', 'صواب'], 1, { points: 5 }));
    const second = await h.question('teacher', bank.id, choiceBody('السؤال الثاني', ['خطأ', 'صواب'], 1, { points: 5 }));
    examId = await h.onlineExam('teacher', 'C', [{ questionId: first.id }, { questionId: second.id }], { title: { ar: 'الاختبار النهائي' }, type: 'final', weight: 100, attemptsAllowed: 3, resultsRelease: 'on_submit' });

    const pending = (await completion('student').expect(200)).body;
    expect(pending).toMatchObject({ state: 'assessments_pending', grade: null, work: [{ kind: 'exam', id: examId, title: { ar: 'الاختبار النهائي' }, maxScore: 10, done: false, score: null }] });
    expect(JSON.stringify(pending)).not.toContain('weight');

    await attempt([0, 0]);
    const failed = (await completion('student').expect(200)).body;
    expect(failed).toMatchObject({ state: 'not_passed', grade: { percent: 0, isPass: false }, work: [{ done: true, score: 0 }] });
    expect((await claim('student').expect(409)).body.state).toBe('not_passed');
    expect(await h.prisma.certificate.count({ where: { enrollmentId } })).toBe(0);
    expect(await h.prisma.finalGrade.count({ where: { enrollmentId } })).toBe(0);

    await attempt([1, 1]);
    expect((await completion('student').expect(200)).body).toMatchObject({ state: 'ready', grade: { percent: 100, isPass: true }, work: [{ done: true, score: 10 }], certificate: null });
  });

  it('issues the certificate with the final grade and the completed enrollment, one event and one notification; asking again writes nothing', async () => {
    const mark = await h.mark();
    const taken = await claim('student').expect(200);
    expect(taken.body.created).toBe(true);
    expect(taken.body.certificate).toMatchObject({ status: 'issued', enrollmentId, relation: 'self', grade: { percent: 100 }, class: { id: h.classes['C'] }, course: { id: h.courses['S'] } });
    for (const hidden of ['issuedBy', 'revokedBy', 'revokeReason']) expect(taken.body.certificate).not.toHaveProperty(hidden);
    const certificateId = taken.body.certificate.id as string;

    const enrollment = await h.prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, select: { status: true, completedAt: true } });
    expect(enrollment.status).toBe('completed');
    expect(enrollment.completedAt).not.toBeNull();
    const final = await h.prisma.finalGrade.findUniqueOrThrow({ where: { enrollmentId }, select: { percent: true, isPass: true, finalizedById: true } });
    expect({ percent: Number(final.percent), isPass: final.isPass, finalizedById: final.finalizedById }).toEqual({ percent: 100, isPass: true, finalizedById: h.id('student') });

    const events = await h.eventsSince(mark);
    expect(events.map((event) => event.action)).toEqual(['certificates.issued']);
    expect(events[0]).toMatchObject({ actorUserId: h.id('student'), entityType: 'classes', entityId: h.classes['C'], metadata: { count: 1, certificateIds: [certificateId], via: 'self_service', enrollmentId } });
    expect(await h.prisma.notification.count({ where: { recipientUserId: h.id('student'), eventKey: 'certificate.issued' } })).toBe(1);

    const again = await claim('student').expect(200);
    expect(again.body).toMatchObject({ created: false, certificate: { id: certificateId, serial: taken.body.certificate.serial } });
    expect(await h.eventsSince(mark)).toHaveLength(1);
    expect(await h.prisma.certificate.count({ where: { enrollmentId } })).toBe(1);
    expect((await completion('student').expect(200)).body).toMatchObject({ state: 'issued', certificate: { id: certificateId, status: 'issued' } });
    expect((await h.api().get('/api/me/certificates').set(h.as('student')).expect(200)).body.items.map((item: { id: string }) => item.id)).toContain(certificateId);
  });

  it('never opens another student’s enrollment, a closed one, or a caller without the key', async () => {
    await completion('student', otherEnrollmentId).expect(404);
    expect((await claim('student', otherEnrollmentId).expect(404)).body.code).toBe('enrollment_not_found');
    await completion('left', withdrawnEnrollmentId).expect(404);
    await claim('left', withdrawnEnrollmentId).expect(404);
    await completion('nokey').expect(403);
    await claim('nokey').expect(403);
    await h.api().get('/api/me/enrollments/not-a-uuid/completion').set(h.as('student')).expect(400);
  });

  it('lets the office finalize the rest of the class around a certificate a student took, keeping that student’s grade', async () => {
    await h.closeWindow(examId);
    await h.act('office', examId, 'publish').expect(200);
    await h.api().post(`/api/classes/${h.classes['C']}/final-grades`).set(h.as('office')).send({}).expect(200);
    const kept = await h.prisma.finalGrade.findUniqueOrThrow({ where: { enrollmentId }, select: { percent: true, finalizedById: true } });
    expect({ percent: Number(kept.percent), finalizedById: kept.finalizedById }).toEqual({ percent: 100, finalizedById: h.id('student') });
    const rest = await h.prisma.finalGrade.findUniqueOrThrow({ where: { enrollmentId: otherEnrollmentId }, select: { percent: true, finalizedById: true } });
    expect({ percent: Number(rest.percent), finalizedById: rest.finalizedById }).toEqual({ percent: 0, finalizedById: h.id('office') });
  });

  it('never brings a revoked certificate back: only the office issues again', async () => {
    const issued = await h.prisma.certificate.findFirstOrThrow({ where: { enrollmentId, status: 'issued' }, select: { id: true } });
    await h.api().post(`/api/certificates/${issued.id}/revoke`).set(h.as('office')).send({ reason: 'مراجعة الدرجة' }).expect(200);
    expect((await completion('student').expect(200)).body).toMatchObject({ state: 'revoked', certificate: { id: issued.id, status: 'revoked' } });
    expect((await claim('student').expect(409)).body).toMatchObject({ code: 'certificate_not_ready', state: 'revoked' });
    expect(await h.prisma.certificate.count({ where: { enrollmentId, status: 'issued' } })).toBe(0);
  });
});
