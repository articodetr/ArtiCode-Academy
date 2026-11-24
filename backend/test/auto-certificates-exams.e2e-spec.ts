// TEST-190 — CH-0244: the automatic course certificate (CH-0363, J-F67) needs
// every exam of the student's class PASSED, not only taken (Jallal's decision of
// 2026-11-24): the result visible to the learner (a manual exam once published,
// an online exam that releases on submit at once) and at or above the exam's
// pass mark, or excused. Each write that can make that true checks it after its
// commit: a lesson completed, an attempt submitted or closed by the server, a
// result recorded, the results published. Fixtures carry the harness prefix and
// are deleted at the end. Skipped when no database is reachable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExamGradingService } from '../src/exams/exam-grading.service.js';
import type { AttemptQuestionBody, Harness } from './online-exams.helpers.js';
import { available, bootHarness, trueFalseBody } from './online-exams.helpers.js';

const TRUE_PROMPT = 'الماء يغلي عند مئة درجة مئوية.';
const FALSE_PROMPT = 'الشمس تدور حول الأرض.';
const ANSWER: Record<string, boolean> = { [TRUE_PROMPT]: true, [FALSE_PROMPT]: false };

describe.skipIf(!available)('CH-0244 automatic certificate after the exams are passed (e2e, TEST-190)', () => {
  let h: Harness;
  let grading: ExamGradingService;
  const lessons: Record<string, string> = {};
  let questionIds: string[] = [];

  const complete = (student: string, courseSuffix: string) => h.api().post(`/api/me/learning/items/${lessons[courseSuffix]}/complete`).set(h.as(student)).send({});
  const certificatesOf = (student: string, courseSuffix: string) => h.prisma.certificate.findMany({ where: { studentUserId: h.id(student), courseId: h.courses[courseSuffix]! }, select: { id: true, status: true } });

  /** A published course with one required text lesson, and a class of it taught by `teacher` with these students. */
  async function courseClass(suffix: string, students: readonly string[]): Promise<string> {
    await h.course(suffix);
    const item = await h.prisma.courseSyllabusItem.create({ data: { courseId: h.courses[suffix]!, sortOrder: 0, kind: 'text', title: { ar: 'درس' }, content: { body: { ar: 'نص' } } }, select: { id: true } });
    lessons[suffix] = item.id;
    const classId = await h.klass(suffix, suffix, ['teacher'], 'running');
    for (const student of students) await h.enroll(suffix, student);
    return classId;
  }

  /** Both true/false questions answered right, or both wrong (5 points each, out of 10). */
  function answers(questions: readonly AttemptQuestionBody[], right: boolean): Record<string, unknown>[] {
    return questions.map((question) => ({ examQuestionId: question.id, value: right === ANSWER[question.prompt.ar] }));
  }

  /** Starts an attempt, saves its answers and submits it; returns the attempt id. */
  async function takeExam(student: string, examId: string, right: boolean, submit = true): Promise<string> {
    const started = await h.startAttempt(student, examId);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const attemptId = started.body.id as string;
    await h.saveAnswers(student, attemptId, answers(started.body.questions as AttemptQuestionBody[], right)).expect(200);
    if (submit) await h.submitAttempt(student, attemptId).expect(200);
    return attemptId;
  }

  const online = (classSuffix: string, over: Record<string, unknown>) =>
    h.onlineExam(
      'teacher',
      classSuffix,
      questionIds.map((questionId) => ({ questionId, points: 5 })),
      { passScore: 6, ...over },
    );

  beforeAll(async () => {
    h = await bootHarness('TEST-190');
    grading = h.app.get(ExamGradingService);
    await h.createUser('teacher', [await h.systemRole('teacher')]);
    const student = await h.systemRole('student');
    for (const name of ['m1', 'm2', 'm3', 'o1', 'o2', 'p1', 't1']) await h.createUser(name, [student]);
    // A bank filed under no course: its author links it to an exam of any class they teach.
    const bank = await h.bank('teacher', { name: { ar: 'بنك شهادات' } });
    questionIds = [(await h.question('teacher', bank.id, trueFalseBody(TRUE_PROMPT, true, { points: 5 }))).id, (await h.question('teacher', bank.id, trueFalseBody(FALSE_PROMPT, false, { points: 5 }))).id];
  }, 120_000);

  afterAll(async () => {
    if (!h) return;
    // The progress rows hold the syllabus items (Restrict); the harness deletes the certificates, classes and courses.
    await h.prisma.learningProgress.deleteMany({ where: { courseId: { in: Object.values(h.courses) } } });
    await h.close();
  });

  it('AC1 — a manual exam: nothing until the results are published, then only a pass at or above the pass mark; a correction after publication counts', async () => {
    const classId = await courseClass('M', ['m1', 'm2', 'm3']);
    const exam = await h.prisma.exam.create({ data: { classId, title: { ar: 'الاختبار النهائي' }, type: 'final', status: 'scheduled', maxScore: 100, passScore: 50 }, select: { id: true } });
    for (const name of ['m1', 'm2', 'm3']) expect((await complete(name, 'M').expect(200)).body.certificate).toBeNull();

    await h
      .recordResults('teacher', exam.id, [
        { studentId: h.id('m1'), status: 'scored', score: 80 },
        { studentId: h.id('m2'), status: 'scored', score: 49.99 },
        { studentId: h.id('m3'), status: 'absent' },
      ])
      .expect(200);
    // Recorded, not published: the learners cannot see their result yet, so nobody is certified.
    for (const name of ['m1', 'm2', 'm3']) expect(await certificatesOf(name, 'M')).toHaveLength(0);

    await h.act('teacher', exam.id, 'publish').expect(200);
    expect(await certificatesOf('m1', 'M')).toEqual([{ id: expect.any(String), status: 'issued' }]);
    expect(await certificatesOf('m2', 'M')).toHaveLength(0);
    expect(await certificatesOf('m3', 'M')).toHaveLength(0);

    // The teacher corrects m2's mark to exactly the pass mark after publication.
    await h.recordResults('teacher', exam.id, [{ studentId: h.id('m2'), status: 'scored', score: 50 }]).expect(200);
    expect(await certificatesOf('m2', 'M')).toHaveLength(1);
    expect(await certificatesOf('m3', 'M')).toHaveLength(0);
  });

  it('AC2 — an online exam that releases on submit: a failed attempt issues nothing, a passing second attempt does at its submit', async () => {
    await courseClass('O', ['o1', 'o2']);
    const examId = await online('O', { resultsRelease: 'on_submit', attemptsAllowed: 2 });
    await complete('o1', 'O').expect(200);

    await takeExam('o1', examId, false);
    expect(await certificatesOf('o1', 'O')).toHaveLength(0);
    await takeExam('o1', examId, true);
    expect(await certificatesOf('o1', 'O')).toHaveLength(1);

    // Passing the exam before finishing the curriculum: the last lesson issues it.
    await takeExam('o2', examId, true);
    expect(await certificatesOf('o2', 'O')).toHaveLength(0);
    const last = await complete('o2', 'O').expect(200);
    expect(last.body.certificate).toEqual({ id: expect.any(String), serial: expect.any(String) });
  });

  it('AC3 — an online exam that releases on publication: a passing submit waits for the publication', async () => {
    await courseClass('P', ['p1']);
    const examId = await online('P', { resultsRelease: 'on_publish' });
    await complete('p1', 'P').expect(200);
    await takeExam('p1', examId, true);
    expect(await certificatesOf('p1', 'P')).toHaveLength(0);

    await h.closeWindow(examId);
    await h.act('teacher', examId, 'publish').expect(200);
    expect(await certificatesOf('p1', 'P')).toHaveLength(1);
  });

  it('AC4 — a passing attempt the learner never submitted is closed by the sweeper and issues the certificate', async () => {
    await courseClass('T', ['t1']);
    const examId = await online('T', { resultsRelease: 'on_submit' });
    await complete('t1', 'T').expect(200);
    const attemptId = await takeExam('t1', examId, true, false);
    expect(await certificatesOf('t1', 'T')).toHaveLength(0);

    await h.expireAttempt(attemptId, 30);
    expect(await grading.sweep(new Date(), { examIds: [examId] })).toBe(1);
    expect(await certificatesOf('t1', 'T')).toHaveLength(1);
  });
});
