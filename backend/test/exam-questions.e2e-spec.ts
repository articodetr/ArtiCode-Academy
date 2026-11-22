// TEST-282 — MOD-09 phase 2, the online side of an exam: its settings on
// API-113..API-118, its linked questions (API-270/API-271) and the frozen copy
// written at `schedule` — against the live development database. Skipped when
// no database is reachable. Fixtures come from the shared harness (a manager
// with a custom role, two teachers with the system `teacher` role on two
// classes of two courses, a clerk who manages exams without `questions.manage`,
// a student) and are deleted at the end. The attempts of this suite are
// inserted through Prisma — their routes are TEST-283's. Audit events are
// counted by fixture actor above an id watermark.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { available, bootHarness, choiceBody, trueFalseBody } from './online-exams.helpers.js';
import type { Harness } from './online-exams.helpers.js';

interface OnlineBody {
  questionCount: number;
  totalPoints: number;
  frozen: boolean;
  problems: string[];
  attempts: { students: number; inProgress: number; finished: number };
}

interface ExamBody {
  id: string;
  status: string;
  delivery: string;
  scheduledAt: string | null;
  closesAt: string | null;
  durationMinutes: number | null;
  maxScore: number;
  attemptsAllowed: number;
  resultsRelease: string;
  revealAnswers: boolean;
  online: OnlineBody | null;
}

interface ItemBody {
  id: string;
  sortOrder: number;
  points: number;
  questionId: string;
  bank: { id: string; name: { ar: string } };
  question: { type: string; prompt: { ar: string }; explanation: { ar: string } | null; options: { id: string; text: { ar: string }; isCorrect: boolean }[]; correctAnswer: boolean | null; status: string | null };
}

interface QuestionsBody {
  examId: string;
  examStatus: string;
  delivery: string;
  frozen: boolean;
  editable: boolean;
  maxScore: number;
  totalPoints: number;
  problems: string[];
  items: ItemBody[];
}

const QUESTIONS_KEYS = ['delivery', 'editable', 'examId', 'examStatus', 'frozen', 'items', 'maxScore', 'problems', 'totalPoints'];
const ITEM_KEYS = ['bank', 'corrections', 'id', 'points', 'question', 'questionId', 'sortOrder'];
/** A window that is open now, and one that opens next year. */
const OPEN = { scheduledAt: new Date(Date.now() - 60 * 60_000).toISOString(), closesAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(), durationMinutes: 30 };
const LATER = { scheduledAt: '2031-03-01T08:00:00+03:00', closesAt: '2031-03-01T12:00:00+03:00', durationMinutes: 45 };

describe.skipIf(!available)('MOD-09 phase 2 — the questions and settings of an online exam (e2e, TEST-282)', () => {
  let h: Harness;
  const q: Record<string, string> = {};
  const banks: Record<string, string> = {};
  const exams: Record<string, string> = {};

  beforeAll(async () => {
    h = await bootHarness('TEST-282');
    const teacher = await h.systemRole('teacher');
    await h.createUser('manager', [await h.createRole('emanager', ['classes.read', 'classes.manage', 'exams.read', 'exams.manage', 'exams.grade', 'questions.manage'])]);
    await h.createUser('teacher', [teacher]);
    await h.createUser('teacherB', [teacher]);
    // Manages exams everywhere but may not touch the banks.
    await h.createUser('clerk', [await h.createRole('eclerk', ['classes.read', 'classes.manage', 'exams.read', 'exams.manage'])]);
    await h.createUser('student', [await h.systemRole('student')]);
    await h.course('CA');
    await h.course('CB');
    await h.klass('A', 'CA', ['teacher']);
    await h.klass('B', 'CB', ['teacherB']);
    await h.klass('X', 'CA', ['teacher'], 'cancelled');
    await h.enroll('A', 'student');

    banks['a'] = (await h.bank('teacher', { name: { ar: 'بنك الدورة أ' }, courseId: h.courses['CA'] })).id;
    banks['b'] = (await h.bank('teacherB', { name: { ar: 'بنك الدورة ب' }, courseId: h.courses['CB'] })).id;
    q['q1'] = (await h.question('teacher', banks['a']!, choiceBody('ما ناتج print(2 + 3)؟', ['4', '5', '6', '23'], 1, { points: 2, explanation: { ar: 'عملية جمع' } }))).id;
    q['q2'] = (await h.question('teacher', banks['a']!, choiceBody('أي الكلمات تعرّف دالة؟', ['def', 'func', 'lambda'], 0, { points: 2 }))).id;
    q['q3'] = (await h.question('teacher', banks['a']!, trueFalseBody('يمكن استخدام Python لتطوير تطبيقات الويب.', true, { points: 2 }))).id;
    q['q4'] = (await h.question('teacher', banks['a']!, trueFalseBody('القوائم في Python غير قابلة للتعديل.', false, { points: 2 }))).id;
    q['q5'] = (await h.question('teacher', banks['a']!, choiceBody('ما نوع القيمة 3.14؟', ['int', 'float', 'str'], 1, { points: 2 }))).id;
    q['draft'] = (await h.question('teacher', banks['a']!, { type: 'single_choice', status: 'draft', prompt: { ar: 'سؤال غير مكتمل' } })).id;
    q['foreign'] = (await h.question('teacherB', banks['b']!, trueFalseBody('سؤال من بنك دورة أخرى', true))).id;
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  const base = (over: Record<string, unknown> = {}) => ({ title: { ar: 'اختبار قصير' }, type: 'quiz', maxScore: 10, ...over });
  const five = () => ['q1', 'q2', 'q3', 'q4', 'q5'].map((name) => ({ questionId: q[name]! }));
  const questionsOf = async (user: string, examId: string) => (await h.readQuestions(user, examId).expect(200)).body as QuestionsBody;
  const examOf = async (user: string, examId: string) => (await h.readExam(user, examId).expect(200)).body as ExamBody;

  it('AC1 — a manual exam goes through its whole life as before, and carries no online setting', async () => {
    const m = await h.mark();
    const created = await h.createExam('teacher', 'A', base({ scheduledAt: '2031-02-01T10:00:00+03:00', durationMinutes: 40 }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const manual = created.body as ExamBody;
    exams['manual'] = manual.id;
    expect(manual).toMatchObject({ delivery: 'manual', closesAt: null, attemptsAllowed: 1, resultsRelease: 'on_publish', revealAnswers: false, online: null });

    // The first phase's routes, untouched: schedule → record a result → publish → unpublish.
    expect((await h.act('teacher', manual.id, 'schedule')).body).toMatchObject({ status: 'scheduled', delivery: 'manual', online: null });
    const sheet = await h.api().put(`${h.EXAMS}/${manual.id}/results`).set(h.as('teacher')).send({ results: [{ studentId: h.id('student'), status: 'scored', score: 8 }] });
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(200);
    expect((await h.act('teacher', manual.id, 'publish')).body).toMatchObject({ status: 'published' });
    expect((await h.act('teacher', manual.id, 'unpublish')).body).toMatchObject({ status: 'scheduled' });
    const events = await h.eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(['exams.created', 'exams.status.changed', 'exams.results.recorded', 'exams.status.changed', 'exams.status.changed']);
    // The creation event of a manual exam says what it always said.
    expect(events[0]!.metadata).toEqual({ classId: h.classes['A'], code: h.code('A'), type: 'quiz' });

    // Nothing online sticks to it.
    const refused = await h.mark();
    for (const [field, value] of [['closesAt', '2031-02-01T12:00:00+03:00'], ['attemptsAllowed', 2], ['resultsRelease', 'on_submit'], ['revealAnswers', true]] as const) {
      expect((await h.patchExam('teacher', manual.id, { [field]: value })).body, field).toMatchObject({ statusCode: 400, code: 'online_settings_not_allowed', fields: [field] });
      expect((await h.createExam('teacher', 'A', base({ [field]: value }))).body, field).toMatchObject({ statusCode: 400, code: 'online_settings_not_allowed', fields: [field] });
    }
    // The defaults are not a change, and the delivery is fixed outside a draft.
    expect((await h.patchExam('teacher', manual.id, { closesAt: null, attemptsAllowed: 1, resultsRelease: 'on_publish', revealAnswers: false, delivery: 'manual' })).status).toBe(200);
    expect((await h.patchExam('teacher', manual.id, { delivery: 'online' })).body).toMatchObject({ statusCode: 409, code: 'exam_locked', fields: ['delivery'] });
    // It asks no question, and takes none.
    expect(await questionsOf('teacher', manual.id)).toMatchObject({ delivery: 'manual', frozen: true, editable: false, items: [], problems: [], totalPoints: 0 });
    expect((await h.link('teacher', manual.id, five())).body).toMatchObject({ statusCode: 409, code: 'exam_not_online' });
    expect(await h.eventsSince(refused)).toEqual([]);
  });

  it('AC2 — an exam is created online or turned online in a draft, with its window, attempts and release settings', async () => {
    const m = await h.mark();
    const created = await h.createExam('teacher', 'A', base({ delivery: 'online', ...LATER, attemptsAllowed: 2, resultsRelease: 'on_submit', revealAnswers: true, passScore: 6 }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const online = created.body as ExamBody;
    exams['later'] = online.id;
    expect(online).toMatchObject({
      status: 'draft',
      delivery: 'online',
      scheduledAt: '2031-03-01T05:00:00.000Z',
      closesAt: '2031-03-01T09:00:00.000Z',
      durationMinutes: 45,
      attemptsAllowed: 2,
      resultsRelease: 'on_submit',
      revealAnswers: true,
      online: { questionCount: 0, totalPoints: 0, frozen: false, problems: ['no_questions'], attempts: { students: 0, inProgress: 0, finished: 0 } },
    });

    // A plain draft becomes online with one PATCH; the settings may come with it or later.
    exams['main'] = ((await h.createExam('teacher', 'A', base()).expect(201)).body as ExamBody).id;
    const turned = await h.patchExam('teacher', exams['main']!, { delivery: 'online' });
    expect(turned.body).toMatchObject({ delivery: 'online', closesAt: null, attemptsAllowed: 1, online: { questionCount: 0, problems: ['no_questions', 'window_missing', 'duration_missing'] } });
    const events = await h.eventsSince(m);
    expect(events.map((event) => [event.action, event.metadata])).toEqual([
      ['exams.created', { classId: h.classes['A'], code: h.code('A'), type: 'quiz', delivery: 'online' }],
      ['exams.created', { classId: h.classes['A'], code: h.code('A'), type: 'quiz' }],
      ['exams.updated', { classId: h.classes['A'], code: h.code('A'), fields: ['delivery'] }],
    ]);

    // The window must close after it opens — at creation and after a PATCH merge.
    const refused = await h.mark();
    expect((await h.createExam('teacher', 'A', base({ delivery: 'online', scheduledAt: LATER.closesAt, closesAt: LATER.scheduledAt }))).body).toMatchObject({ statusCode: 400, code: 'window_invalid' });
    expect((await h.patchExam('teacher', exams['later']!, { closesAt: LATER.scheduledAt })).body).toMatchObject({ statusCode: 400, code: 'window_invalid', opensAt: '2031-03-01T05:00:00.000Z', closesAt: '2031-03-01T05:00:00.000Z' });
    expect((await h.patchExam('teacher', exams['later']!, { scheduledAt: '2031-03-01T12:00:00+03:00' })).body).toMatchObject({ statusCode: 400, code: 'window_invalid' });
    for (const body of [{ attemptsAllowed: 0 }, { attemptsAllowed: 21 }, { attemptsAllowed: '2' }, { attemptsAllowed: null }, { resultsRelease: 'never' }, { revealAnswers: 'yes' }, { delivery: 'hybrid' }, { closesAt: '2031-03-01' }]) {
      expect((await h.patchExam('teacher', exams['later']!, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await h.eventsSince(refused)).toEqual([]);

    // The list filters by delivery.
    const list = async (delivery: string) => ((await h.api().get(h.EXAMS).query({ classId: h.classes['A']!, delivery }).set(h.as('teacher')).expect(200)).body.items as ExamBody[]).map((item) => item.id);
    expect((await list('online')).sort()).toEqual([exams['later'], exams['main']].sort());
    expect(await list('manual')).toEqual([exams['manual']]);
    expect((await h.api().get(h.EXAMS).query({ delivery: 'x' }).set(h.as('teacher'))).status).toBe(400);
  });

  it('AC3 — links ready questions of a visible bank in order, with their own points or others; every refusal comes before any write', async () => {
    const examId = exams['main']!;
    const m = await h.mark();
    const res = await h.link('teacher', examId, [{ questionId: q['q1']! }, { questionId: q['q3']!, points: 3 }]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as QuestionsBody;
    expect(Object.keys(body).sort()).toEqual(QUESTIONS_KEYS);
    expect(Object.keys(body.items[0]!).sort()).toEqual(ITEM_KEYS);
    expect(body).toMatchObject({ examId, examStatus: 'draft', delivery: 'online', frozen: false, editable: true, maxScore: 10, totalPoints: 5, problems: ['points_mismatch', 'window_missing', 'duration_missing'] });
    expect(body.items.map((item) => [item.sortOrder, item.questionId, item.points])).toEqual([[0, q['q1'], 2], [1, q['q3'], 3]]);
    // The teacher's view carries the key: the bank's content while the exam is a draft.
    expect(body.items[0]).toMatchObject({ bank: { id: banks['a'], name: { ar: 'بنك الدورة أ' } }, question: { type: 'single_choice', status: 'ready', correctAnswer: null, explanation: { ar: 'عملية جمع' } } });
    expect(body.items[0]!.question.options.map((option) => [option.text.ar, option.isCorrect])).toEqual([['4', false], ['5', true], ['6', false], ['23', false]]);
    expect(body.items[1]!.question).toMatchObject({ type: 'true_false', options: [], correctAnswer: true });
    expect((await h.eventsSince(m)).map((event) => [event.action, event.entityType, event.entityId, event.metadata])).toEqual([
      ['exams.questions.changed', 'exams', examId, { classId: h.classes['A'], code: h.code('A'), added: 2, removed: 0, repointed: 0, reordered: false, count: 2, totalPoints: 5 }],
    ]);

    // The whole list again: the same one writes nothing; another order, other points, more and fewer questions are one event each.
    const quiet = await h.mark();
    expect((await h.link('teacher', examId, [{ questionId: q['q1']!, points: 2 }, { questionId: q['q3']!, points: 3 }])).status).toBe(200);
    expect(await h.eventsSince(quiet)).toEqual([]);
    const moved = await h.mark();
    const next = await h.link('teacher', examId, [{ questionId: q['q3']! }, { questionId: q['q1']! }, { questionId: q['q2']! }]);
    expect((next.body as QuestionsBody).items.map((item) => [item.questionId, item.points])).toEqual([[q['q3'], 2], [q['q1'], 2], [q['q2'], 2]]);
    expect((await h.eventsSince(moved)).map((event) => event.metadata)).toEqual([{ classId: h.classes['A'], code: h.code('A'), added: 1, removed: 0, repointed: 1, reordered: true, count: 3, totalPoints: 6 }]);

    // Refusals.
    const refused = await h.mark();
    expect((await h.link('teacher', examId, [{ questionId: q['q1']! }, { questionId: q['q2']! }, { questionId: q['q1']! }])).body).toMatchObject({ statusCode: 400, code: 'exam_questions_invalid', duplicates: [q['q1']] });
    expect((await h.link('teacher', examId, [{ questionId: q['q1']! }, { questionId: q['foreign']! }])).body).toMatchObject({ statusCode: 404, code: 'question_not_found', questionIds: [q['foreign']] });
    expect((await h.link('teacher', examId, [{ questionId: '00000000-0000-7000-8000-000000000001' }])).body).toMatchObject({ statusCode: 404, code: 'question_not_found' });
    expect((await h.link('teacher', examId, [{ questionId: q['q1']! }, { questionId: q['draft']! }])).body).toMatchObject({ statusCode: 422, code: 'question_not_ready', questionIds: [q['draft']] });
    for (const entry of [{ questionId: 'x' }, { questionId: q['q1'], points: 0 }, { questionId: q['q1'], points: '2' }, { questionId: q['q1'], points: 1.234 }]) {
      expect((await h.link('teacher', examId, [entry as { questionId: string }])).status, JSON.stringify(entry)).toBe(400);
    }
    expect((await h.api().put(`${h.EXAMS}/${examId}/questions`).set(h.as('teacher')).send({})).status).toBe(400);
    // Both keys are needed, and the class visibility on top of them.
    expect((await h.link('clerk', examId, five())).body).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['questions.manage'] });
    expect((await h.link('student', examId, five())).status).toBe(403);
    expect((await h.link('teacherB', examId, [{ questionId: q['foreign']! }])).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    // The manager sees every bank, so the foreign question is theirs to link — but not for a cancelled class.
    const frozenClass = await h.prisma.exam.create({ data: { classId: h.classes['X']!, title: { ar: 'اختبار فصل ملغى' }, type: 'quiz', maxScore: '10.00', delivery: 'online' }, select: { id: true } });
    expect((await h.link('manager', frozenClass.id, five())).body).toMatchObject({ statusCode: 409, code: 'class_closed' });
    expect(await h.eventsSince(refused)).toEqual([]);
    expect((await questionsOf('teacher', examId)).items).toHaveLength(3);

    // Reading follows the class: the clerk reads (exams.read + classes.manage); a learner and another class's teacher get 404.
    expect((await h.readQuestions('clerk', examId)).status).toBe(200);
    expect((await h.readQuestions('student', examId)).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    expect((await h.readQuestions('teacherB', examId)).body).toMatchObject({ statusCode: 404, code: 'exam_not_found' });
    expect((await h.api().get(`${h.EXAMS}/${examId}/questions`)).status).toBe(401);
  });

  it('AC4 — schedule refuses an online exam that is not ready and names everything it lacks (D-R159)', async () => {
    const examId = exams['main']!;
    const notReady = async (problems: string[], detail: Record<string, unknown> = {}) => {
      const res = await h.act('teacher', examId, 'schedule');
      expect(res.body, JSON.stringify(res.body)).toMatchObject({ statusCode: 409, code: 'exam_not_ready', problems, ...detail });
    };
    const m = await h.mark();
    // Three questions worth 6 of 10, no window, no time limit.
    await notReady(['points_mismatch', 'window_missing', 'duration_missing'], { totalPoints: 6, maxScore: 10, questionIds: [] });
    await h.link('teacher', examId, []).expect(200);
    await notReady(['no_questions', 'window_missing', 'duration_missing'], { totalPoints: 0 });
    await h.patchExam('teacher', examId, OPEN).expect(200);
    await notReady(['no_questions']);
    await h.link('teacher', examId, five()).expect(200);
    // A linked question that stops being ready blocks the exam, and is named.
    await h.api().patch(`${h.QUESTIONS}/${q['q5']}`).set(h.as('teacher')).send({ status: 'draft' }).expect(200);
    await notReady(['questions_not_ready'], { questionIds: [q['q5']] });
    expect((await examOf('teacher', examId)).online).toMatchObject({ questionCount: 5, totalPoints: 10, problems: ['questions_not_ready'] });
    await h.api().patch(`${h.QUESTIONS}/${q['q5']}`).set(h.as('teacher')).send({ status: 'ready' }).expect(200);
    // A window that has already closed.
    await h.patchExam('teacher', examId, { scheduledAt: '2020-01-01T08:00:00Z', closesAt: '2020-01-01T10:00:00Z' }).expect(200);
    await notReady(['window_closed']);
    await h.patchExam('teacher', examId, { scheduledAt: OPEN.scheduledAt, closesAt: OPEN.closesAt }).expect(200);
    // The refusals wrote nothing: the status never moved and no status event exists.
    expect((await h.eventsSince(m)).filter((event) => event.action === 'exams.status.changed')).toEqual([]);
    expect(await examOf('teacher', examId)).toMatchObject({ status: 'draft', online: { questionCount: 5, totalPoints: 10, frozen: false, problems: [] } });
  });

  it('AC5 — schedule freezes a full copy of every question; editing or archiving the bank question afterwards changes nothing (D-R158)', async () => {
    const examId = exams['main']!;
    const m = await h.mark();
    const scheduled = await h.act('teacher', examId, 'schedule');
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(200);
    expect(scheduled.body).toMatchObject({ status: 'scheduled', online: { questionCount: 5, totalPoints: 10, frozen: true, problems: [] } });
    expect((await h.eventsSince(m)).map((event) => event.action)).toEqual(['exams.status.changed']);

    const frozen = await questionsOf('teacher', examId);
    expect(frozen).toMatchObject({ examStatus: 'scheduled', frozen: true, editable: false, totalPoints: 10, problems: [] });
    expect(frozen.items.map((item) => item.question.status)).toEqual([null, null, null, null, null]);
    const stored = await h.prisma.examQuestion.findMany({ where: { examId }, orderBy: { sortOrder: 'asc' }, select: { snapshot: true } });
    expect(stored.every((row) => row.snapshot !== null)).toBe(true);
    expect(stored[0]!.snapshot).toMatchObject({ type: 'single_choice', prompt: { ar: 'ما ناتج print(2 + 3)؟' }, explanation: { ar: 'عملية جمع' }, correctBoolean: null });
    expect(stored[2]!.snapshot).toMatchObject({ type: 'true_false', options: [], correctBoolean: true });

    // The set is locked now.
    const locked = await h.mark();
    expect((await h.link('teacher', examId, [])).body).toMatchObject({ statusCode: 409, code: 'exam_questions_locked', status: 'scheduled' });
    expect(await h.eventsSince(locked)).toEqual([]);

    // The teacher rewrites the first question in the bank — text, options and key — flips the true/false key and archives another.
    await h.api().patch(`${h.QUESTIONS}/${q['q1']}`).set(h.as('teacher')).send({ prompt: { ar: 'سؤال آخر تماماً' }, options: [{ text: { ar: 'جديد أ' }, isCorrect: true }, { text: { ar: 'جديد ب' }, isCorrect: false }], explanation: null }).expect(200);
    await h.api().patch(`${h.QUESTIONS}/${q['q3']}`).set(h.as('teacher')).send({ correctAnswer: false }).expect(200);
    await h.api().patch(`${h.QUESTIONS}/${q['q2']}`).set(h.as('teacher')).send({ status: 'archived' }).expect(200);
    expect(await questionsOf('teacher', examId)).toEqual(frozen);
    // A linked question cannot be deleted, nor its bank.
    expect((await h.api().delete(`${h.QUESTIONS}/${q['q1']}`).set(h.as('teacher'))).body).toMatchObject({ statusCode: 409, code: 'question_in_use', examCount: 1 });
    expect((await h.api().delete(`${h.BANKS}/${banks['a']}`).set(h.as('teacher'))).body).toMatchObject({ statusCode: 409, code: 'question_bank_in_use' });
  });

  it('AC6 — once the learners see an online exam its maximum is frozen and its window stays whole; unschedule (without attempts) follows the bank again', async () => {
    const examId = exams['main']!;
    const refused = await h.mark();
    expect((await h.patchExam('teacher', examId, { maxScore: 20 })).body).toMatchObject({ statusCode: 409, code: 'exam_locked', status: 'scheduled', fields: ['maxScore'], resultCount: 0, attemptCount: 0 });
    expect((await h.patchExam('teacher', examId, { delivery: 'manual' })).body).toMatchObject({ statusCode: 409, code: 'exam_locked', fields: ['delivery'] });
    expect((await h.patchExam('teacher', examId, { scheduledAt: null, closesAt: null, durationMinutes: null })).body).toMatchObject({ statusCode: 409, code: 'exam_locked', fields: ['scheduledAt', 'closesAt', 'durationMinutes'] });
    expect(await h.eventsSince(refused)).toEqual([]);
    // Without an attempt the window, the limit, the attempts and the release settings still move.
    const moved = await h.patchExam('teacher', examId, { durationMinutes: 20, attemptsAllowed: 2, resultsRelease: 'on_submit', revealAnswers: true });
    expect(moved.body).toMatchObject({ durationMinutes: 20, attemptsAllowed: 2, resultsRelease: 'on_submit', revealAnswers: true });

    // Back to a draft: the copies go, the exam shows the bank as it is now — the rewritten question, the flipped key, the archived one.
    const m = await h.mark();
    expect((await h.act('teacher', examId, 'unschedule')).body).toMatchObject({ status: 'draft', online: { frozen: false, problems: ['questions_not_ready'] } });
    expect((await h.eventsSince(m)).map((event) => event.action)).toEqual(['exams.status.changed']);
    const thawed = await questionsOf('teacher', examId);
    expect(thawed).toMatchObject({ frozen: false, editable: true, problems: ['questions_not_ready'] });
    expect(thawed.items[0]!.question).toMatchObject({ prompt: { ar: 'سؤال آخر تماماً' }, explanation: null, status: 'ready' });
    expect(thawed.items[0]!.question.options.map((option) => option.text.ar)).toEqual(['جديد أ', 'جديد ب']);
    expect(thawed.items[1]!.question.status).toBe('archived');
    expect(thawed.items[2]!.question.correctAnswer).toBe(false);
    expect((await h.prisma.examQuestion.findMany({ where: { examId }, select: { snapshot: true } })).every((row) => row.snapshot === null)).toBe(true);
    // Ready again, and scheduled again with the content of now.
    await h.api().patch(`${h.QUESTIONS}/${q['q2']}`).set(h.as('teacher')).send({ status: 'ready' }).expect(200);
    await h.act('teacher', examId, 'schedule').expect(200);
    expect((await questionsOf('teacher', examId)).items[0]!.question.prompt).toEqual({ ar: 'سؤال آخر تماماً' });
  });

  it('AC7 — once somebody has started: no unschedule, no deletion, the opening and the limit are fixed, the window only moves later and the attempts only rise', async () => {
    const examId = exams['main']!;
    const startedAt = new Date();
    await h.prisma.examAttempt.create({
      data: { examId, studentUserId: h.id('student'), attemptNo: 1, startedAt, expiresAt: new Date(startedAt.getTime() + 20 * 60_000), maxScore: '10.00', questionCount: 5 },
      select: { id: true },
    });
    expect((await examOf('teacher', examId)).online).toMatchObject({ attempts: { students: 1, inProgress: 1, finished: 0 } });

    const refused = await h.mark();
    expect((await h.act('teacher', examId, 'unschedule')).body).toMatchObject({ statusCode: 409, code: 'exam_has_attempts', action: 'unschedule', attemptCount: 1 });
    expect((await h.api().delete(`${h.EXAMS}/${examId}`).set(h.as('teacher'))).body).toMatchObject({ statusCode: 409, code: 'exam_not_deletable', status: 'scheduled', resultCount: 0, attemptCount: 1 });
    const locked = await h.patchExam('teacher', examId, { scheduledAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), durationMinutes: 90, attemptsAllowed: 1, closesAt: new Date(Date.now() + 60 * 60_000).toISOString() });
    expect(locked.body).toMatchObject({ statusCode: 409, code: 'exam_locked', fields: ['scheduledAt', 'closesAt', 'durationMinutes', 'attemptsAllowed'], attemptCount: 1 });
    // The results are published after the window has closed.
    expect((await h.act('teacher', examId, 'publish')).body).toMatchObject({ statusCode: 409, code: 'exam_window_open', closesAt: OPEN.closesAt });
    expect(await h.eventsSince(refused)).toEqual([]);

    // Extending the window, raising the attempts and changing the release settings stay possible.
    const later = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
    const m = await h.mark();
    expect((await h.patchExam('teacher', examId, { closesAt: later, attemptsAllowed: 3, revealAnswers: false })).body).toMatchObject({ closesAt: later, attemptsAllowed: 3, revealAnswers: false });
    expect((await h.eventsSince(m)).map((event) => event.metadata)).toEqual([{ classId: h.classes['A'], code: h.code('A'), fields: ['closesAt', 'attemptsAllowed', 'revealAnswers'] }]);
  });

  it('AC8 — the results of an online exam are published once its window has closed; an online draft turned manual drops its questions', async () => {
    // A second online exam whose window has closed (moved into the past directly — the API would not schedule a closed window).
    const created = (await h.createExam('teacher', 'A', base({ delivery: 'online', ...OPEN, maxScore: 4 })).expect(201)).body as ExamBody;
    exams['closed'] = created.id;
    await h.link('teacher', created.id, [{ questionId: q['q4']! }, { questionId: q['q5']! }]).expect(200);
    await h.act('teacher', created.id, 'schedule').expect(200);
    expect((await h.act('teacher', created.id, 'publish')).body).toMatchObject({ statusCode: 409, code: 'exam_window_open' });
    await h.prisma.exam.update({ where: { id: created.id }, data: { scheduledAt: new Date(Date.now() - 3 * 60 * 60_000), closesAt: new Date(Date.now() - 60 * 60_000) } });
    const m = await h.mark();
    expect((await h.act('teacher', created.id, 'publish')).body).toMatchObject({ status: 'published', online: { frozen: true } });
    expect((await h.act('teacher', created.id, 'unpublish')).body).toMatchObject({ status: 'scheduled' });
    expect((await h.eventsSince(m)).map((event) => event.action)).toEqual(['exams.status.changed', 'exams.status.changed']);
    // A scheduled online exam without attempts is still deletable, with its links.
    await h.api().delete(`${h.EXAMS}/${created.id}`).set(h.as('teacher')).expect(204);
    expect(await h.prisma.examQuestion.count({ where: { examId: created.id } })).toBe(0);

    // The draft with its settings and two linked questions goes back to manual in one PATCH.
    const draftId = exams['later']!;
    await h.link('teacher', draftId, [{ questionId: q['q4']! }, { questionId: q['q5']! }]).expect(200);
    const back = await h.mark();
    const manual = await h.patchExam('teacher', draftId, { delivery: 'manual' });
    expect(manual.body).toMatchObject({ delivery: 'manual', closesAt: null, attemptsAllowed: 1, resultsRelease: 'on_publish', revealAnswers: false, online: null, scheduledAt: '2031-03-01T05:00:00.000Z', durationMinutes: 45 });
    expect((await h.eventsSince(back)).map((event) => [event.action, event.metadata])).toEqual([
      ['exams.updated', { classId: h.classes['A'], code: h.code('A'), fields: ['delivery', 'closesAt', 'attemptsAllowed', 'resultsRelease', 'revealAnswers'], unlinkedQuestions: 2 }],
    ]);
    expect(await h.prisma.examQuestion.count({ where: { examId: draftId } })).toBe(0);
    // Turning it manual and naming an online setting in the same body is refused.
    await h.patchExam('teacher', draftId, { delivery: 'online', closesAt: LATER.closesAt }).expect(200);
    expect((await h.patchExam('teacher', draftId, { delivery: 'manual', attemptsAllowed: 3 })).body).toMatchObject({ statusCode: 400, code: 'online_settings_not_allowed', fields: ['attemptsAllowed'] });
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = { body: await h.openApiDocument() };
      expect(Object.keys(docs.body.paths['/api/exams/{id}/questions']).sort()).toEqual(['get', 'put']);
      const exam = docs.body.components.schemas.ExamDto.properties;
      for (const field of ['delivery', 'closesAt', 'attemptsAllowed', 'resultsRelease', 'revealAnswers', 'online']) expect(exam[field], field).toBeDefined();
      expect(exam.delivery.enum).toEqual(['manual', 'online']);
    },
    20_000,
  );

  it('answers a null where a value is expected, and a nested array of questions, with 400 — never a server error', async () => {
    const created = await h.createExam('teacher', 'A', base({ delivery: 'online' }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const examId = created.body.id as string;
    const m = await h.mark();
    const put = (questions: unknown) => h.api().put(`${h.EXAMS}/${examId}/questions`).set(h.as('teacher')).send({ questions });
    expect((await put([{ questionId: q['q1'], points: null }])).status).toBe(400);
    expect((await put([[{ questionId: q['q1'] }]])).status).toBe(400);
    expect((await put(null)).status).toBe(400);
    for (const field of ['delivery', 'attemptsAllowed', 'resultsRelease', 'revealAnswers']) {
      expect((await h.createExam('teacher', 'A', base({ delivery: 'online', [field]: null }))).status, field).toBe(400);
    }
    // A manual exam whose body names `delivery: null` is refused the same way instead of failing in the database.
    expect((await h.createExam('teacher', 'A', base({ delivery: null }))).status).toBe(400);
    expect(await h.prisma.examQuestion.count({ where: { examId } })).toBe(0);
    expect(await h.eventsSince(m)).toEqual([]);
    // The same entry without the null takes the question's own points.
    expect((await put([{ questionId: q['q1'] }])).body).toMatchObject({ totalPoints: 2 });
  });
});
