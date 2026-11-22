// TEST-284 — MOD-09 phase 2, the grading of online attempts and what reads its
// result: the counted result in `exam_results` (D-R153, D-R160), the manual
// results sheet beside it, the sweeper of overdue attempts (D-R154), the
// publication of the results, the gradebook, the final grades and «my grades» —
// against the live development database. Skipped when no database is
// reachable. Fixtures come from the shared harness (a teacher with the system
// `teacher` role on two classes, students with the system `student` role) and
// are deleted at the end. The sweeper is always narrowed to this suite's own
// exams: the database may be shared with other suites.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExamGradingService } from '../src/exams/exam-grading.service.js';
import { available, bootHarness, choiceBody, leakedKeys, pickAnswers, trueFalseBody } from './online-exams.helpers.js';
import type { AttemptQuestionBody, Harness } from './online-exams.helpers.js';

interface AttemptBody {
  id: string;
  attemptNo: number;
  status: string;
  questions: AttemptQuestionBody[];
  resultReleased: boolean;
  reviewReleased: boolean;
  result: { score: number; maxScore: number; correctCount: number; questionCount: number; isPass: boolean | null; counted: boolean } | null;
}

interface SheetItem {
  student: { id: string };
  enrollmentStatus: string | null;
  result: { status: string; score: number | null; feedback: string | null; source: string; recordedBy: { userId: string } | null } | null;
  attemptCount: number;
}

interface SheetBody {
  examId: string;
  examStatus: string;
  delivery: string;
  maxScore: number;
  recordable: boolean;
  counts: { students: number; scored: number; absent: number; excused: number };
  items: SheetItem[];
}

interface GradebookBody {
  components: { kind: string; id: string; weight: number | null; maxScore: number; status: string; counted: boolean }[];
  students: {
    student: { id: string };
    cells: { kind: string; id: string; status: string; score: number | null; effectiveScore: number | null }[];
    current: number | null;
    projected: number | null;
    final: { percent: number; isPass: boolean; stale: boolean } | null;
  }[];
  readiness: { openAssignments: number; awaitingReview: number; unpublishedExams: number; weightedComponents: number; ready: boolean };
}

const THREE_OF_FIVE = [1, 0, true, true, 0] as const;
const ALL_RIGHT = [1, 0, true, false, 1] as const;

describe.skipIf(!available)('MOD-09 phase 2 — auto-grading and the counted result (e2e, TEST-284)', () => {
  let h: Harness;
  let grading: ExamGradingService;
  const exams: Record<string, string> = {};
  const q: string[] = [];
  let five: { questionId: string }[] = [];

  beforeAll(async () => {
    h = await bootHarness('TEST-284');
    grading = h.app.get(ExamGradingService);
    await h.createUser('teacher', [await h.systemRole('teacher')]);
    const student = await h.systemRole('student');
    for (const name of ['s1', 's2', 's3', 's4', 'outsider']) await h.createUser(name, [student]);
    await h.course('CA');
    // G is running, so its grades can be fixed; its one exam is the whole gradebook.
    await h.klass('G', 'CA', ['teacher'], 'running');
    await h.klass('A', 'CA', ['teacher']);
    for (const name of ['s1', 's2', 's3', 's4']) await h.enroll('G', name);
    for (const name of ['s1', 's2', 's3']) await h.enroll('A', name);

    const bank = (await h.bank('teacher', { name: { ar: 'بنك أساسيات Python' }, courseId: h.courses['CA'] })).id;
    const created = [
      await h.question('teacher', bank, choiceBody('ما ناتج print(2 + 3)؟', ['4', '5', '6', '23'], 1, { points: 2 })),
      await h.question('teacher', bank, choiceBody('أي الكلمات تعرّف دالة؟', ['def', 'func', 'lambda'], 0, { points: 2 })),
      await h.question('teacher', bank, trueFalseBody('يمكن استخدام Python لتطوير تطبيقات الويب.', true, { points: 2 })),
      await h.question('teacher', bank, trueFalseBody('القوائم في Python غير قابلة للتعديل.', false, { points: 2 })),
      await h.question('teacher', bank, choiceBody('ما نوع القيمة 3.14؟', ['int', 'float', 'str'], 1, { points: 2 })),
    ];
    for (const question of created) q.push(question.id);
    five = q.map((questionId) => ({ questionId }));

    exams['graded'] = await h.onlineExam('teacher', 'G', five, { weight: 1, passScore: 5 });
    exams['multi'] = await h.onlineExam('teacher', 'A', five, { attemptsAllowed: 3, resultsRelease: 'on_submit' });
    exams['swept'] = await h.onlineExam('teacher', 'A', five);
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  });

  /** Starts an attempt, saves these picks and submits; returns the finished attempt as its learner sees it. */
  async function take(user: string, examName: string, picks: readonly (number | boolean | null)[]): Promise<AttemptBody> {
    const started = await h.startAttempt(user, exams[examName]!);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const answers = pickAnswers((started.body as AttemptBody).questions, picks);
    if (answers.length > 0) await h.saveAnswers(user, started.body.id as string, answers).expect(200);
    return (await h.submitAttempt(user, started.body.id as string).expect(200)).body as AttemptBody;
  }

  const sheetOf = async (examName: string) => (await h.resultsSheet('teacher', exams[examName]!).expect(200)).body as SheetBody;
  const itemOf = (sheet: SheetBody, user: string) => sheet.items.find((item) => item.student.id === h.id(user))!;
  const gradebook = async () => (await h.api().get(`/api/classes/${h.classes['G']}/gradebook`).set(h.as('teacher')).expect(200)).body as GradebookBody;
  const studentOf = (book: GradebookBody, user: string) => book.students.find((entry) => entry.student.id === h.id(user))!;
  const resultRow = async (examName: string, user: string) => {
    const row = await h.prisma.examResult.findUnique({
      where: { examId_studentUserId: { examId: exams[examName]!, studentUserId: h.id(user) } },
      select: { status: true, score: true, source: true, feedback: true, recordedById: true, updatedAt: true },
    });
    return row === null ? null : { status: row.status, score: row.score === null ? null : Number(row.score), source: row.source, feedback: row.feedback, recordedById: row.recordedById, updatedAt: row.updatedAt.toISOString() };
  };

  it('AC1 — the server grades from the frozen questions and writes each student’s counted result where the sheet, the exam and the gradebook read it', async () => {
    // The teacher changes the key of the first question in the bank AFTER the exam was made available: the exam keeps its frozen copy (D-R158).
    const edited = await h
      .api()
      .patch(`${h.QUESTIONS}/${q[0]}`)
      .set(h.as('teacher'))
      .send({ options: ['4', '5', '6', '23'].map((text, index) => ({ text: { ar: text }, isCorrect: index === 3 })) });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);

    const s1 = await take('s1', 'graded', THREE_OF_FIVE);
    const s2 = await take('s2', 'graded', ALL_RIGHT);
    const s3 = await take('s3', 'graded', [null, null, null, null, null]);
    // Graded at once — and nothing shown: this exam waits for the teacher to publish (D-R156).
    for (const attempt of [s1, s2, s3]) {
      expect(attempt).toMatchObject({ status: 'submitted', resultReleased: false, reviewReleased: false, result: null });
      expect(leakedKeys(attempt)).toEqual([]);
    }

    // The counted results, as rows the first phase already knows how to read.
    expect(await resultRow('graded', 's1')).toMatchObject({ status: 'scored', score: 6, source: 'online', feedback: null, recordedById: null });
    expect(await resultRow('graded', 's2')).toMatchObject({ status: 'scored', score: 10, source: 'online' });
    expect(await resultRow('graded', 's3')).toMatchObject({ status: 'scored', score: 0, source: 'online' });
    expect(await resultRow('graded', 's4')).toBeNull();
    const attempts = await h.prisma.examAttempt.findMany({ where: { examId: exams['graded']! }, orderBy: { score: 'asc' }, select: { score: true, correctCount: true, maxScore: true, questionCount: true, status: true } });
    expect(attempts.map((attempt) => [Number(attempt.score), attempt.correctCount, Number(attempt.maxScore), attempt.questionCount, attempt.status])).toEqual([
      [0, 0, 10, 5, 'submitted'],
      [6, 3, 10, 5, 'submitted'],
      [10, 5, 10, 5, 'submitted'],
    ]);

    // The teacher's results sheet shows them with their source.
    const sheet = await sheetOf('graded');
    expect(sheet).toMatchObject({ delivery: 'online', examStatus: 'scheduled', maxScore: 10, recordable: true, counts: { students: 3, scored: 3, absent: 0, excused: 0 } });
    expect(itemOf(sheet, 's1')).toMatchObject({ enrollmentStatus: 'active', attemptCount: 1, result: { status: 'scored', score: 6, source: 'online', feedback: null, recordedBy: null } });
    expect(itemOf(sheet, 's4')).toMatchObject({ attemptCount: 0, result: null });
    // The exam's own counters.
    expect((await h.readExam('teacher', exams['graded']!).expect(200)).body).toMatchObject({
      results: { students: 3, scored: 3, absent: 0, excused: 0 },
      online: { questionCount: 5, totalPoints: 10, frozen: true, attempts: { students: 3, inProgress: 0, finished: 3 } },
    });

    // The gradebook reads the same rows: no second source of truth.
    const book = await gradebook();
    expect(book.components).toEqual([expect.objectContaining({ kind: 'exam', id: exams['graded'], weight: 1, maxScore: 10, counted: true })]);
    expect(studentOf(book, 's1')).toMatchObject({ cells: [{ kind: 'exam', id: exams['graded'], status: 'scored', score: 6, effectiveScore: 6 }], current: 60, projected: 60, final: null });
    expect(studentOf(book, 's2')).toMatchObject({ cells: [{ status: 'scored', score: 10 }], current: 100, projected: 100 });
    expect(studentOf(book, 's3')).toMatchObject({ cells: [{ status: 'scored', score: 0 }], current: 0, projected: 0 });
    expect(studentOf(book, 's4')).toMatchObject({ cells: [{ status: 'missing', score: null }], projected: 0 });
    expect(book.readiness).toMatchObject({ unpublishedExams: 1, ready: false });
  });

  it('AC2 — the manual sheet still records the students who did not take the exam, and never types over an attempt', async () => {
    const m = await h.mark();
    // A batch naming a student who has an attempt is refused whole.
    const refused = await h.recordResults('teacher', exams['graded']!, [
      { studentId: h.id('s4'), status: 'absent' },
      { studentId: h.id('s1'), status: 'scored', score: 9 },
    ]);
    expect(refused.body).toMatchObject({ statusCode: 409, code: 'result_from_attempt', studentIds: [h.id('s1')] });
    expect(await resultRow('graded', 's4')).toBeNull();
    expect(await resultRow('graded', 's1')).toMatchObject({ score: 6, source: 'online' });
    // A student who is not enrolled is still the first refusal.
    expect((await h.recordResults('teacher', exams['graded']!, [{ studentId: h.id('outsider'), status: 'absent' }, { studentId: h.id('s1'), status: 'excused' }])).body).toMatchObject({
      statusCode: 422,
      code: 'not_enrolled',
      studentIds: [h.id('outsider')],
    });
    expect(await h.eventsSince(m)).toEqual([]);

    // The absent student is recorded exactly as on a manual exam.
    const recorded = await h.recordResults('teacher', exams['graded']!, [{ studentId: h.id('s4'), status: 'absent', feedback: 'لم يحضر' }]);
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    const sheet = recorded.body as SheetBody;
    expect(sheet.counts).toEqual({ students: 4, scored: 3, absent: 1, excused: 0 });
    expect(itemOf(sheet, 's4')).toMatchObject({ attemptCount: 0, result: { status: 'absent', score: null, source: 'manual', feedback: 'لم يحضر', recordedBy: { userId: h.id('teacher') } } });
    expect((await h.eventsSince(m)).map((event) => event.action)).toEqual(['exams.results.recorded']);
    expect(studentOf(await gradebook(), 's4')).toMatchObject({ cells: [{ status: 'absent' }], current: 0, projected: 0 });

    // The window is still open and they take it after all: what they did replaces the manual entry (D-R160).
    const late = await take('s4', 'graded', [1, 0, null, null, null]);
    expect(late).toMatchObject({ status: 'submitted', result: null });
    expect(await resultRow('graded', 's4')).toMatchObject({ status: 'scored', score: 4, source: 'online', feedback: null, recordedById: null });
    const after = await sheetOf('graded');
    expect(after.counts).toEqual({ students: 4, scored: 4, absent: 0, excused: 0 });
    expect(itemOf(after, 's4')).toMatchObject({ attemptCount: 1, result: { status: 'scored', score: 4, source: 'online', recordedBy: null } });
    // …and from now on the sheet leaves them alone too.
    expect((await h.recordResults('teacher', exams['graded']!, [{ studentId: h.id('s4'), status: 'excused' }])).body).toMatchObject({ statusCode: 409, code: 'result_from_attempt', studentIds: [h.id('s4')] });
  });

  it('AC3 — with several attempts the highest finished one counts, the earliest on a tie, and the result row is rewritten only when it changes', async () => {
    const m = await h.mark();
    const first = await take('s1', 'multi', [1, 0, true, false, 0]);
    expect(first.result).toEqual({ score: 8, maxScore: 10, correctCount: 4, questionCount: 5, isPass: null, counted: true });
    const afterFirst = await resultRow('multi', 's1');
    expect(afterFirst).toMatchObject({ score: 8, source: 'online' });

    // A weaker second attempt changes nothing: the row is not even rewritten, so a final grade fixed earlier would not turn stale.
    const second = await take('s1', 'multi', [1, 0, null, null, null]);
    expect(second.result).toMatchObject({ score: 4, counted: false });
    expect(await resultRow('multi', 's1')).toEqual(afterFirst);

    // A better third attempt takes over.
    const third = await take('s1', 'multi', ALL_RIGHT);
    expect(third.result).toMatchObject({ score: 10, correctCount: 5, counted: true });
    const afterThird = await resultRow('multi', 's1');
    expect(afterThird).toMatchObject({ score: 10, source: 'online' });
    expect(Date.parse(afterThird!.updatedAt)).toBeGreaterThan(Date.parse(afterFirst!.updatedAt));
    expect(((await h.readAttempt('s1', first.id).expect(200)).body as AttemptBody).result).toMatchObject({ score: 8, counted: false });
    expect((await h.startAttempt('s1', exams['multi']!)).body).toMatchObject({ statusCode: 409, code: 'attempts_exhausted', attemptsAllowed: 3, attempts: 3 });

    const submitted = (await h.eventsOn(m, [first.id, second.id, third.id])).filter((event) => event.action === 'exams.attempt.submitted');
    expect(submitted.map((event) => (event.metadata as { attemptNo: number; score: number; counted: boolean }).counted)).toEqual([true, false, true]);
    expect(submitted.map((event) => (event.metadata as { score: number }).score)).toEqual([8, 4, 10]);

    // A tie: the earlier attempt keeps counting.
    const tieOne = await take('s2', 'multi', THREE_OF_FIVE);
    const tieRow = await resultRow('multi', 's2');
    // Another three right answers — different questions, the same score.
    const tieTwo = await take('s2', 'multi', [0, 0, true, false, 0]);
    expect([tieOne.result!.score, tieTwo.result!.score]).toEqual([6, 6]);
    expect(tieTwo.result).toMatchObject({ counted: false });
    expect(((await h.readAttempt('s2', tieOne.id).expect(200)).body as AttemptBody).result).toMatchObject({ counted: true });
    expect(await resultRow('multi', 's2')).toEqual(tieRow);
  });

  it('AC4 — the sweeper closes the attempts whose time is over with what was saved, once, and leaves the others alone', async () => {
    const one = (await h.startAttempt('s1', exams['swept']!).expect(201)).body as AttemptBody;
    const two = (await h.startAttempt('s2', exams['swept']!).expect(201)).body as AttemptBody;
    const three = (await h.startAttempt('s3', exams['swept']!).expect(201)).body as AttemptBody;
    await h.saveAnswers('s1', one.id, pickAnswers(one.questions, [1, 0, true, null, null])).expect(200);
    await h.saveAnswers('s3', three.id, pickAnswers(three.questions, ALL_RIGHT)).expect(200);

    // Nothing is over yet.
    const only = { examIds: [exams['swept']!] };
    expect(await grading.sweep(new Date(), only)).toBe(0);

    // Two of them ran out half a minute ago and their learners never came back; the third is still running.
    await h.expireAttempt(one.id, 30);
    await h.expireAttempt(two.id, 30);
    const m = await h.mark();
    expect(await grading.sweep(new Date(), only)).toBe(2);

    const rows = await h.prisma.examAttempt.findMany({ where: { id: { in: [one.id, two.id, three.id] } }, select: { id: true, status: true, score: true, correctCount: true, submittedAt: true, expiresAt: true, gradedAt: true } });
    const row = (id: string) => rows.find((entry) => entry.id === id)!;
    expect([row(one.id).status, Number(row(one.id).score), row(one.id).correctCount]).toEqual(['timed_out', 6, 3]);
    expect([row(two.id).status, Number(row(two.id).score), row(two.id).correctCount]).toEqual(['timed_out', 0, 0]);
    // The close is dated at the deadline; the grading at the moment the server did it.
    expect(row(one.id).submittedAt).toEqual(row(one.id).expiresAt);
    expect(row(one.id).gradedAt!.getTime()).toBeGreaterThan(row(one.id).expiresAt.getTime());
    expect(row(three.id)).toMatchObject({ status: 'in_progress', score: null, submittedAt: null });
    expect(await resultRow('swept', 's1')).toMatchObject({ status: 'scored', score: 6, source: 'online' });
    expect(await resultRow('swept', 's2')).toMatchObject({ status: 'scored', score: 0, source: 'online' });
    expect(await resultRow('swept', 's3')).toBeNull();

    // One event per closed attempt, by nobody: the server did it.
    const events = await h.eventsOn(m, [one.id, two.id, three.id]);
    expect(events.map((event) => [event.action, event.actorUserId, event.entityType]).sort()).toEqual([
      ['exams.attempt.timed_out', null, 'exam_attempts'],
      ['exams.attempt.timed_out', null, 'exam_attempts'],
    ]);
    expect(events.find((event) => event.entityId === one.id)!.metadata).toEqual({
      examId: exams['swept'],
      classId: h.classes['A'],
      studentId: h.id('s1'),
      attemptNo: 1,
      score: 6,
      maxScore: 10,
      correctCount: 3,
      questionCount: 5,
      counted: true,
    });
    // Nothing left to do: a second sweep closes nothing and records nothing.
    expect(await grading.sweep(new Date(), only)).toBe(0);
    expect((await h.eventsOn(m, [one.id, two.id, three.id])).length).toBe(2);

    // One second past its deadline the third is still inside the network allowance: a last save may be on its way.
    await h.expireAttempt(three.id, 1);
    expect(await grading.sweep(new Date(), only)).toBe(0);
    // Once the allowance has passed too, it is closed with its five right answers.
    await h.expireAttempt(three.id, 30);
    expect(await grading.sweep(new Date(), only)).toBe(1);
    expect(await resultRow('swept', 's3')).toMatchObject({ score: 10, source: 'online' });
    // The learner comes back to a finished attempt, still without a result: the teacher has not published.
    expect((await h.readAttempt('s3', three.id).expect(200)).body).toMatchObject({ status: 'timed_out', resultReleased: false, result: null });
    expect((await h.saveAnswers('s3', three.id, pickAnswers(three.questions, [0, null, null, null, null]))).body).toMatchObject({ statusCode: 409, code: 'attempt_closed', status: 'timed_out' });
  });

  it('AC5 — publishing releases the results to the learners and tells them; unpublishing hides them again', async () => {
    const mine = (await h.myExams('s1', `?classId=${h.classes['G']}`).expect(200)).body.items as { id: string; status: string; result: unknown; online: { attempts: { id: string; score: number | null }[] } }[];
    expect(mine[0]).toMatchObject({ id: exams['graded'], status: 'scheduled', result: null });
    expect(mine[0]!.online.attempts.map((attempt) => attempt.score)).toEqual([null]);
    const attemptId = mine[0]!.online.attempts[0]!.id;
    const before = await h.prisma.notification.count({ where: { recipientUserId: h.id('s1'), eventKey: 'exam.results_published' } });

    await h.closeWindow(exams['graded']!, 60);
    expect((await h.act('teacher', exams['graded']!, 'publish')).body).toMatchObject({ status: 'published' });
    const released = (await h.readAttempt('s1', attemptId).expect(200)).body as AttemptBody;
    expect(released).toMatchObject({ resultReleased: true, reviewReleased: false });
    expect(released.result).toEqual({ score: 6, maxScore: 10, correctCount: 3, questionCount: 5, isPass: true, counted: true });
    // The exam does not reveal its answers: the score, never the key.
    expect(leakedKeys(released)).toEqual([]);
    const published = (await h.myExams('s1', `?classId=${h.classes['G']}`).expect(200)).body.items as { status: string; result: unknown; online: { attempts: { score: number | null }[]; blocker: string } }[];
    expect(published[0]).toMatchObject({ status: 'published', result: { status: 'scored', score: 6, feedback: null }, online: { blocker: 'results_published' } });
    expect(published[0]!.online.attempts.map((attempt) => attempt.score)).toEqual([6]);
    // The first phase's notification, one per result.
    expect(await h.prisma.notification.count({ where: { recipientUserId: h.id('s1'), eventKey: 'exam.results_published' } })).toBe(before + 1);
    expect((await gradebook()).readiness).toMatchObject({ unpublishedExams: 0, ready: true });

    expect((await h.act('teacher', exams['graded']!, 'unpublish')).body).toMatchObject({ status: 'scheduled' });
    expect((await h.readAttempt('s1', attemptId).expect(200)).body).toMatchObject({ resultReleased: false, result: null });
    expect((await h.act('teacher', exams['graded']!, 'publish')).body).toMatchObject({ status: 'published' });
  });

  it('AC6 — the final grades are fixed from the online results, and «my grades» shows the student their own', async () => {
    const m = await h.mark();
    const finalized = await h.api().post(`/api/classes/${h.classes['G']}/final-grades`).set(h.as('teacher')).send({});
    expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
    const book = finalized.body as GradebookBody;
    expect(book.students.map((entry) => [entry.student.id, entry.final?.percent, entry.final?.stale]).sort()).toEqual(
      [
        [h.id('s1'), 60, false],
        [h.id('s2'), 100, false],
        [h.id('s3'), 0, false],
        [h.id('s4'), 40, false],
      ].sort(),
    );
    expect((await h.eventsSince(m)).map((event) => event.action)).toEqual(['grades.finalized']);

    const grades = (await h.api().get(`/api/me/grades?classId=${h.classes['G']}`).set(h.as('s1')).expect(200)).body.items as {
      relation: string;
      components: { kind: string; id: string; status: string; score: number | null; maxScore: number; weight: number | null }[];
      final: { percent: number; isPass: boolean } | null;
    }[];
    expect(grades).toHaveLength(1);
    expect(grades[0]).toMatchObject({ relation: 'self', components: [{ kind: 'exam', id: exams['graded'], status: 'scored', score: 6, maxScore: 10, weight: 1 }], final: { percent: 60 } });
    expect(leakedKeys(grades)).toEqual([]);
  });

  it('AC7 — a result the teacher typed for an exam that releases on submit still waits for the publication', async () => {
    // «multi» releases an attempt's result at once; s3 never took it and is recorded absent on the sheet.
    const recorded = await h.recordResults('teacher', exams['multi']!, [{ studentId: h.id('s3'), status: 'absent', feedback: 'لم يحضر الاختبار' }]);
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    const mine = async (user: string) =>
      ((await h.myExams(user, `?classId=${h.classes['A']}`).expect(200)).body.items as { id: string; status: string; result: unknown }[]).find((item) => item.id === exams['multi'])!;
    // The student who took it sees their own attempt's result; the typed one is not shown before the teacher publishes.
    expect(await mine('s1')).toMatchObject({ status: 'scheduled', result: { status: 'scored', score: 10 } });
    expect(await mine('s3')).toMatchObject({ status: 'scheduled', result: null });

    await h.closeWindow(exams['multi']!, 60);
    expect((await h.act('teacher', exams['multi']!, 'publish')).body).toMatchObject({ status: 'published' });
    expect((await mine('s3')).result).toEqual({ status: 'absent', score: null, feedback: 'لم يحضر الاختبار' });
    expect((await mine('s1')).result).toMatchObject({ status: 'scored', score: 10 });
  });

  it('AC8 — a sweep batch that cannot finish as one transaction is closed one attempt at a time, each once', async () => {
    exams['slow'] = await h.onlineExam('teacher', 'A', five);
    const one = (await h.startAttempt('s1', exams['slow']!).expect(201)).body as AttemptBody;
    const two = (await h.startAttempt('s2', exams['slow']!).expect(201)).body as AttemptBody;
    // This exam was made available AFTER the first question's key was changed in the bank (AC1): its frozen copy carries the new key.
    await h.saveAnswers('s1', one.id, pickAnswers(one.questions, [3, 0, true, false, 1])).expect(200);
    await h.expireAttempt(one.id, 30);
    await h.expireAttempt(two.id, 30);
    const m = await h.mark();
    // One millisecond is not enough for any batch: the transaction is rolled back, and the fallback closes both.
    expect(await grading.sweep(new Date(), { examIds: [exams['slow']!], batchTimeoutMs: 1 })).toBe(2);
    const rows = await h.prisma.examAttempt.findMany({ where: { id: { in: [one.id, two.id] } }, select: { id: true, status: true, score: true } });
    expect(rows.map((row) => [row.id === one.id ? 'one' : 'two', row.status, Number(row.score)]).sort()).toEqual([
      ['one', 'timed_out', 10],
      ['two', 'timed_out', 0],
    ]);
    expect((await h.eventsOn(m, [one.id, two.id])).map((event) => event.action)).toEqual(['exams.attempt.timed_out', 'exams.attempt.timed_out']);
    expect(await resultRow('slow', 's1')).toMatchObject({ score: 10, source: 'online' });
    // Nothing is left to do.
    expect(await grading.sweep(new Date(), { examIds: [exams['slow']!] })).toBe(0);
  });
});
