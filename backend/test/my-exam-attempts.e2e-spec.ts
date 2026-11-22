// TEST-283 — MOD-09 phase 2, taking an online exam: a learner's own attempts
// (API-276..API-279), the server's clock and «my exams» (API-121) — against
// the live development database. Skipped when no database is reachable.
// Fixtures come from the shared harness (a teacher with the system `teacher`
// role on two classes, students with the system `student` role, a guardian
// linked to one of them, a learner whose role lacks `exams.take`, a student of
// another class) and are deleted at the end. No test waits for a real
// deadline: the harness moves an attempt's or a window's stored instants into
// the past. Audit events are read by entity above an id watermark.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NIL_ID, available, bootHarness, choiceBody, leakedKeys, pickAnswers, trueFalseBody } from './online-exams.helpers.js';
import type { AttemptQuestionBody, Harness } from './online-exams.helpers.js';

interface AttemptBody {
  id: string;
  attemptNo: number;
  status: string;
  startedAt: string;
  expiresAt: string;
  submittedAt: string | null;
  serverNow: string;
  remainingSeconds: number;
  timeUp: boolean;
  answeredCount: number;
  questionCount: number;
  exam: { id: string; closesAt: string | null; attemptsAllowed: number; resultsRelease: string; revealAnswers: boolean; maxScore: number; passScore: number | null; durationMinutes: number | null };
  questions: AttemptQuestionBody[];
  resultReleased: boolean;
  reviewReleased: boolean;
  result: { score: number; maxScore: number; correctCount: number; questionCount: number; isPass: boolean | null; counted: boolean } | null;
  attempts: { id: string; attemptNo: number; status: string; startedAt: string; submittedAt: string | null; score: number | null }[];
}

interface MyExamBody {
  id: string;
  status: string;
  delivery: string;
  relation: string;
  student: { id: string };
  result: { status: string; score: number | null; feedback: string | null } | null;
  online: {
    closesAt: string | null;
    attemptsAllowed: number;
    attemptsUsed: number;
    questionCount: number;
    resultsRelease: string;
    revealAnswers: boolean;
    canStart: boolean;
    blocker: string | null;
    inProgress: { id: string; attemptNo: number; expiresAt: string; remainingSeconds: number } | null;
    attempts: { id: string; attemptNo: number; status: string; score: number | null }[];
    serverNow: string;
  } | null;
}

const ATTEMPT_KEYS = [
  'answeredCount',
  'attemptNo',
  'attempts',
  'exam',
  'expiresAt',
  'id',
  'questionCount',
  'questions',
  'remainingSeconds',
  'result',
  'resultReleased',
  'reviewReleased',
  'serverNow',
  'startedAt',
  'status',
  'submittedAt',
  'timeUp',
];
const QUESTION_KEYS = ['answer', 'id', 'options', 'points', 'prompt', 'review', 'sortOrder', 'type'];
const MY_EXAM_KEYS = [
  'class',
  'delivery',
  'description',
  'durationMinutes',
  'id',
  'lesson',
  'maxScore',
  'online',
  'passScore',
  'publishedAt',
  'relation',
  'result',
  'scheduledAt',
  'status',
  'student',
  'timeZone',
  'title',
  'type',
];
const ONLINE_KEYS = ['attempts', 'attemptsAllowed', 'attemptsUsed', 'blocker', 'canStart', 'closesAt', 'inProgress', 'questionCount', 'resultsRelease', 'revealAnswers', 'serverNow'];
/** Three right, two wrong — the task's own example: 6 of 10. */
const THREE_OF_FIVE = [1, 0, true, true, 0] as const;

describe.skipIf(!available)('MOD-09 phase 2 — taking an online exam (e2e, TEST-283)', () => {
  let h: Harness;
  const exams: Record<string, string> = {};
  const attempts: Record<string, string> = {};
  let five: { questionId: string }[] = [];

  beforeAll(async () => {
    h = await bootHarness('TEST-283');
    const teacher = await h.systemRole('teacher');
    const student = await h.systemRole('student');
    await h.createUser('teacher', [teacher]);
    await h.createUser('teacherB', [teacher]);
    for (const name of ['s1', 's2', 's3', 's4', 'outsider']) await h.createUser(name, [student]);
    await h.createUser('guardian', [await h.systemRole('guardian')]);
    // A learner whose role reads exams but may not take them.
    await h.createUser('nokey', [await h.createRole('enokey', ['exams.read'])]);
    await h.linkGuardian('guardian', 's1');
    await h.course('CA');
    await h.course('CB');
    await h.klass('A', 'CA', ['teacher']);
    await h.klass('B', 'CB', ['teacherB']);
    await h.klass('C', 'CA', ['teacher']);
    for (const name of ['s1', 's2', 's3', 'nokey']) await h.enroll('A', name);
    await h.enroll('A', 's4', 'withdrawn');
    await h.enroll('B', 'outsider');
    await h.enroll('C', 's1');

    const bank = (await h.bank('teacher', { name: { ar: 'بنك أساسيات Python' }, courseId: h.courses['CA'] })).id;
    const q1 = await h.question('teacher', bank, choiceBody('ما ناتج print(2 + 3)؟', ['4', '5', '6', '23'], 1, { points: 2, explanation: { ar: 'عملية جمع' } }));
    const q2 = await h.question('teacher', bank, choiceBody('أي الكلمات تعرّف دالة؟', ['def', 'func', 'lambda'], 0, { points: 2 }));
    const q3 = await h.question('teacher', bank, trueFalseBody('يمكن استخدام Python لتطوير تطبيقات الويب.', true, { points: 2 }));
    const q4 = await h.question('teacher', bank, trueFalseBody('القوائم في Python غير قابلة للتعديل.', false, { points: 2 }));
    const q5 = await h.question('teacher', bank, choiceBody('ما نوع القيمة 3.14؟', ['int', 'float', 'str'], 1, { points: 2 }));
    five = [q1, q2, q3, q4, q5].map((question) => ({ questionId: question.id }));

    // Two attempts, the score at once, the answers once everybody is out.
    exams['main'] = await h.onlineExam('teacher', 'A', five, { attemptsAllowed: 2, resultsRelease: 'on_submit', revealAnswers: true, passScore: 6 });
    // One attempt, the result when the teacher publishes it, never the answers.
    exams['single'] = await h.onlineExam('teacher', 'A', five);
    // Its window closes in ten minutes: an attempt cannot run its thirty.
    exams['cut'] = await h.onlineExam('teacher', 'A', five, { closesAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    exams['later'] = await h.onlineExam('teacher', 'A', five);
    await h.postponeWindow(exams['later']);
    const draft = await h.createExam('teacher', 'A', { title: { ar: 'مسودة' }, type: 'quiz', maxScore: 10, delivery: 'online', ...h.openWindow() });
    exams['draft'] = draft.body.id as string;
    const manual = await h.createExam('teacher', 'A', { title: { ar: 'اختبار ورقي' }, type: 'quiz', maxScore: 10, scheduledAt: new Date(Date.now() - 60_000).toISOString() });
    exams['manual'] = manual.body.id as string;
    await h.act('teacher', exams['manual'], 'schedule').expect(200);
    // An exam whose class is cancelled afterwards.
    exams['cancelled'] = await h.onlineExam('teacher', 'C', five);
    await h.prisma.class.update({ where: { id: h.classes['C']! }, data: { status: 'cancelled' }, select: { id: true } });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  });

  const attemptOf = async (user: string, attemptId: string) => (await h.readAttempt(user, attemptId).expect(200)).body as AttemptBody;
  const myExamsOf = async (user: string, query = '') => (await h.myExams(user, query).expect(200)).body.items as MyExamBody[];
  const attemptCount = (examId: string, user: string) => h.prisma.examAttempt.count({ where: { examId, studentUserId: h.id(user) } });

  it('AC1 — an enrolled learner starts an attempt: the server fixes its deadline, serves the questions without their key, and resumes instead of starting twice', async () => {
    const m = await h.mark();
    const started = await h.startAttempt('s1', exams['main']!);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const attempt = started.body as AttemptBody;
    attempts['s1-main-1'] = attempt.id;
    expect(Object.keys(attempt).sort()).toEqual(ATTEMPT_KEYS);
    expect(attempt).toMatchObject({ attemptNo: 1, status: 'in_progress', submittedAt: null, timeUp: false, answeredCount: 0, questionCount: 5, resultReleased: true, reviewReleased: false, result: null });
    expect(attempt.exam).toMatchObject({ id: exams['main'], attemptsAllowed: 2, resultsRelease: 'on_submit', revealAnswers: true, maxScore: 10, passScore: 6, durationMinutes: 30 });
    // The deadline is the server's: the start plus the time limit.
    expect(Date.parse(attempt.expiresAt) - Date.parse(attempt.startedAt)).toBe(30 * 60_000);
    expect(attempt.remainingSeconds).toBeGreaterThan(1790);
    expect(attempt.remainingSeconds).toBeLessThanOrEqual(1800);
    expect(Math.abs(Date.parse(attempt.serverNow) - Date.now())).toBeLessThan(15_000);
    expect(attempt.attempts).toEqual([{ id: attempt.id, attemptNo: 1, status: 'in_progress', startedAt: attempt.startedAt, submittedAt: null, score: null }]);

    // The questions in the exam's order — and nothing a key could travel under (SEC-R-24).
    expect(attempt.questions.map((question) => question.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(attempt.questions.map((question) => question.type)).toEqual(['single_choice', 'single_choice', 'true_false', 'true_false', 'single_choice']);
    for (const question of attempt.questions) {
      expect(Object.keys(question).sort()).toEqual(QUESTION_KEYS);
      expect(question).toMatchObject({ points: 2, answer: null, review: null });
      for (const option of question.options) expect(Object.keys(option).sort()).toEqual(['id', 'text']);
    }
    expect(attempt.questions[0]!.options.map((option) => option.text.ar)).toEqual(['4', '5', '6', '23']);
    expect(attempt.questions[2]!.options).toEqual([]);
    expect(leakedKeys(attempt)).toEqual([]);

    // «Resume or create»: the same attempt again, never a second one.
    const again = await h.startAttempt('s1', exams['main']!);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: attempt.id, attemptNo: 1, expiresAt: attempt.expiresAt });
    expect((await h.startAttempt('s1', exams['main']!, { attemptNo: 1 })).status).toBe(200);
    // The number the client means must be the server's.
    expect((await h.startAttempt('s1', exams['main']!, { attemptNo: 2 })).body).toMatchObject({ statusCode: 409, code: 'attempt_conflict', expected: 2, next: 1 });
    expect(await attemptCount(exams['main']!, 's1')).toBe(1);

    // Exactly one event, by the learner, without anything of the exam's content.
    const events = await h.eventsOn(m, [attempt.id]);
    expect(events.map((event) => event.action)).toEqual(['exams.attempt.started']);
    expect(events[0]).toMatchObject({ actorUserId: h.id('s1'), entityType: 'exam_attempts', entityId: attempt.id });
    expect(events[0]!.metadata).toEqual({ examId: exams['main'], classId: h.classes['A'], attemptNo: 1, expiresAt: attempt.expiresAt });

    // A deadline never lies beyond the end of the window.
    const cut = await h.startAttempt('s3', exams['cut']!);
    expect(cut.status).toBe(201);
    expect(cut.body.expiresAt).toBe(cut.body.exam.closesAt);
    expect(cut.body.remainingSeconds).toBeLessThanOrEqual(600);
  });

  it('AC2 — nobody else gets in: another class, a withdrawn student, a role without exams.take, a draft, a manual exam, a window not open yet, a cancelled class', async () => {
    const m = await h.mark();
    const before = await h.prisma.examAttempt.count({ where: { examId: { in: Object.values(exams) } } });
    // An exam of a class the caller is not enrolled in does not exist for them — nor does a draft or a manual exam.
    expect((await h.startAttempt('outsider', exams['main']!)).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    expect((await h.startAttempt('s1', exams['draft']!)).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    expect((await h.startAttempt('s1', exams['manual']!)).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    expect((await h.startAttempt('s1', NIL_ID)).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    // An enrollment that is not active.
    expect((await h.startAttempt('s4', exams['main']!)).body).toMatchObject({ statusCode: 403, code: 'enrollment_required', enrollmentStatus: 'withdrawn' });
    // The key: a guardian, the class's own teacher and a learner whose role lacks it.
    for (const user of ['guardian', 'teacher', 'nokey']) {
      expect((await h.startAttempt(user, exams['main']!)).body, user).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['exams.take'] });
    }
    // The window and the class.
    const later = (await h.startAttempt('s1', exams['later']!)).body;
    expect(later).toMatchObject({ statusCode: 409, code: 'exam_not_open', reason: 'not_open_yet' });
    expect(Date.parse(later.opensAt)).toBeGreaterThan(Date.now());
    expect((await h.startAttempt('s1', exams['cancelled']!)).body).toMatchObject({ statusCode: 409, code: 'class_closed', classId: h.classes['C'], status: 'cancelled' });
    // Validation.
    expect((await h.startAttempt('s1', exams['main']!, { attemptNo: '1' })).status).toBe(400);
    expect((await h.startAttempt('s1', exams['main']!, { attemptNo: 0 })).status).toBe(400);
    expect((await h.startAttempt('s1', exams['main']!, { surprise: true })).status).toBe(400);
    expect((await h.api().post('/api/me/exams/not-a-uuid/attempts').set(h.as('s1')).send({})).status).toBe(400);
    expect((await h.api().post(`/api/me/exams/${exams['main']}/attempts`).send({})).status).toBe(401);

    // None of them opened an attempt or recorded an event.
    expect(await h.prisma.examAttempt.count({ where: { examId: { in: Object.values(exams) } } })).toBe(before);
    expect(await h.eventsSince(m)).toEqual([]);
  });

  it('AC3 — answers are saved, replaced and cleared against the frozen questions; only the owner reaches an attempt; a save records no event', async () => {
    const id = attempts['s1-main-1']!;
    const [q1, q2, q3, q4] = (await attemptOf('s1', id)).questions as [AttemptQuestionBody, AttemptQuestionBody, AttemptQuestionBody, AttemptQuestionBody, AttemptQuestionBody];
    const m = await h.mark();

    const saved = await h.saveAnswers('s1', id, [
      { examQuestionId: q1.id, optionId: q1.options[2]!.id },
      { examQuestionId: q3.id, value: false },
    ]);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(Object.keys(saved.body).sort()).toEqual(['answeredCount', 'attemptId', 'expiresAt', 'questionCount', 'remainingSeconds', 'saved', 'serverNow']);
    expect(saved.body).toMatchObject({ attemptId: id, saved: 2, answeredCount: 2, questionCount: 5 });
    expect(saved.body.remainingSeconds).toBeGreaterThan(1700);
    // Each entry is the whole new answer; an entry with neither field clears it.
    expect((await h.saveAnswers('s1', id, [{ examQuestionId: q1.id, optionId: q1.options[1]!.id }, { examQuestionId: q3.id }])).body).toMatchObject({ saved: 2, answeredCount: 1 });
    expect((await h.saveAnswers('s1', id, [{ examQuestionId: q4.id, value: null, optionId: null }])).body).toMatchObject({ saved: 1, answeredCount: 1 });

    // After a dropped connection the learner reads the attempt again: the saved answers and the server's remaining time.
    const resumed = await attemptOf('s1', id);
    expect(resumed.questions.map((question) => question.answer)).toEqual([{ optionId: q1.options[1]!.id, value: null }, null, null, null, null]);
    expect(resumed).toMatchObject({ status: 'in_progress', answeredCount: 1 });
    expect(leakedKeys(resumed)).toEqual([]);

    // What does not fit the questions of this exam is refused whole, before any write.
    const refusals: [string, Record<string, unknown>[], Record<string, unknown>][] = [
      ['a question the exam does not ask', [{ examQuestionId: NIL_ID, value: true }, { examQuestionId: q2.id, optionId: q2.options[0]!.id }], { unknown: [NIL_ID], duplicates: [], malformed: [] }],
      ['a question twice', [{ examQuestionId: q2.id, optionId: q2.options[0]!.id }, { examQuestionId: q2.id, optionId: q2.options[1]!.id }], { unknown: [], duplicates: [q2.id], malformed: [] }],
      ['an option of another question', [{ examQuestionId: q2.id, optionId: q1.options[0]!.id }], { unknown: [], duplicates: [], malformed: [q2.id] }],
      ['a boolean for a choice question', [{ examQuestionId: q2.id, value: true }], { unknown: [], duplicates: [], malformed: [q2.id] }],
      ['an option for a true/false question', [{ examQuestionId: q3.id, optionId: q1.options[0]!.id }], { unknown: [], duplicates: [], malformed: [q3.id] }],
      ['both fields', [{ examQuestionId: q3.id, optionId: q1.options[0]!.id, value: true }], { unknown: [], duplicates: [], malformed: [q3.id] }],
    ];
    for (const [label, answers, details] of refusals) {
      expect((await h.saveAnswers('s1', id, answers)).body, label).toMatchObject({ statusCode: 400, code: 'answers_invalid', ...details });
    }
    for (const body of [{ answers: [] }, {}, { answers: [{ examQuestionId: 'x', value: true }] }, { answers: [{ examQuestionId: q3.id, value: 'true' }] }, { answers: [{ examQuestionId: q3.id, value: true, isCorrect: true }] }]) {
      expect((await h.api().put(`/api/me/exam-attempts/${id}/answers`).set(h.as('s1')).send(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await h.prisma.examAnswer.count({ where: { attemptId: id } })).toBe(1);

    // Ownership: another learner, the student's own guardian, the class's teacher and the office — nobody reads or writes it here.
    for (const user of ['s2', 'outsider']) {
      expect((await h.readAttempt(user, id)).body, user).toMatchObject({ statusCode: 404, code: 'attempt_not_found' });
      expect((await h.saveAnswers(user, id, [{ examQuestionId: q3.id, value: true }])).body, user).toMatchObject({ statusCode: 404, code: 'attempt_not_found' });
      expect((await h.submitAttempt(user, id)).body, user).toMatchObject({ statusCode: 404, code: 'attempt_not_found' });
    }
    for (const user of ['guardian', 'teacher']) {
      expect((await h.readAttempt(user, id)).body, user).toMatchObject({ statusCode: 404, code: 'attempt_not_found' });
      expect((await h.saveAnswers(user, id, [{ examQuestionId: q3.id, value: true }])).body, user).toMatchObject({ statusCode: 403, code: 'permission_denied' });
      expect((await h.submitAttempt(user, id)).body, user).toMatchObject({ statusCode: 403, code: 'permission_denied' });
    }
    expect((await h.readAttempt('s1', NIL_ID)).body).toMatchObject({ statusCode: 404, code: 'attempt_not_found' });
    expect((await h.api().get(`/api/me/exam-attempts/${id}`)).status).toBe(401);
    expect(await attemptOf('s1', id)).toMatchObject({ status: 'in_progress', answeredCount: 1 });

    // A save is not an audited event (D-R165).
    expect(await h.eventsOn(m, [id])).toEqual([]);
    expect(await h.eventsSince(m)).toEqual([]);
  });

  it('AC4 — the submit is graded by the server once: three right and two wrong of five is 6 of 10, and repeating it changes nothing', async () => {
    const id = attempts['s1-main-1']!;
    const before = await attemptOf('s1', id);
    expect((await h.saveAnswers('s1', id, pickAnswers(before.questions, THREE_OF_FIVE))).body).toMatchObject({ saved: 5, answeredCount: 5 });
    const m = await h.mark();

    const submitted = await h.submitAttempt('s1', id);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const done = submitted.body as AttemptBody;
    expect(done).toMatchObject({ id, status: 'submitted', remainingSeconds: 0, timeUp: false, answeredCount: 5, resultReleased: true, reviewReleased: false });
    // The exam releases on submit: the score is there — the answers are not, while the window is open.
    expect(done.result).toEqual({ score: 6, maxScore: 10, correctCount: 3, questionCount: 5, isPass: true, counted: true });
    expect(done.questions.every((question) => question.review === null)).toBe(true);
    expect(leakedKeys(done)).toEqual([]);
    expect(done.attempts).toEqual([{ id, attemptNo: 1, status: 'submitted', startedAt: done.startedAt, submittedAt: done.submittedAt, score: 6 }]);
    expect(Date.parse(done.submittedAt!)).toBeLessThanOrEqual(Date.parse(done.expiresAt));

    // Idempotent: the same finished attempt, not graded again.
    const twice = (await h.submitAttempt('s1', id).expect(200)).body as AttemptBody;
    expect(twice).toMatchObject({ status: 'submitted', submittedAt: done.submittedAt, result: done.result });
    // And it takes no more answers.
    expect((await h.saveAnswers('s1', id, pickAnswers(before.questions, [1, 0, true, false, 1]))).body).toMatchObject({ statusCode: 409, code: 'attempt_closed', status: 'submitted' });
    expect(await attemptOf('s1', id)).toMatchObject({ result: { score: 6, correctCount: 3 } });

    const events = await h.eventsOn(m, [id]);
    expect(events.map((event) => event.action)).toEqual(['exams.attempt.submitted']);
    expect(events[0]).toMatchObject({ actorUserId: h.id('s1'), entityType: 'exam_attempts' });
    expect(events[0]!.metadata).toEqual({ examId: exams['main'], classId: h.classes['A'], studentId: h.id('s1'), attemptNo: 1, score: 6, maxScore: 10, correctCount: 3, questionCount: 5, counted: true });
    // The stored grading, answer by answer.
    const stored = await h.prisma.examAnswer.findMany({ where: { attemptId: id }, orderBy: { examQuestion: { sortOrder: 'asc' } }, select: { isCorrect: true, pointsAwarded: true } });
    expect(stored.map((answer) => [answer.isCorrect, Number(answer.pointsAwarded)])).toEqual([[true, 2], [true, 2], [true, 2], [false, 0], [false, 0]]);
  });

  it('AC5 — a second attempt is allowed and the best one counts; a third is refused', async () => {
    const second = await h.startAttempt('s1', exams['main']!, { attemptNo: 2 });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const attempt = second.body as AttemptBody;
    attempts['s1-main-2'] = attempt.id;
    expect(attempt).toMatchObject({ attemptNo: 2, status: 'in_progress', answeredCount: 0, result: null });
    // A fresh sheet: the answers of the first attempt do not come along.
    expect(attempt.questions.every((question) => question.answer === null)).toBe(true);
    expect(attempt.attempts.map((row) => [row.attemptNo, row.status, row.score])).toEqual([[1, 'submitted', 6], [2, 'in_progress', null]]);

    // Submitted empty: every question is worth 0, and the first attempt keeps counting.
    const empty = (await h.submitAttempt('s1', attempt.id).expect(200)).body as AttemptBody;
    expect(empty.result).toEqual({ score: 0, maxScore: 10, correctCount: 0, questionCount: 5, isPass: false, counted: false });
    expect((await attemptOf('s1', attempts['s1-main-1']!)).result).toMatchObject({ score: 6, counted: true });

    const third = (await h.startAttempt('s1', exams['main']!)).body;
    expect(third).toMatchObject({ statusCode: 409, code: 'attempts_exhausted', attemptsAllowed: 2, attempts: 2 });
    expect(await attemptCount(exams['main']!, 's1')).toBe(2);
  });

  it('AC6 — the clock is the server’s: a save just after the deadline is still taken, later the server closes the attempt with what was saved, and a read never writes', async () => {
    const started = (await h.startAttempt('s2', exams['single']!).expect(201)).body as AttemptBody;
    const id = started.id;
    attempts['s2-single'] = id;
    // The exam releases nothing before the teacher publishes.
    expect(started).toMatchObject({ resultReleased: false, reviewReleased: false });
    expect((await h.saveAnswers('s2', id, pickAnswers(started.questions, [1, 0, null, null, null]))).body).toMatchObject({ answeredCount: 2 });

    // A second past the deadline: inside the network allowance, so a last save still lands.
    await h.expireAttempt(id, 1);
    expect((await h.saveAnswers('s2', id, pickAnswers(started.questions, [null, null, true, null, null]))).body).toMatchObject({ saved: 1, answeredCount: 3, remainingSeconds: 0 });
    expect(await attemptOf('s2', id)).toMatchObject({ status: 'in_progress', timeUp: true, remainingSeconds: 0, answeredCount: 3 });

    // Half a minute past it: the time is over.
    await h.expireAttempt(id, 30);
    const m = await h.mark();
    // Reading shows the attempt as it is and closes nothing.
    expect(await attemptOf('s2', id)).toMatchObject({ status: 'in_progress', timeUp: true, remainingSeconds: 0, submittedAt: null, result: null });
    expect((await h.myExams('s2', `?classId=${h.classes['A']}`)).status).toBe(200);
    expect(await h.eventsOn(m, [id])).toEqual([]);
    expect(await h.prisma.examAttempt.findUniqueOrThrow({ where: { id }, select: { status: true } })).toEqual({ status: 'in_progress' });

    // The write is refused — and the server has closed the attempt with the three answers it had.
    expect((await h.saveAnswers('s2', id, pickAnswers(started.questions, [null, null, null, false, 1]))).body).toMatchObject({ statusCode: 409, code: 'attempt_closed', status: 'timed_out' });
    const closed = await attemptOf('s2', id);
    expect(closed).toMatchObject({ status: 'timed_out', timeUp: false, remainingSeconds: 0, answeredCount: 3, resultReleased: false, result: null });
    // The server dates its close at the deadline itself.
    expect(closed.submittedAt).toBe(closed.expiresAt);
    expect(closed.attempts[0]).toMatchObject({ status: 'timed_out', score: null });
    const row = await h.prisma.examAttempt.findUniqueOrThrow({ where: { id }, select: { score: true, correctCount: true } });
    expect([Number(row.score), row.correctCount]).toEqual([6, 3]);
    const events = await h.eventsOn(m, [id]);
    expect(events.map((event) => [event.action, event.actorUserId])).toEqual([['exams.attempt.timed_out', null]]);
    expect(events[0]!.metadata).toMatchObject({ studentId: h.id('s2'), attemptNo: 1, score: 6, correctCount: 3, counted: true });
    // A submit of the closed attempt answers it as it is; the one attempt is used up.
    expect((await h.submitAttempt('s2', id).expect(200)).body).toMatchObject({ status: 'timed_out' });
    expect((await h.startAttempt('s2', exams['single']!)).body).toMatchObject({ statusCode: 409, code: 'attempts_exhausted', attemptsAllowed: 1, attempts: 1 });
    expect((await h.eventsOn(m, [id])).length).toBe(1);

    // A submit that arrives after the time is over is the server's close, not the learner's submit.
    const late = (await h.startAttempt('s3', exams['single']!).expect(201)).body as AttemptBody;
    await h.saveAnswers('s3', late.id, pickAnswers(late.questions, [1, null, null, null, null])).expect(200);
    await h.expireAttempt(late.id, 30);
    const lateMark = await h.mark();
    expect((await h.submitAttempt('s3', late.id).expect(200)).body).toMatchObject({ status: 'timed_out', result: null });
    expect((await h.eventsOn(lateMark, [late.id])).map((event) => [event.action, event.actorUserId])).toEqual([['exams.attempt.timed_out', null]]);

    // Where an attempt is left, «start» closes the one whose time is over and opens the next.
    const first = (await h.startAttempt('s2', exams['main']!).expect(201)).body as AttemptBody;
    await h.expireAttempt(first.id, 30);
    const next = await h.startAttempt('s2', exams['main']!);
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    expect(next.body).toMatchObject({ attemptNo: 2, status: 'in_progress' });
    attempts['s2-main-2'] = next.body.id as string;
    expect((next.body as AttemptBody).attempts.map((entry) => [entry.attemptNo, entry.status, entry.score])).toEqual([[1, 'timed_out', 0], [2, 'in_progress', null]]);
  });

  it('AC7 — two requests at once: two «start» open one attempt, two «submit» grade it once', async () => {
    const m = await h.mark();
    const [a, b] = await Promise.all([h.startAttempt('s3', exams['main']!), h.startAttempt('s3', exams['main']!)]);
    expect([a.status, b.status].sort(), JSON.stringify([a.body, b.body])).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    const id = a.body.id as string;
    expect(await attemptCount(exams['main']!, 's3')).toBe(1);
    expect((await h.eventsOn(m, [id])).map((event) => event.action)).toEqual(['exams.attempt.started']);

    await h.saveAnswers('s3', id, pickAnswers((a.body as AttemptBody).questions, [1, 0, true, false, 1])).expect(200);
    const submitMark = await h.mark();
    const [x, y] = await Promise.all([h.submitAttempt('s3', id), h.submitAttempt('s3', id)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(x.body.result).toEqual({ score: 10, maxScore: 10, correctCount: 5, questionCount: 5, isPass: true, counted: true });
    expect(y.body).toMatchObject({ status: 'submitted', submittedAt: x.body.submittedAt, result: x.body.result });
    // Graded once: one event, one counted result.
    expect((await h.eventsOn(submitMark, [id])).map((event) => event.action)).toEqual(['exams.attempt.submitted']);
    const results = await h.prisma.examResult.findMany({ where: { examId: exams['main']!, studentUserId: h.id('s3') }, select: { status: true, score: true, source: true } });
    expect(results.map((result) => [result.status, Number(result.score), result.source])).toEqual([['scored', 10, 'online']]);
  });

  it('AC8 — «my exams» says for each student whether the exam can be taken now, and shows a score only once it is released', async () => {
    const mine = await myExamsOf('s1', `?classId=${h.classes['A']}`);
    // The draft is not listed; the manual exam carries no online side.
    expect(mine.map((item) => item.id).sort()).toEqual([exams['main'], exams['single'], exams['cut'], exams['later'], exams['manual']].sort());
    const item = (examName: string, list: MyExamBody[] = mine) => list.find((entry) => entry.id === exams[examName])!;
    for (const entry of mine) expect(Object.keys(entry).sort(), entry.id).toEqual(MY_EXAM_KEYS);
    expect(item('manual')).toMatchObject({ delivery: 'manual', online: null, result: null });

    const main = item('main');
    expect(Object.keys(main.online!).sort()).toEqual(ONLINE_KEYS);
    expect(main).toMatchObject({ delivery: 'online', status: 'scheduled', relation: 'self', result: { status: 'scored', score: 6, feedback: null } });
    expect(main.online).toMatchObject({ attemptsAllowed: 2, attemptsUsed: 2, questionCount: 5, resultsRelease: 'on_submit', revealAnswers: true, canStart: false, blocker: 'attempts_exhausted', inProgress: null });
    expect(main.online!.attempts.map((entry) => [entry.attemptNo, entry.status, entry.score])).toEqual([[1, 'submitted', 6], [2, 'submitted', 0]]);
    expect(item('single').online).toMatchObject({ attemptsAllowed: 1, attemptsUsed: 0, canStart: true, blocker: null, inProgress: null, attempts: [] });
    expect(item('later').online).toMatchObject({ canStart: false, blocker: 'not_open_yet' });
    expect(leakedKeys(mine)).toEqual([]);

    // The learner whose attempt the server closed: used up, and no score before the teacher publishes.
    const s2 = await myExamsOf('s2', `?classId=${h.classes['A']}`);
    expect(item('single', s2)).toMatchObject({ result: null, online: { attemptsUsed: 1, canStart: false, blocker: 'attempts_exhausted' } });
    expect(item('single', s2).online!.attempts.map((entry) => [entry.status, entry.score])).toEqual([['timed_out', null]]);
    // …and their attempt in progress is offered for resuming, with the server's remaining time.
    const running = item('main', s2).online!;
    expect(running).toMatchObject({ attemptsUsed: 2, canStart: true, blocker: null, inProgress: { id: attempts['s2-main-2'], attemptNo: 2 } });
    expect(running.inProgress!.remainingSeconds).toBeGreaterThan(1700);

    // A guardian reads their child's exams and never takes one; a role without the key is told so.
    const child = await myExamsOf('guardian');
    expect(child.every((entry) => entry.relation === 'child' && entry.student.id === h.id('s1'))).toBe(true);
    expect(item('main', child)).toMatchObject({ result: { status: 'scored', score: 6 }, online: { canStart: false, blocker: 'not_self', attemptsUsed: 2 } });
    expect(item('single', child).online).toMatchObject({ canStart: false, blocker: 'not_self' });
    expect(item('main', await myExamsOf('nokey')).online).toMatchObject({ canStart: false, blocker: 'not_permitted', attemptsUsed: 0 });
    // The exam of the cancelled class.
    expect((await myExamsOf('s1', `?classId=${h.classes['C']}`))[0]!.online).toMatchObject({ canStart: false, blocker: 'class_closed' });
    // Somebody else's class shows nothing.
    expect(await myExamsOf('outsider', `?classId=${h.classes['A']}`)).toEqual([]);
  });

  it('AC9 — the answers are revealed only when the exam allows it, the result is out and nobody can still answer; publishing releases the result of an exam that waits for it', async () => {
    const first = attempts['s1-main-1']!;
    // A second after the closing a last write could still be taken: no review yet.
    await h.closeWindow(exams['main']!, 1);
    const early = await attemptOf('s1', first);
    expect(early).toMatchObject({ resultReleased: true, reviewReleased: false });
    expect(leakedKeys(early)).toEqual([]);

    await h.closeWindow(exams['main']!, 60);
    const review = await attemptOf('s1', first);
    expect(review).toMatchObject({ resultReleased: true, reviewReleased: true, result: { score: 6, correctCount: 3 } });
    const [q1, , q3, q4, q5] = review.questions as [AttemptQuestionBody, AttemptQuestionBody, AttemptQuestionBody, AttemptQuestionBody, AttemptQuestionBody];
    expect(q1.review).toEqual({ isCorrect: true, pointsAwarded: 2, correctOptionId: q1.options[1]!.id, correctAnswer: null, explanation: { ar: 'عملية جمع' } });
    expect(q3.review).toEqual({ isCorrect: true, pointsAwarded: 2, correctOptionId: null, correctAnswer: true, explanation: null });
    expect(q4.review).toEqual({ isCorrect: false, pointsAwarded: 0, correctOptionId: null, correctAnswer: false, explanation: null });
    expect(q5.review).toEqual({ isCorrect: false, pointsAwarded: 0, correctOptionId: q5.options[1]!.id, correctAnswer: null, explanation: null });
    // The second, empty attempt is reviewed too: every question wrong.
    expect((await attemptOf('s1', attempts['s1-main-2']!)).questions.map((question) => question.review?.isCorrect)).toEqual([false, false, false, false, false]);
    // An attempt still open on the server shows no review, whatever the exam says.
    const open = await attemptOf('s2', attempts['s2-main-2']!);
    expect(open).toMatchObject({ status: 'in_progress', reviewReleased: true });
    expect(open.questions.every((question) => question.review === null)).toBe(true);
    expect(leakedKeys(open)).toEqual([]);
    // The window has closed: a learner with an attempt left does not start another.
    const refused = (await h.startAttempt('s3', exams['main']!)).body;
    expect(refused).toMatchObject({ statusCode: 409, code: 'exam_not_open', reason: 'closed' });
    expect(Date.parse(refused.closesAt)).toBeLessThan(Date.now());
    expect(await attemptCount(exams['main']!, 's3')).toBe(1);

    // s1 takes «single» too and hands it in empty, before its window closes.
    const mine = (await h.startAttempt('s1', exams['single']!).expect(201)).body as AttemptBody;
    expect((await h.submitAttempt('s1', mine.id).expect(200)).body).toMatchObject({ status: 'submitted', resultReleased: false, result: null });

    // «single» waits for the teacher: nothing is shown until the results are published — and publishing waits for the window.
    expect(await attemptOf('s2', attempts['s2-single']!)).toMatchObject({ resultReleased: false, result: null });
    expect((await h.act('teacher', exams['single']!, 'publish')).body).toMatchObject({ statusCode: 409, code: 'exam_window_open' });
    await h.closeWindow(exams['single']!, 60);
    expect((await h.act('teacher', exams['single']!, 'publish')).body).toMatchObject({ status: 'published' });
    const published = await attemptOf('s2', attempts['s2-single']!);
    expect(published).toMatchObject({ status: 'timed_out', resultReleased: true, reviewReleased: false });
    expect(published.result).toEqual({ score: 6, maxScore: 10, correctCount: 3, questionCount: 5, isPass: null, counted: true });
    // `revealAnswers` is off: the score, never the key.
    expect(leakedKeys(published)).toEqual([]);
    const s2 = await myExamsOf('s2', `?classId=${h.classes['A']}`);
    expect(s2.find((entry) => entry.id === exams['single'])).toMatchObject({ status: 'published', result: { status: 'scored', score: 6 }, online: { canStart: false, blocker: 'results_published' } });
    expect((await h.startAttempt('s2', exams['single']!)).body).toMatchObject({ statusCode: 409, code: 'exam_not_open', reason: 'results_published' });
  });

  it('AC10 — publishing the results closes what is still open on the server, and a window that never opened or has closed refuses with its reason', async () => {
    // «main» closed in AC9 with s2's second attempt still open on the server.
    const open = attempts['s2-main-2']!;
    const m = await h.mark();
    expect((await h.act('teacher', exams['main']!, 'publish')).body).toMatchObject({ status: 'published' });
    // Closed with nothing saved: 0, like the first attempt — and on a tie the earlier attempt counts.
    expect(await attemptOf('s2', open)).toMatchObject({ status: 'timed_out', result: { score: 0, counted: false } });
    expect((await h.eventsOn(m, [open])).map((event) => [event.action, event.actorUserId])).toEqual([['exams.attempt.timed_out', null]]);
    expect(await h.prisma.examAttempt.count({ where: { examId: exams['main']!, status: 'in_progress' } })).toBe(0);
    // The exam that never opened refuses with its reason; its window is in the future, so publishing waits.
    expect((await h.startAttempt('s3', exams['later']!)).body).toMatchObject({ statusCode: 409, code: 'exam_not_open', reason: 'not_open_yet' });
    await h.closeWindow(exams['later']!, 60);
    expect((await h.startAttempt('s3', exams['later']!)).body).toMatchObject({ statusCode: 409, code: 'exam_not_open', reason: 'closed' });
  });

  it('AC11 — the OpenAPI document describes the four routes, and the learner’s option carries no key', async () => {
    const document = await h.openApiDocument();
    const paths = document.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;
    expect(Object.keys(paths['/api/me/exams/{id}/attempts']!)).toEqual(['post']);
    expect(Object.keys(paths['/api/me/exam-attempts/{id}']!)).toEqual(['get']);
    expect(Object.keys(paths['/api/me/exam-attempts/{id}/answers']!)).toEqual(['put']);
    expect(Object.keys(paths['/api/me/exam-attempts/{id}/submit']!)).toEqual(['post']);
    expect(Object.keys(paths['/api/me/exams/{id}/attempts']!['post']!.responses)).toEqual(expect.arrayContaining(['200', '201', '403', '404', '409', '429']));
    const schemas = document.components.schemas as Record<string, { properties: Record<string, unknown> }>;
    expect(Object.keys(schemas['AttemptOptionDto']!.properties).sort()).toEqual(['id', 'text']);
    expect(Object.keys(schemas['AttemptQuestionDto']!.properties).sort()).toEqual(QUESTION_KEYS);
    expect(Object.keys(schemas['MyExamOnlineDto']!.properties).sort()).toEqual(ONLINE_KEYS);
  }, 20_000);
});
