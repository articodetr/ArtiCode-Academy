// TEST-285 — MOD-09 phase 2, the attempts as the teacher and the office see
// them (API-274, API-275) and the audited corrections: the key of a frozen
// question (API-272) and the regrade (API-273) — against the live development
// database. Skipped when no database is reachable. Fixtures come from the
// shared harness (a manager with a custom role, two teachers with the system
// `teacher` role on two classes, an assistant who reads exams but may not
// grade, students with the system `student` role) and are deleted at the end.
// Audit events are counted by fixture actor above an id watermark.
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NIL_ID, available, bootHarness, choiceBody, pickAnswers, trueFalseBody } from './online-exams.helpers.js';
import type { AttemptQuestionBody, Harness } from './online-exams.helpers.js';

interface AttemptBody {
  id: string;
  attemptNo: number;
  status: string;
  questions: AttemptQuestionBody[];
  result: { score: number; correctCount: number; counted: boolean } | null;
}

interface RowBody {
  id: string;
  attemptNo: number;
  status: string;
  startedAt: string;
  expiresAt: string;
  submittedAt: string | null;
  score: number | null;
  correctCount: number | null;
  counted: boolean;
  timeUp: boolean;
}

interface RosterBody {
  examId: string;
  classId: string;
  examStatus: string;
  maxScore: number;
  passScore: number | null;
  questionCount: number;
  scheduledAt: string | null;
  closesAt: string | null;
  window: string;
  serverNow: string;
  stats: Record<string, number | null>;
  questions: { examQuestionId: string; sortOrder: number; points: number; answered: number; correct: number }[];
  items: { student: { id: string; fullName: string; email: string | null }; enrollmentStatus: string | null; result: { status: string; score: number | null; source: string } | null; attempts: RowBody[] }[];
}

interface DetailBody {
  id: string;
  examId: string;
  attemptNo: number;
  status: string;
  gradedAt: string | null;
  score: number | null;
  maxScore: number;
  correctCount: number | null;
  questionCount: number;
  counted: boolean;
  student: { id: string; email: string | null };
  questions: {
    id: string;
    sortOrder: number;
    points: number;
    type: string;
    prompt: { ar: string };
    explanation: { ar: string } | null;
    options: { id: string; text: { ar: string }; isCorrect: boolean }[];
    correctAnswer: boolean | null;
    answer: { optionId: string | null; value: boolean | null } | null;
    isCorrect: boolean | null;
    pointsAwarded: number | null;
  }[];
}

interface ItemBody {
  id: string;
  sortOrder: number;
  points: number;
  questionId: string;
  question: { type: string; options: { id: string; text: { ar: string }; isCorrect: boolean }[]; correctAnswer: boolean | null };
  corrections: { at: string; byUserId: string; reason: string }[];
}

const ROSTER_KEYS = ['classId', 'closesAt', 'examId', 'examStatus', 'items', 'maxScore', 'passScore', 'questionCount', 'questions', 'scheduledAt', 'serverNow', 'stats', 'window'];
const STATS_KEYS = ['failed', 'finished', 'highest', 'inProgress', 'lowest', 'mean', 'notStarted', 'passRate', 'passed', 'started', 'students'];
const ROW_KEYS = ['attemptNo', 'correctCount', 'counted', 'expiresAt', 'id', 'score', 'startedAt', 'status', 'submittedAt', 'timeUp'];
const DETAIL_KEYS = ['attemptNo', 'correctCount', 'counted', 'examId', 'expiresAt', 'gradedAt', 'id', 'maxScore', 'questionCount', 'questions', 'score', 'startedAt', 'status', 'student', 'submittedAt'];
const THREE_OF_FIVE = [1, 0, true, true, 0] as const;
const ALL_RIGHT = [1, 0, true, false, 1] as const;

function verificationCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return Array.from({ length: 20 }, () => alphabet[randomInt(32)]).join('');
}

describe.skipIf(!available)('MOD-09 phase 2 — the teacher’s view of the attempts, key correction and regrade (e2e, TEST-285)', () => {
  let h: Harness;
  const exams: Record<string, string> = {};
  const attempts: Record<string, string> = {};
  let five: { questionId: string }[] = [];
  let items: ItemBody[] = [];

  beforeAll(async () => {
    h = await bootHarness('TEST-285');
    const teacher = await h.systemRole('teacher');
    const student = await h.systemRole('student');
    await h.createUser('manager', [
      await h.createRole('amanager', ['classes.read', 'classes.manage', 'exams.read', 'exams.manage', 'exams.grade', 'questions.manage', 'grades.read_all', 'grades.manage', 'users.read', 'users.read_contact']),
    ]);
    await h.createUser('teacher', [teacher]);
    await h.createUser('teacherB', [teacher]);
    // Assigned to the class, reads its exams, may not grade.
    await h.createUser('reader', [await h.createRole('areader', ['classes.read', 'exams.read'])]);
    // A role that does not even read exams.
    await h.createUser('nokey', [await h.createRole('anokey', ['classes.read'])]);
    for (const name of ['s1', 's2', 's3', 's4']) await h.createUser(name, [student]);
    await h.course('CA');
    await h.course('CB');
    await h.klass('A', 'CA', ['teacher', 'reader'], 'running');
    await h.klass('B', 'CB', ['teacherB']);
    await h.klass('C', 'CA', ['teacher']);
    for (const name of ['s1', 's2', 's3', 's4']) await h.enroll('A', name);
    await h.enroll('C', 's1');

    const bank = (await h.bank('teacher', { name: { ar: 'بنك أساسيات Python' }, courseId: h.courses['CA'] })).id;
    const created = [
      await h.question('teacher', bank, choiceBody('ما ناتج print(2 + 3)؟', ['4', '5', '6', '23'], 1, { points: 2, explanation: { ar: 'عملية جمع' } })),
      await h.question('teacher', bank, choiceBody('أي الكلمات تعرّف دالة؟', ['def', 'func', 'lambda'], 0, { points: 2 })),
      await h.question('teacher', bank, trueFalseBody('يمكن استخدام Python لتطوير تطبيقات الويب.', true, { points: 2 })),
      await h.question('teacher', bank, trueFalseBody('القوائم في Python غير قابلة للتعديل.', false, { points: 2 })),
      await h.question('teacher', bank, choiceBody('ما نوع القيمة 3.14؟', ['int', 'float', 'str'], 1, { points: 2 })),
    ];
    five = created.map((question) => ({ questionId: question.id }));

    exams['main'] = await h.onlineExam('teacher', 'A', five, { attemptsAllowed: 2, resultsRelease: 'on_submit', passScore: 6, weight: 1 });
    exams['other'] = await h.onlineExam('teacher', 'A', five, { weight: 0 });
    exams['cancelled'] = await h.onlineExam('teacher', 'C', five);
    const draft = await h.createExam('teacher', 'A', { title: { ar: 'مسودة' }, type: 'quiz', maxScore: 10, delivery: 'online', ...h.openWindow() });
    exams['draft'] = draft.body.id as string;
    await h.link('teacher', exams['draft'], five).expect(200);
    const manual = await h.createExam('teacher', 'A', { title: { ar: 'اختبار ورقي' }, type: 'quiz', maxScore: 10 });
    exams['manual'] = manual.body.id as string;
    await h.act('teacher', exams['manual'], 'schedule').expect(200);
    items = (await h.readQuestions('teacher', exams['main']).expect(200)).body.items as ItemBody[];

    // s1: 6 then 8 · s2: 10 · s3: started, one wrong answer saved, still running · s4: never starts.
    attempts['s1-1'] = (await take('s1', 'main', THREE_OF_FIVE)).id;
    attempts['s1-2'] = (await take('s1', 'main', [1, 0, true, false, 0])).id;
    attempts['s2-1'] = (await take('s2', 'main', ALL_RIGHT)).id;
    const running = (await h.startAttempt('s3', exams['main']).expect(201)).body as AttemptBody;
    attempts['s3-1'] = running.id;
    await h.saveAnswers('s3', running.id, pickAnswers(running.questions, [0, null, null, null, null])).expect(200);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  async function take(user: string, examName: string, picks: readonly (number | boolean | null)[]): Promise<AttemptBody> {
    const started = await h.startAttempt(user, exams[examName]!);
    if (started.status !== 201) throw new Error(`take: ${started.status} ${JSON.stringify(started.body)}`);
    const answers = pickAnswers((started.body as AttemptBody).questions, picks);
    if (answers.length > 0) await h.saveAnswers(user, started.body.id as string, answers).expect(200);
    return (await h.submitAttempt(user, started.body.id as string).expect(200)).body as AttemptBody;
  }

  const rosterOf = async (user: string, examName = 'main') => (await h.attemptsOf(user, exams[examName]!).expect(200)).body as RosterBody;
  const itemOf = (roster: RosterBody, user: string) => roster.items.find((item) => item.student.id === h.id(user))!;
  const detailOf = async (user: string, attempt: string) => (await h.attemptDetail(user, attempts[attempt]!).expect(200)).body as DetailBody;
  const scoreOf = async (attempt: string) => Number((await h.prisma.examAttempt.findUniqueOrThrow({ where: { id: attempts[attempt]! }, select: { score: true } })).score);
  const resultOf = async (user: string, examName = 'main') => {
    const row = await h.prisma.examResult.findUnique({ where: { examId_studentUserId: { examId: exams[examName]!, studentUserId: h.id(user) } }, select: { score: true, source: true } });
    return row === null ? null : [Number(row.score), row.source];
  };
  const snapshotOf = async (examQuestionId: string) =>
    (await h.prisma.examQuestion.findUniqueOrThrow({ where: { id: examQuestionId }, select: { snapshot: true } })).snapshot as {
      options: { id: string; isCorrect: boolean }[];
      correctBoolean: boolean | null;
      corrections?: { at: string; byUserId: string; previousOptionId: string | null; previousBoolean: boolean | null; reason: string }[];
    };

  it('AC1 — the roster lists every student with their attempts, the counted one marked, and the exam’s figures', async () => {
    const m = await h.mark();
    const roster = await rosterOf('teacher');
    expect(Object.keys(roster).sort()).toEqual(ROSTER_KEYS);
    expect(roster).toMatchObject({ examId: exams['main'], classId: h.classes['A'], examStatus: 'scheduled', maxScore: 10, passScore: 6, questionCount: 5, window: 'open' });
    expect(Math.abs(Date.parse(roster.serverNow) - Date.now())).toBeLessThan(15_000);

    // In enrollment order, each with their attempts in order.
    expect(roster.items.map((item) => item.student.id)).toEqual(['s1', 's2', 's3', 's4'].map((name) => h.id(name)));
    const s1 = itemOf(roster, 's1');
    for (const row of s1.attempts) expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(s1).toMatchObject({ enrollmentStatus: 'active', result: { status: 'scored', score: 8, source: 'online' } });
    expect(s1.attempts.map((row) => [row.id, row.attemptNo, row.status, row.score, row.correctCount, row.counted, row.timeUp])).toEqual([
      [attempts['s1-1'], 1, 'submitted', 6, 3, false, false],
      [attempts['s1-2'], 2, 'submitted', 8, 4, true, false],
    ]);
    expect(itemOf(roster, 's2').attempts.map((row) => [row.score, row.counted])).toEqual([[10, true]]);
    expect(itemOf(roster, 's3')).toMatchObject({ result: null, attempts: [{ id: attempts['s3-1'], status: 'in_progress', score: null, correctCount: null, submittedAt: null, counted: false, timeUp: false }] });
    expect(itemOf(roster, 's4')).toMatchObject({ result: null, attempts: [] });

    // Who started, who finished, and how the counted scores (8 and 10) look.
    expect(Object.keys(roster.stats).sort()).toEqual(STATS_KEYS);
    expect(roster.stats).toEqual({ students: 4, started: 3, inProgress: 1, finished: 2, notStarted: 1, mean: 9, highest: 10, lowest: 8, passed: 2, failed: 0, passRate: 100 });
    // Each question over the two counted attempts: only the last one was missed, once.
    expect(roster.questions.map((question) => [question.examQuestionId, question.sortOrder, question.points, question.answered, question.correct])).toEqual(
      items.map((item, index) => [item.id, index, 2, 2, index === 4 ? 1 : 2]),
    );

    // The D-R07 projection: the teacher role reads no contact field, the manager does.
    expect(s1.student).toMatchObject({ fullName: 'Test s1', email: null });
    expect(itemOf(await rosterOf('manager'), 's1').student.email).toBe(h.email('s1'));
    expect(await rosterOf('reader')).toMatchObject({ stats: roster.stats });

    // An attempt whose time is up and that the server has not closed yet is shown as such — the read closes nothing.
    await h.expireAttempt(attempts['s3-1']!, 30);
    expect(itemOf(await rosterOf('teacher'), 's3').attempts[0]).toMatchObject({ status: 'in_progress', timeUp: true, score: null });
    expect(await h.prisma.examAttempt.findUniqueOrThrow({ where: { id: attempts['s3-1']! }, select: { status: true } })).toEqual({ status: 'in_progress' });
    // Give it its time back for the tests below.
    await h.prisma.examAttempt.update({ where: { id: attempts['s3-1']! }, data: { startedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60_000) }, select: { id: true } });
    expect(await h.eventsSince(m)).toEqual([]);

    // A manual exam has the roster and no attempt.
    const manual = await rosterOf('teacher', 'manual');
    expect(manual).toMatchObject({ questionCount: 0, window: 'not_open', questions: [], stats: { students: 4, started: 0, inProgress: 0, finished: 0, notStarted: 4, mean: null, highest: null, lowest: null, passed: null, failed: null, passRate: null } });
    expect(manual.items.every((item) => item.attempts.length === 0)).toBe(true);
  });

  it('AC2 — one attempt with the key and the student’s answers, for those who see the exam’s class only', async () => {
    const detail = await detailOf('teacher', 's1-1');
    expect(Object.keys(detail).sort()).toEqual(DETAIL_KEYS);
    expect(detail).toMatchObject({ id: attempts['s1-1'], examId: exams['main'], attemptNo: 1, status: 'submitted', score: 6, maxScore: 10, correctCount: 3, questionCount: 5, counted: false, student: { id: h.id('s1'), email: null } });
    expect(detail.gradedAt).not.toBeNull();
    const [q1, , q3, q4, q5] = detail.questions as [DetailBody['questions'][number], DetailBody['questions'][number], DetailBody['questions'][number], DetailBody['questions'][number], DetailBody['questions'][number]];
    // The key travels here — and only here.
    expect(q1).toMatchObject({ sortOrder: 0, points: 2, type: 'single_choice', explanation: { ar: 'عملية جمع' }, correctAnswer: null, answer: { optionId: q1.options[1]!.id, value: null }, isCorrect: true, pointsAwarded: 2 });
    expect(q1.options.map((option) => option.isCorrect)).toEqual([false, true, false, false]);
    expect(q3).toMatchObject({ type: 'true_false', options: [], correctAnswer: true, answer: { optionId: null, value: true }, isCorrect: true, pointsAwarded: 2 });
    expect(q4).toMatchObject({ correctAnswer: false, answer: { optionId: null, value: true }, isCorrect: false, pointsAwarded: 0 });
    expect(q5).toMatchObject({ answer: { optionId: q5.options[0]!.id, value: null }, isCorrect: false, pointsAwarded: 0 });
    expect(await detailOf('teacher', 's1-2')).toMatchObject({ attemptNo: 2, score: 8, counted: true });
    expect((await detailOf('manager', 's2-1')).student.email).toBe(h.email('s2'));

    // An attempt in progress: the answers saved so far, nothing graded yet.
    const running = await detailOf('teacher', 's3-1');
    expect(running).toMatchObject({ status: 'in_progress', score: null, correctCount: null, gradedAt: null, counted: false });
    expect(running.questions.map((question) => [question.answer === null, question.isCorrect, question.pointsAwarded])).toEqual([
      [false, null, null],
      [true, null, null],
      [true, null, null],
      [true, null, null],
      [true, null, null],
    ]);

    // Visibility: the teacher of another class, and a learner — even the attempt's own student — get nothing from these routes.
    for (const user of ['teacherB', 's1', 's2']) {
      expect((await h.attemptsOf(user, exams['main']!)).body, user).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
      expect((await h.attemptDetail(user, attempts['s1-1']!)).body, user).toMatchObject({ statusCode: 404, code: 'attempt_not_found' });
    }
    expect((await h.attemptsOf('nokey', exams['main']!)).body).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['exams.read'] });
    expect((await h.attemptDetail('nokey', attempts['s1-1']!)).body).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['exams.read'] });
    expect((await h.attemptsOf('teacher', NIL_ID)).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    expect((await h.attemptDetail('teacher', NIL_ID)).body).toMatchObject({ statusCode: 404, code: 'attempt_not_found' });
    expect((await h.attemptsOf('teacher', 'not-a-uuid')).status).toBe(400);
    expect((await h.api().get(`${h.EXAMS}/${exams['main']}/attempts`)).status).toBe(401);
  });

  it('AC3 — correcting the key of a frozen question grades every finished attempt again, in one audited step that names no key', async () => {
    const fifth = items[4]!;
    const wasCorrect = fifth.question.options[1]!.id;
    const nowCorrect = fifth.question.options[0]!.id;
    expect([await scoreOf('s1-1'), await scoreOf('s1-2'), await scoreOf('s2-1')]).toEqual([6, 8, 10]);
    const m = await h.mark();

    const corrected = await h.correctKey('teacher', exams['main']!, fifth.id, { correctOptionId: nowCorrect, reason: '  المفتاح كان خاطئًا: القيمة int  ' });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(Object.keys(corrected.body).sort()).toEqual(['changed', 'question', 'regrade']);
    // Three finished attempts, all three touched by this question; both students' counted results move.
    expect(corrected.body).toMatchObject({ changed: true, regrade: { attempts: 3, changedAttempts: 3, changedResults: 2 } });
    expect((corrected.body.question as ItemBody).question.options.map((option) => option.isCorrect)).toEqual([true, false, false]);
    // The teacher's view of the question names the correction — who, when, why — and not the key it replaced.
    expect((corrected.body.question as ItemBody).corrections).toEqual([{ at: expect.any(String), byUserId: h.id('teacher'), reason: 'المفتاح كان خاطئًا: القيمة int' }]);
    expect(items.every((item) => item.corrections.length === 0)).toBe(true);

    // s1 had picked the option that is now right: 6 → 8 and 8 → 10; s2 had picked the old key: 10 → 8.
    expect([await scoreOf('s1-1'), await scoreOf('s1-2'), await scoreOf('s2-1')]).toEqual([8, 10, 8]);
    expect(await resultOf('s1')).toEqual([10, 'online']);
    expect(await resultOf('s2')).toEqual([8, 'online']);
    expect(await detailOf('teacher', 's1-1')).toMatchObject({ score: 8, correctCount: 4 });
    expect((await detailOf('teacher', 's2-1')).questions[4]).toMatchObject({ isCorrect: false, pointsAwarded: 0 });
    // The attempt in progress is not graded — it will be, with the new key, when it is handed in.
    expect(await detailOf('teacher', 's3-1')).toMatchObject({ status: 'in_progress', score: null });
    expect((await rosterOf('teacher')).stats).toMatchObject({ finished: 2, mean: 9, highest: 10, lowest: 8 });

    // Exactly one event, by the teacher, on the exam: the reason and the counts — never a key.
    const events = await h.eventsSince(m);
    expect(events.map((event) => [event.action, event.actorUserId, event.entityType, event.entityId])).toEqual([['exams.questions.key_corrected', h.id('teacher'), 'exams', exams['main']]]);
    expect(events[0]!.metadata).toEqual({
      classId: h.classes['A'],
      code: h.code('A'),
      examQuestionId: fifth.id,
      position: 4,
      attempts: 3,
      changedAttempts: 3,
      changedResults: 2,
      reason: 'المفتاح كان خاطئًا: القيمة int',
    });
    const serialized = JSON.stringify(events[0]);
    expect(serialized.includes(wasCorrect) || serialized.includes(nowCorrect)).toBe(false);

    // The previous key is kept with the frozen copy itself; the question in its bank is not touched.
    const snapshot = await snapshotOf(fifth.id);
    expect(snapshot.options.map((option) => option.isCorrect)).toEqual([true, false, false]);
    expect(snapshot.corrections).toHaveLength(1);
    expect(snapshot.corrections![0]).toMatchObject({ byUserId: h.id('teacher'), previousOptionId: wasCorrect, previousBoolean: null, reason: 'المفتاح كان خاطئًا: القيمة int' });
    const inBank = await h.prisma.questionOption.findMany({ where: { questionId: fifth.questionId }, orderBy: { sortOrder: 'asc' }, select: { isCorrect: true } });
    expect(inBank.map((option) => option.isCorrect)).toEqual([false, true, false]);

    // Naming the key the question already has changes nothing and records nothing.
    const again = await h.mark();
    expect((await h.correctKey('teacher', exams['main']!, fifth.id, { correctOptionId: nowCorrect, reason: 'مرة أخرى' })).body).toMatchObject({ changed: false, regrade: { attempts: 0, changedAttempts: 0, changedResults: 0 } });
    expect(await h.eventsSince(again)).toEqual([]);
    expect((await snapshotOf(fifth.id)).corrections).toHaveLength(1);

    // A true/false question: «false» becomes «true». s1's first attempt had said true (8 → 10), the others false (10 → 8, 8 → 6).
    const fourth = items[3]!;
    const flipped = await h.correctKey('manager', exams['main']!, fourth.id, { correctAnswer: true, reason: 'العبارة صحيحة' });
    // s1 keeps 10 as the counted score — now from the first attempt — so only s2's result moves.
    expect(flipped.body).toMatchObject({ changed: true, question: { question: { correctAnswer: true } }, regrade: { attempts: 3, changedAttempts: 3, changedResults: 1 } });
    expect([await scoreOf('s1-1'), await scoreOf('s1-2'), await scoreOf('s2-1')]).toEqual([10, 8, 6]);
    expect(await resultOf('s1')).toEqual([10, 'online']);
    expect(await resultOf('s2')).toEqual([6, 'online']);
    expect(itemOf(await rosterOf('teacher'), 's1').attempts.map((row) => row.counted)).toEqual([true, false]);
    expect((await snapshotOf(fourth.id)).corrections![0]).toMatchObject({ byUserId: h.id('manager'), previousOptionId: null, previousBoolean: false });

    // The attempt that was still running is handed in now: graded with the corrected keys.
    const running = (await h.readAttempt('s3', attempts['s3-1']!).expect(200)).body as AttemptBody;
    await h.saveAnswers('s3', running.id, pickAnswers(running.questions, [1, 0, true, true, 0])).expect(200);
    expect((await h.submitAttempt('s3', running.id).expect(200)).body).toMatchObject({ status: 'submitted', result: { score: 10, correctCount: 5 } });
  });

  it('AC4 — a correction is refused for a key that does not fit, an unknown question, an exam that is not frozen, and anyone who may not grade', async () => {
    const m = await h.mark();
    const before = [await scoreOf('s1-1'), await scoreOf('s1-2'), await scoreOf('s2-1')];
    const choice = items[0]!;
    const boolean = items[2]!;
    const key = (user: string, examName: string, examQuestionId: string, body: Record<string, unknown>) => h.correctKey(user, exams[examName]!, examQuestionId, body);

    // The key must fit the question's type and be one of its own options.
    const problems: [string, string, Record<string, unknown>, string][] = [
      ['a boolean for a choice question', choice.id, { correctAnswer: true, reason: 'سبب' }, 'not_allowed_for_type'],
      ['no option for a choice question', choice.id, { reason: 'سبب' }, 'option_required'],
      ['an option of another question', choice.id, { correctOptionId: items[1]!.question.options[0]!.id, reason: 'سبب' }, 'option_unknown'],
      ['an option for a true/false question', boolean.id, { correctOptionId: choice.question.options[0]!.id, reason: 'سبب' }, 'not_allowed_for_type'],
      ['no answer for a true/false question', boolean.id, { reason: 'سبب' }, 'answer_required'],
    ];
    for (const [label, examQuestionId, body, problem] of problems) {
      expect((await key('teacher', 'main', examQuestionId, body)).body, label).toMatchObject({ statusCode: 400, code: 'key_invalid', problem });
    }
    // A reason is required.
    for (const body of [{ correctAnswer: false }, { correctAnswer: false, reason: '   ' }, { correctAnswer: 'false', reason: 'سبب' }, { correctAnswer: false, reason: 'سبب', score: 10 }, { correctAnswer: false, reason: 'س'.repeat(501) }]) {
      expect((await key('teacher', 'main', boolean.id, body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    // The question must be one of this exam's.
    const foreign = ((await h.readQuestions('teacher', exams['other']!).expect(200)).body.items as ItemBody[])[2]!;
    expect((await key('teacher', 'main', NIL_ID, { correctAnswer: false, reason: 'سبب' })).body).toMatchObject({ statusCode: 404, code: 'question_not_found', questionIds: [NIL_ID] });
    expect((await key('teacher', 'main', foreign.id, { correctAnswer: false, reason: 'سبب' })).body).toMatchObject({ statusCode: 404, code: 'question_not_found', questionIds: [foreign.id] });
    // The exam must be an online one that was made available.
    const draftItem = ((await h.readQuestions('teacher', exams['draft']!).expect(200)).body.items as ItemBody[])[2]!;
    expect((await key('teacher', 'draft', draftItem.id, { correctAnswer: false, reason: 'سبب' })).body).toMatchObject({ statusCode: 409, code: 'exam_not_frozen', status: 'draft' });
    expect((await key('teacher', 'manual', boolean.id, { correctAnswer: false, reason: 'سبب' })).body).toMatchObject({ statusCode: 409, code: 'exam_not_online' });
    expect((await h.regrade('teacher', exams['manual']!, { reason: 'سبب' })).body).toMatchObject({ statusCode: 409, code: 'exam_not_online' });
    expect((await h.regrade('teacher', exams['draft']!, { reason: 'سبب' })).body).toMatchObject({ statusCode: 409, code: 'exam_not_frozen' });
    // Who: `exams.grade` and the class.
    for (const user of ['reader', 's1', 'nokey']) {
      expect((await key(user, 'main', boolean.id, { correctAnswer: false, reason: 'سبب' })).body, user).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['exams.grade'] });
      expect((await h.regrade(user, exams['main']!, { reason: 'سبب' })).body, user).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['exams.grade'] });
    }
    expect((await key('teacherB', 'main', boolean.id, { correctAnswer: false, reason: 'سبب' })).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    expect((await h.regrade('teacherB', exams['main']!, { reason: 'سبب' })).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    expect((await h.regrade('teacher', exams['main']!, {})).status).toBe(400);
    expect((await h.api().post(`${h.EXAMS}/${exams['main']}/regrade`).send({ reason: 'سبب' })).status).toBe(401);

    // None of it changed a score, a key or the audit trail.
    expect([await scoreOf('s1-1'), await scoreOf('s1-2'), await scoreOf('s2-1')]).toEqual(before);
    expect((await snapshotOf(boolean.id)).corrections).toBeUndefined();
    expect(await h.eventsSince(m)).toEqual([]);
  });

  it('AC5 — a regrade grades the finished attempts again from the frozen questions: nothing to record when nothing changes, one event when something does', async () => {
    const m = await h.mark();
    // The grading is deterministic: normally a regrade finds nothing to do.
    expect((await h.regrade('teacher', exams['main']!, { reason: 'تحقق دوري' })).body).toEqual({ attempts: 4, changedAttempts: 0, changedResults: 0 });
    expect(await h.eventsSince(m)).toEqual([]);

    // A stored grading that no longer matches the frozen questions (here: forced, behind the API's back) is put right.
    const answer = await h.prisma.examAnswer.findFirstOrThrow({ where: { attemptId: attempts['s2-1']!, isCorrect: true }, select: { examQuestionId: true } });
    await h.prisma.examAnswer.update({ where: { attemptId_examQuestionId: { attemptId: attempts['s2-1']!, examQuestionId: answer.examQuestionId } }, data: { isCorrect: false, pointsAwarded: 0 } });
    await h.prisma.examAttempt.update({ where: { id: attempts['s2-1']! }, data: { score: 2, correctCount: 1 } });
    await h.prisma.examResult.update({ where: { examId_studentUserId: { examId: exams['main']!, studentUserId: h.id('s2') } }, data: { score: 2 } });

    const fixed = await h.regrade('manager', exams['main']!, { reason: '  مراجعة بعد خلل  ' });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect(fixed.body).toEqual({ attempts: 4, changedAttempts: 1, changedResults: 1 });
    expect(await scoreOf('s2-1')).toBe(6);
    expect(await resultOf('s2')).toEqual([6, 'online']);
    const events = await h.eventsSince(m);
    expect(events.map((event) => [event.action, event.actorUserId, event.entityId])).toEqual([['exams.attempts.regraded', h.id('manager'), exams['main']]]);
    expect(events[0]!.metadata).toEqual({ classId: h.classes['A'], code: h.code('A'), attempts: 4, changedAttempts: 1, changedResults: 1, reason: 'مراجعة بعد خلل' });
  });

  it('AC6 — a correction after the final grades were fixed turns them stale; once a certificate is issued, or the class is cancelled, it is refused', async () => {
    // The results are published and the final grades fixed: s1 100, s2 60, s3 100, s4 0 (never took it).
    await h.closeWindow(exams['main']!, 60);
    await h.closeWindow(exams['other']!, 60);
    expect((await h.act('teacher', exams['main']!, 'publish')).body).toMatchObject({ status: 'published' });
    const finalized = await h.api().post(`/api/classes/${h.classes['A']}/final-grades`).set(h.as('teacher')).send({});
    expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
    const finalOf = (body: { students: { student: { id: string }; final: { percent: number; stale: boolean } | null }[] }, user: string) => body.students.find((entry) => entry.student.id === h.id(user))!.final;
    expect([finalOf(finalized.body, 's1'), finalOf(finalized.body, 's2')]).toEqual([expect.objectContaining({ percent: 100, stale: false }), expect.objectContaining({ percent: 60, stale: false })]);

    // The second question's key is corrected on the published exam: allowed, audited, and the stored final grades now show as stale.
    const second = items[1]!;
    const m = await h.mark();
    const corrected = await h.correctKey('teacher', exams['main']!, second.id, { correctOptionId: second.question.options[2]!.id, reason: 'تصحيح بعد النشر' });
    expect(corrected.body).toMatchObject({ changed: true, regrade: { attempts: 4, changedAttempts: 4 } });
    expect((await h.eventsSince(m)).map((event) => event.action)).toEqual(['exams.questions.key_corrected']);
    const book = (await h.api().get(`/api/classes/${h.classes['A']}/gradebook`).set(h.as('teacher')).expect(200)).body;
    // Everybody had picked the old key: every counted score drops by the question's two points.
    expect(await resultOf('s1')).toEqual([8, 'online']);
    expect(finalOf(book, 's1')).toMatchObject({ percent: 100, stale: true });
    expect(finalOf(book, 's2')).toMatchObject({ percent: 60, stale: true });
    // The student who never took it has nothing that changed.
    expect(finalOf(book, 's4')).toMatchObject({ percent: 0, stale: false });

    // A certificate is issued on these grades: from now on the results under it are not rewritten (D-R54).
    const enrollment = await h.prisma.enrollment.findUniqueOrThrow({ where: { classId_studentUserId: { classId: h.classes['A']!, studentUserId: h.id('s1') } }, select: { id: true } });
    await h.prisma.certificate.create({
      data: {
        serial: `${h.prefix}-2026-00001`,
        verificationCode: verificationCode(),
        enrollmentId: enrollment.id,
        classId: h.classes['A']!,
        courseId: h.courses['CA']!,
        studentUserId: h.id('s1'),
        percent: 100,
        bandLabel: { ar: 'ممتاز' },
        snapshot: { student: { fullName: 'Test s1' } },
      },
      select: { id: true },
    });
    const certified = await h.mark();
    const scores = [await scoreOf('s1-1'), await scoreOf('s1-2'), await scoreOf('s2-1')];
    expect((await h.correctKey('teacher', exams['main']!, second.id, { correctOptionId: second.question.options[0]!.id, reason: 'تراجع' })).body).toMatchObject({
      statusCode: 409,
      code: 'grades_certified',
      classId: h.classes['A'],
      certificateCount: 1,
    });
    expect((await h.regrade('manager', exams['main']!, { reason: 'تراجع' })).body).toMatchObject({ statusCode: 409, code: 'grades_certified', certificateCount: 1 });
    // The other exam of the class is under the same certificate.
    const otherItem = ((await h.readQuestions('teacher', exams['other']!).expect(200)).body.items as ItemBody[])[2]!;
    expect((await h.correctKey('teacher', exams['other']!, otherItem.id, { correctAnswer: false, reason: 'تراجع' })).body).toMatchObject({ statusCode: 409, code: 'grades_certified' });
    expect([await scoreOf('s1-1'), await scoreOf('s1-2'), await scoreOf('s2-1')]).toEqual(scores);
    expect((await snapshotOf(second.id)).corrections).toHaveLength(1);
    expect(await h.eventsSince(certified)).toEqual([]);

    // A cancelled class takes no exam write at all.
    const taken = await take('s1', 'cancelled', ALL_RIGHT);
    expect(taken.status).toBe('submitted');
    await h.prisma.class.update({ where: { id: h.classes['C']! }, data: { status: 'cancelled' }, select: { id: true } });
    const frozenItem = ((await h.readQuestions('teacher', exams['cancelled']!).expect(200)).body.items as ItemBody[])[2]!;
    expect((await h.correctKey('teacher', exams['cancelled']!, frozenItem.id, { correctAnswer: false, reason: 'سبب' })).body).toMatchObject({ statusCode: 409, code: 'class_closed', status: 'cancelled' });
    expect((await h.regrade('teacher', exams['cancelled']!, { reason: 'سبب' })).body).toMatchObject({ statusCode: 409, code: 'class_closed' });
    // …but its attempts stay readable.
    expect((await rosterOf('teacher', 'cancelled')).stats).toMatchObject({ students: 1, finished: 1, highest: 10 });
  });

  it('AC7 — the OpenAPI document describes the four routes', async () => {
    const document = await h.openApiDocument();
    const paths = document.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;
    expect(Object.keys(paths['/api/exams/{id}/attempts']!)).toEqual(['get']);
    expect(Object.keys(paths['/api/exam-attempts/{id}']!)).toEqual(['get']);
    expect(Object.keys(paths['/api/exams/{id}/questions/{examQuestionId}/key']!)).toEqual(['post']);
    expect(Object.keys(paths['/api/exams/{id}/regrade']!)).toEqual(['post']);
    expect(Object.keys(paths['/api/exams/{id}/regrade']!['post']!.responses)).toEqual(expect.arrayContaining(['200', '400', '403', '404', '409']));
    const schemas = document.components.schemas as Record<string, { properties: Record<string, unknown> }>;
    expect(Object.keys(schemas['ExamAttemptsDto']!.properties).sort()).toEqual(ROSTER_KEYS);
    expect(Object.keys(schemas['ExamAttemptsStatsDto']!.properties).sort()).toEqual(STATS_KEYS);
    expect(Object.keys(schemas['ExamAttemptDetailDto']!.properties).sort()).toEqual(DETAIL_KEYS);
    expect(Object.keys(schemas['RegradeSummaryDto']!.properties).sort()).toEqual(['attempts', 'changedAttempts', 'changedResults']);
  }, 20_000);

  it('AC8 — a correction and the issuing of a certificate never interleave: the correction waits for the class row, then is refused', async () => {
    // A class of its own, without a certificate yet: one student took its exam.
    await h.klass('D', 'CA', ['teacher'], 'running');
    const enrollmentId = await h.enroll('D', 's2');
    exams['race'] = await h.onlineExam('teacher', 'D', five);
    attempts['race'] = (await take('s2', 'race', ALL_RIGHT)).id;
    const question = ((await h.readQuestions('teacher', exams['race']).expect(200)).body.items as ItemBody[])[0]!;

    let lockTaken: () => void = () => undefined;
    let release: () => void = () => undefined;
    const taken = new Promise<void>((resolve) => (lockTaken = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    // What issuing a certificate does: the class row first (FOR NO KEY UPDATE), the certificate under it.
    const issuing = h.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM classes WHERE id = ${h.classes['D']!}::uuid FOR NO KEY UPDATE`;
        lockTaken();
        await released;
        await tx.certificate.create({
          data: {
            serial: `${h.prefix}-2026-00002`,
            verificationCode: verificationCode(),
            enrollmentId,
            classId: h.classes['D']!,
            courseId: h.courses['CA']!,
            studentUserId: h.id('s2'),
            percent: 100,
            bandLabel: { ar: 'ممتاز' },
            snapshot: { student: { fullName: 'Test s2' } },
          },
          select: { id: true },
        });
      },
      { timeout: 30_000 },
    );
    await taken;

    let settled = false;
    const correction = h.correctKey('teacher', exams['race'], question.id, { correctOptionId: question.question.options[2]!.id, reason: 'تصحيح أثناء الإصدار' }).then((res) => {
      settled = true;
      return res;
    });
    // The correction is waiting for the class row: nothing was read as «no certificate» and regraded meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(settled).toBe(false);
    expect(await scoreOf('race')).toBe(10);

    release();
    await issuing;
    const res = await correction;
    expect(res.body).toMatchObject({ statusCode: 409, code: 'grades_certified', classId: h.classes['D'], certificateCount: 1 });
    expect(await scoreOf('race')).toBe(10);
    expect((await snapshotOf(question.id)).corrections).toBeUndefined();
  }, 40_000);
});
