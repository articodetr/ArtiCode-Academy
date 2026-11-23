// TEST-286 — MOD-09 phase 2, the three-role journey of an online exam through
// the API (WF-21 — roadmap §4r.10): a manager prepares the class, the teacher
// writes a question bank and an online exam and makes it available, the student
// takes it and hands it in, the server grades it, the teacher sees the attempt
// and the gradebook, the results are published, and the student and their
// guardian read the result — against the live development database. Skipped
// when no database is reachable.
//
// Fixtures come from the shared harness: a manager with a custom role, the
// system `teacher`, `student` and `guardian` roles, a second teacher with a
// class of their own and a student of that class. The course is a precondition
// of WF-05 and comes from Prisma; everything of WF-21 goes through HTTP. The
// one thing changed behind the API's back is the clock: the window is closed
// with `closeWindow()` because no test can wait a real hour.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { available, bootHarness, choiceBody, leakedKeys, pickAnswers, trueFalseBody } from './online-exams.helpers.js';
import type { AttemptQuestionBody, Harness } from './online-exams.helpers.js';

const CLASSES = '/api/classes';

describe.skipIf(!available)('MOD-09 phase 2 — the journey of an online exam: manager, teacher, student (e2e, TEST-286 — WF-21)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootHarness('TEST-286');
    const teacher = await h.systemRole('teacher');
    const student = await h.systemRole('student');
    await h.createUser('manager', [await h.createRole('jmanager', ['courses.read', 'classes.read', 'classes.manage', 'classes.teachers.assign', 'enrollments.read', 'enrollments.manage', 'users.read'])]);
    await h.createUser('teacher', [teacher]);
    await h.createUser('teacherB', [teacher]);
    await h.createUser('student', [student]);
    await h.createUser('outsider', [student]);
    await h.createUser('guardian', [await h.systemRole('guardian')]);
    await h.linkGuardian('guardian', 'student');
    // Preconditions from other journeys: a published course (WF-05), and another teacher's class with its own student.
    await h.course('CJ');
    await h.klass('B', 'CJ', ['teacherB']);
    await h.enroll('B', 'outsider');
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  });

  it('a class is prepared, a bank and an online exam are written and made available, the student takes it once, the server grades it, and the result reaches the gradebook and — once published — the student and their guardian', async () => {
    const { api, as, id } = h;

    // ── 1. The manager: the class, its lead teacher, opening it, the enrollment (WF-03/WF-04) ──
    const classId = (await api().post(CLASSES).set(as('manager')).send({ courseId: h.courses['CJ'], code: h.code('J'), name: { ar: 'فصل رحلة الاختبار الإلكتروني' }, capacity: 5 }).expect(201)).body.id as string;
    h.classes['J'] = classId;
    await api().put(`${CLASSES}/${classId}/teachers`).set(as('manager')).send({ teachers: [{ userId: id('teacher'), role: 'lead' }] }).expect(200);
    await api().post(`${CLASSES}/${classId}/status`).set(as('manager')).send({ action: 'open' }).expect(200);
    await api().post(`${CLASSES}/${classId}/enrollments`).set(as('manager')).send({ studentId: id('student') }).expect(201);
    // Before the journey the student has no exam.
    expect((await h.myExams('student', `?classId=${classId}`).expect(200)).body).toEqual({ items: [], nextCursor: null });

    // ── 2. The teacher: a bank under the course and five objective questions, two points each ──
    const bank = await h.bank('teacher', { name: { ar: 'بنك أساسيات Python', en: 'Python basics bank' }, courseId: h.courses['CJ'] });
    const questions = [
      await h.question('teacher', bank.id, choiceBody('ما ناتج print(2 + 3)؟', ['4', '5', '6', '23'], 1, { points: 2, explanation: { ar: 'عملية جمع: 2 + 3 = 5' } })),
      await h.question('teacher', bank.id, choiceBody('أي الكلمات تعرّف دالة؟', ['def', 'func', 'lambda'], 0, { points: 2 })),
      await h.question('teacher', bank.id, choiceBody('ما نوع القيمة 3.14؟', ['int', 'float', 'str'], 1, { points: 2 })),
      await h.question('teacher', bank.id, choiceBody('أي رمز يبدأ تعليقاً؟', ['//', '#', '--', '/*'], 1, { points: 2 })),
      await h.question('teacher', bank.id, trueFalseBody('القوائم في Python غير قابلة للتعديل.', false, { points: 2 })),
    ];
    expect((await api().get(`${h.BANKS}/${bank.id}`).set(as('teacher')).expect(200)).body).toMatchObject({ questionCount: 5, readyCount: 5, course: { id: h.courses['CJ'] } });
    // The manager of the class holds no `questions.manage`: the bank is the teachers'.
    expect((await api().get(`${h.BANKS}/${bank.id}`).set(as('manager'))).body).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['questions.manage'] });

    // ── 3. An exam out of 10: created the old way, turned online in the draft, its five questions linked ──
    const m = await h.mark();
    const created = await h.createExam('teacher', 'J', { title: { ar: 'اختبار قصير: أساسيات Python', en: 'Quiz: Python basics' }, type: 'quiz', maxScore: 10, passScore: 6, weight: 1 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const examId = created.body.id as string;
    expect(created.body).toMatchObject({ status: 'draft', delivery: 'manual', online: null });
    const online = await h.patchExam('teacher', examId, { delivery: 'online', revealAnswers: true });
    expect(online.status, JSON.stringify(online.body)).toBe(200);
    expect(online.body).toMatchObject({ delivery: 'online', attemptsAllowed: 1, resultsRelease: 'on_publish', revealAnswers: true, online: { questionCount: 0, frozen: false } });
    const linked = await h.link('teacher', examId, questions.map((question) => ({ questionId: question.id })));
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body).toMatchObject({ editable: true, frozen: false, totalPoints: 10, maxScore: 10 });

    // ── 4. Making it available: refused without its window, then scheduled — and its questions frozen ──
    expect((await h.act('teacher', examId, 'schedule')).body).toMatchObject({ statusCode: 409, code: 'exam_not_ready', problems: ['window_missing', 'duration_missing'], totalPoints: 10, maxScore: 10 });
    expect((await h.patchExam('teacher', examId, h.openWindow())).status).toBe(200);
    const scheduled = await h.act('teacher', examId, 'schedule');
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(200);
    expect(scheduled.body).toMatchObject({ status: 'scheduled', online: { questionCount: 5, totalPoints: 10, frozen: true, problems: [], attempts: { students: 0, inProgress: 0, finished: 0 } } });
    // The teacher corrects a typo in the bank afterwards and even flips a key there: this exam keeps its frozen copy.
    await api()
      .patch(`${h.QUESTIONS}/${questions[1]!.id}`)
      .set(as('teacher'))
      .send({ options: ['def', 'func', 'lambda'].map((text, index) => ({ text: { ar: text }, isCorrect: index === 2 })) })
      .expect(200);

    // ── 5. The student: «my exams», then «start» ──
    const before = (await h.myExams('student', `?classId=${classId}`).expect(200)).body.items;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ id: examId, status: 'scheduled', delivery: 'online', relation: 'self', result: null, online: { attemptsAllowed: 1, attemptsUsed: 0, questionCount: 5, canStart: true, blocker: null, inProgress: null, attempts: [] } });
    // Their guardian sees the exam and may not take it.
    expect((await h.myExams('guardian').expect(200)).body.items[0]).toMatchObject({ id: examId, relation: 'child', online: { canStart: false, blocker: 'not_self' } });
    expect((await h.startAttempt('guardian', examId)).body).toMatchObject({ statusCode: 403, code: 'permission_denied' });

    const started = await h.startAttempt('student', examId, { attemptNo: 1 });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const attemptId = started.body.id as string;
    expect(started.body).toMatchObject({ attemptNo: 1, status: 'in_progress', questionCount: 5, answeredCount: 0, result: null });
    expect(started.body.remainingSeconds).toBeGreaterThan(1790);
    const asked = started.body.questions as AttemptQuestionBody[];
    expect(asked.map((question) => question.prompt.ar)).toEqual(['ما ناتج print(2 + 3)؟', 'أي الكلمات تعرّف دالة؟', 'ما نوع القيمة 3.14؟', 'أي رمز يبدأ تعليقاً؟', 'القوائم في Python غير قابلة للتعديل.']);
    // Five questions, and nothing a key could travel under.
    expect(leakedKeys(started.body)).toEqual([]);

    // ── 6. Three right and two wrong, with a break in the middle ──
    // Right: 1 (5), 2 (def — the frozen key, not the bank's edited one), 3 (float). Wrong: 4 (//), 5 (true).
    const picks = [1, 0, 1, 0, true] as const;
    await h.saveAnswers('student', attemptId, pickAnswers(asked, [picks[0], picks[1], picks[2], null, null])).expect(200);
    // The student closes the page and comes back: the same attempt, its saved answers, the server's remaining time.
    const resumed = await h.startAttempt('student', examId);
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ id: attemptId, status: 'in_progress', answeredCount: 3 });
    expect((resumed.body.questions as AttemptQuestionBody[]).map((question) => question.answer !== null)).toEqual([true, true, true, false, false]);
    expect(resumed.body.remainingSeconds).toBeGreaterThan(1700);
    await h.saveAnswers('student', attemptId, pickAnswers(asked, [null, null, null, picks[3], picks[4]])).expect(200);

    // ── 7. The submit, and a second one ──
    const submitted = await h.submitAttempt('student', attemptId);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body).toMatchObject({ status: 'submitted', answeredCount: 5 });
    const again = await h.submitAttempt('student', attemptId).expect(200);
    expect(again.body).toMatchObject({ status: 'submitted', submittedAt: submitted.body.submittedAt });
    expect((await h.startAttempt('student', examId)).body).toMatchObject({ statusCode: 409, code: 'attempts_exhausted', attemptsAllowed: 1, attempts: 1 });

    // ── 8. Before the results are published the student reads no score and no key ──
    for (const body of [submitted.body, again.body, (await h.readAttempt('student', attemptId).expect(200)).body]) {
      expect(body).toMatchObject({ resultReleased: false, reviewReleased: false, result: null });
      expect(leakedKeys(body)).toEqual([]);
    }
    const waiting = (await h.myExams('student', `?classId=${classId}`).expect(200)).body.items[0];
    expect(waiting).toMatchObject({ status: 'scheduled', result: null, online: { attemptsUsed: 1, canStart: false, blocker: 'attempts_exhausted' } });
    expect(waiting.online.attempts).toEqual([expect.objectContaining({ id: attemptId, attemptNo: 1, status: 'submitted', score: null })]);

    // ── 9. The teacher: the attempt, graded by the server, and the class gradebook ──
    const roster = (await h.attemptsOf('teacher', examId).expect(200)).body;
    expect(roster.stats).toEqual({ students: 1, started: 1, inProgress: 0, finished: 1, notStarted: 0, mean: 6, highest: 6, lowest: 6, passed: 1, failed: 0, passRate: 100 });
    expect(roster.items[0]).toMatchObject({ student: { id: id('student') }, result: { status: 'scored', score: 6, source: 'online' }, attempts: [{ id: attemptId, status: 'submitted', score: 6, correctCount: 3, counted: true }] });
    const detail = (await h.attemptDetail('teacher', attemptId).expect(200)).body;
    expect(detail).toMatchObject({ score: 6, maxScore: 10, correctCount: 3, questionCount: 5, counted: true });
    expect(detail.questions.map((question: { isCorrect: boolean; pointsAwarded: number }) => [question.isCorrect, question.pointsAwarded])).toEqual([[true, 2], [true, 2], [true, 2], [false, 0], [false, 0]]);
    const book = (await api().get(`${CLASSES}/${classId}/gradebook`).set(as('teacher')).expect(200)).body;
    expect(book.components).toEqual([expect.objectContaining({ kind: 'exam', id: examId, weight: 1, maxScore: 10 })]);
    expect(book.students[0]).toMatchObject({ student: { id: id('student') }, cells: [{ kind: 'exam', id: examId, status: 'scored', score: 6 }], current: 60 });
    expect((await h.resultsSheet('teacher', examId).expect(200)).body).toMatchObject({ delivery: 'online', counts: { students: 1, scored: 1, absent: 0, excused: 0 } });

    // ── 11. Nobody else: a student of another class, and the teacher of another class ──
    expect((await h.startAttempt('outsider', examId)).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    expect((await h.readAttempt('outsider', attemptId)).body).toMatchObject({ statusCode: 404, code: 'attempt_not_found' });
    expect((await h.myExams('outsider').expect(200)).body.items).toEqual([]);
    // One request at a time: supertest shares the server between the requests it builds.
    for (const read of [() => h.attemptsOf('teacherB', examId), () => h.readQuestions('teacherB', examId), () => h.readExam('teacherB', examId)]) {
      expect((await read()).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    }
    expect((await h.attemptDetail('teacherB', attemptId)).body).toMatchObject({ statusCode: 404, code: 'attempt_not_found' });
    // The student holds `exams.read` and still gets nothing from the teacher's routes — not even their own attempt with its key.
    expect((await h.attemptDetail('student', attemptId)).body).toMatchObject({ statusCode: 404, code: 'attempt_not_found' });
    expect((await h.readQuestions('student', examId)).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });

    // ── 10. Publishing: only once the window has closed; then the student and the guardian read the result ──
    expect((await h.act('teacher', examId, 'publish')).body).toMatchObject({ statusCode: 409, code: 'exam_window_open' });
    await h.closeWindow(examId, 60);
    expect((await h.act('teacher', examId, 'publish')).body).toMatchObject({ status: 'published' });

    const released = (await h.readAttempt('student', attemptId).expect(200)).body;
    expect(released).toMatchObject({ status: 'submitted', resultReleased: true, reviewReleased: true });
    expect(released.result).toEqual({ score: 6, maxScore: 10, correctCount: 3, questionCount: 5, isPass: true, counted: true });
    // The exam reveals its answers: the review carries the key of the frozen copy — «def», whatever the bank says now.
    const review = (released.questions as AttemptQuestionBody[]).map((question) => question.review!);
    expect(review.map((entry) => [entry.isCorrect, entry.pointsAwarded])).toEqual([[true, 2], [true, 2], [true, 2], [false, 0], [false, 0]]);
    expect(review[0]).toMatchObject({ correctOptionId: asked[0]!.options[1]!.id, explanation: { ar: 'عملية جمع: 2 + 3 = 5' } });
    expect(review[1]).toMatchObject({ correctOptionId: asked[1]!.options[0]!.id });
    expect(review[4]).toMatchObject({ correctOptionId: null, correctAnswer: false });

    const mine = (await h.myExams('student', `?classId=${classId}`).expect(200)).body.items[0];
    expect(mine).toMatchObject({ status: 'published', result: { status: 'scored', score: 6, feedback: null }, online: { canStart: false, blocker: 'results_published' } });
    expect(mine.online.attempts).toEqual([expect.objectContaining({ id: attemptId, status: 'submitted', score: 6 })]);
    expect((await h.myExams('guardian').expect(200)).body.items[0]).toMatchObject({ relation: 'child', status: 'published', result: { status: 'scored', score: 6 }, online: { blocker: 'not_self' } });
    const grades = (await api().get(`/api/me/grades?classId=${classId}`).set(as('student')).expect(200)).body.items;
    expect(grades[0].components).toEqual([expect.objectContaining({ kind: 'exam', id: examId, status: 'scored', score: 6, maxScore: 10 })]);

    // ── The audit trail of the exam and of the attempt, in order: one event per write, none for a refusal, a read or a save ──
    const events = await h.eventsOn(m, [examId, attemptId]);
    expect(events.map((event) => [event.action, event.entityType, event.actorUserId])).toEqual([
      ['exams.created', 'exams', id('teacher')],
      ['exams.updated', 'exams', id('teacher')],
      ['exams.questions.changed', 'exams', id('teacher')],
      ['exams.updated', 'exams', id('teacher')],
      ['exams.status.changed', 'exams', id('teacher')],
      ['exams.attempt.started', 'exam_attempts', id('student')],
      ['exams.attempt.submitted', 'exam_attempts', id('student')],
      ['exams.status.changed', 'exams', id('teacher')],
    ]);
    expect(events[6]!.metadata).toEqual({ examId, classId, studentId: id('student'), attemptNo: 1, score: 6, maxScore: 10, correctCount: 3, questionCount: 5, counted: true });
    // Nothing in the trail names an option or a key.
    const trail = JSON.stringify(events);
    for (const question of asked) for (const option of question.options) expect(trail.includes(option.id)).toBe(false);

    // ── 12. A manual exam of the same class goes its old way, beside the online one ──
    const manual = await h.createExam('teacher', 'J', { title: { ar: 'اختبار شفهي' }, type: 'oral', maxScore: 20 });
    expect(manual.body).toMatchObject({ delivery: 'manual', online: null, attemptsAllowed: 1, closesAt: null });
    const manualId = manual.body.id as string;
    expect((await h.act('teacher', manualId, 'schedule')).body).toMatchObject({ status: 'scheduled' });
    const sheet = await h.recordResults('teacher', manualId, [{ studentId: id('student'), status: 'scored', score: 17, feedback: 'أداء جيد' }]);
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(200);
    expect(sheet.body).toMatchObject({ delivery: 'manual', items: [{ attemptCount: 0, result: { status: 'scored', score: 17, source: 'manual', recordedBy: { userId: id('teacher') } } }] });
    expect((await h.act('teacher', manualId, 'publish')).body).toMatchObject({ status: 'published' });
    expect((await h.startAttempt('student', manualId)).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    expect((await h.attemptsOf('teacher', manualId).expect(200)).body).toMatchObject({ questionCount: 0, stats: { students: 1, started: 0, finished: 0 } });
    const both = (await h.myExams('student', `?classId=${classId}`).expect(200)).body.items as { id: string; delivery: string; online: unknown; result: { score: number } | null }[];
    expect(both.find((item) => item.id === manualId)).toMatchObject({ delivery: 'manual', online: null, result: { score: 17, feedback: 'أداء جيد' } });
    expect(both.find((item) => item.id === examId)).toMatchObject({ delivery: 'online', result: { score: 6 } });
  }, 120_000);
});
