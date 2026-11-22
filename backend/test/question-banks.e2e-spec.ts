// TEST-281 — MOD-09 phase 2, question banks and their questions (API-260..API-269)
// against the live development database. Skipped when no database is
// reachable. Fixtures (a manager whose custom role holds `questions.manage`
// and `classes.manage`, three teachers with the system `teacher` role — two of
// them teaching the same course —, a clerk without `questions.manage`, a
// student, two courses, their classes) come from the shared harness and are
// deleted at the end. Audit events are counted by fixture actor above an id
// watermark: exactly one per effective write, none on a refusal or a no-diff.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { available, bootHarness, choiceBody, trueFalseBody } from './online-exams.helpers.js';
import type { Harness } from './online-exams.helpers.js';

interface BankBody {
  id: string;
  name: { ar: string; en?: string };
  description: { ar: string } | null;
  course: { id: string; code: string } | null;
  createdBy: { userId: string; fullName: string } | null;
  questionCount: number;
  readyCount: number;
}

interface QuestionBody {
  id: string;
  bankId: string;
  type: string;
  status: string;
  prompt: { ar: string; en?: string };
  explanation: { ar: string } | null;
  points: number;
  difficulty: string | null;
  tags: string[];
  options: { id: string; text: { ar: string }; isCorrect: boolean }[];
  correctAnswer: boolean | null;
  missing: string[];
  examCount: number;
}

const BANK_KEYS = ['course', 'createdAt', 'createdBy', 'description', 'id', 'name', 'questionCount', 'readyCount', 'updatedAt'];
const QUESTION_KEYS = ['bankId', 'correctAnswer', 'createdAt', 'createdBy', 'difficulty', 'examCount', 'explanation', 'id', 'missing', 'options', 'points', 'prompt', 'status', 'tags', 'type', 'updatedAt'];

describe.skipIf(!available)('MOD-09 phase 2 — question banks (e2e, TEST-281)', () => {
  let h: Harness;
  const banks: Record<string, string> = {};
  const questions: Record<string, string> = {};

  beforeAll(async () => {
    h = await bootHarness('TEST-281');
    const teacher = await h.systemRole('teacher');
    await h.createUser('manager', [await h.createRole('qmanager', ['questions.manage', 'classes.read', 'classes.manage', 'exams.read', 'exams.manage'])]);
    await h.createUser('teacherA', [teacher]);
    await h.createUser('teacherA2', [teacher]);
    await h.createUser('teacherB', [teacher]);
    await h.createUser('clerk', [await h.createRole('qclerk', ['classes.read', 'classes.manage', 'exams.read', 'exams.manage'])]);
    await h.createUser('student', [await h.systemRole('student')]);
    await h.course('CA');
    await h.course('CB');
    await h.klass('A1', 'CA', ['teacherA', 'teacherA2']);
    await h.klass('B1', 'CB', ['teacherB']);
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  const listBanks = (user: string, query: Record<string, string> = {}) => h.api().get(h.BANKS).query(query).set(h.as(user));
  const listQuestions = (user: string, query: Record<string, string> = {}) => h.api().get(h.QUESTIONS).query(query).set(h.as(user));
  const bankIds = async (user: string, query: Record<string, string> = {}) => ((await listBanks(user, query).expect(200)).body.items as BankBody[]).map((item) => item.id);
  const mine = (ids: string[]) => ids.filter((id) => Object.values(banks).includes(id));

  it('AC1 — a holder of questions.manage creates a bank, filed under no course or under one they teach; others cannot', async () => {
    const m = await h.mark();
    const res = await h.api().post(h.BANKS).set(h.as('teacherA')).send({ name: { ar: 'بنك بايثون', en: 'Python bank' }, description: { ar: 'أسئلة الفصل الأول' }, courseId: h.courses['CA'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = res.body as BankBody;
    expect(Object.keys(body).sort()).toEqual(BANK_KEYS);
    expect(body).toMatchObject({
      name: { ar: 'بنك بايثون', en: 'Python bank' },
      description: { ar: 'أسئلة الفصل الأول' },
      course: { id: h.courses['CA'], code: h.code('CA') },
      createdBy: { userId: h.id('teacherA'), fullName: 'Test teacherA' },
      questionCount: 0,
      readyCount: 0,
    });
    banks['courseA'] = body.id;
    banks['private'] = (await h.bank('teacherA', { name: { ar: 'بنكي الخاص' } })).id;
    banks['courseB'] = (await h.bank('teacherB', { name: { ar: 'بنك الدورة ب' }, courseId: h.courses['CB'] })).id;
    banks['office'] = (await h.bank('manager', { name: { ar: 'بنك الإدارة' }, courseId: h.courses['CB'] })).id;
    const created = await h.eventsSince(m);
    expect(created.map((event) => [event.action, event.entityType, event.entityId])).toEqual([
      ['question_banks.created', 'question_banks', banks['courseA']],
      ['question_banks.created', 'question_banks', banks['private']],
      ['question_banks.created', 'question_banks', banks['courseB']],
      ['question_banks.created', 'question_banks', banks['office']],
    ]);
    expect(created[0]!.metadata).toEqual({ courseId: h.courses['CA'] });
    expect(created[1]!.metadata).toEqual({ courseId: null });

    // Refusals write nothing: a course the teacher does not teach, an unknown course, a missing key, a body without `ar`.
    const refused = await h.mark();
    expect((await h.api().post(h.BANKS).set(h.as('teacherA')).send({ name: { ar: 'بنك' }, courseId: h.courses['CB'] })).body).toMatchObject({ statusCode: 404, code: 'course_not_found', courseId: h.courses['CB'] });
    expect((await h.api().post(h.BANKS).set(h.as('manager')).send({ name: { ar: 'بنك' }, courseId: '00000000-0000-7000-8000-000000000000' })).body).toMatchObject({ code: 'course_not_found' });
    expect((await h.api().post(h.BANKS).set(h.as('clerk')).send({ name: { ar: 'بنك' } })).body).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['questions.manage'] });
    expect((await h.api().post(h.BANKS).set(h.as('student')).send({ name: { ar: 'بنك' } })).status).toBe(403);
    expect((await h.api().post(h.BANKS).set(h.as('teacherA')).send({ name: { en: 'Bank' } })).status).toBe(400);
    expect((await h.api().post(h.BANKS).set(h.as('teacherA')).send({ name: { ar: 'بنك' }, owner: h.id('teacherB') })).status).toBe(400);
    expect((await h.api().post(h.BANKS).send({ name: { ar: 'بنك' } })).status).toBe(401);
    expect(await h.eventsSince(refused)).toEqual([]);
  });

  it('AC2 — a bank is seen by its author, by the teachers of its course and by classes.manage; anyone else gets 404 (D-R162)', async () => {
    // The author and the co-teacher of the same course share the course bank; the private one is the author's alone.
    expect(mine(await bankIds('teacherA'))).toEqual([banks['private'], banks['courseA']]);
    expect(mine(await bankIds('teacherA2'))).toEqual([banks['courseA']]);
    // A teacher of course B sees the banks filed under it, whoever created them.
    expect(mine(await bankIds('teacherB'))).toEqual([banks['office'], banks['courseB']]);
    expect(mine(await bankIds('manager'))).toEqual([banks['office'], banks['courseB'], banks['private'], banks['courseA']]);

    const read = (user: string, bank: string) => h.api().get(`${h.BANKS}/${banks[bank]}`).set(h.as(user));
    expect((await read('teacherA2', 'courseA')).status).toBe(200);
    expect((await read('teacherA2', 'private')).body).toMatchObject({ statusCode: 404, code: 'question_bank_not_found' });
    expect((await read('teacherB', 'courseA')).body).toMatchObject({ statusCode: 404, code: 'question_bank_not_found' });
    expect((await read('manager', 'private')).status).toBe(200);
    expect((await read('clerk', 'courseA')).status).toBe(403);
    expect((await read('student', 'courseA')).status).toBe(403);

    // Filters: a course, no course, the name in Arabic or English with `%` and `_` literal.
    expect(mine(await bankIds('manager', { courseId: h.courses['CB']! }))).toEqual([banks['office'], banks['courseB']]);
    expect(mine(await bankIds('manager', { courseId: 'none' }))).toEqual([banks['private']]);
    expect(mine(await bankIds('manager', { q: 'python' }))).toEqual([banks['courseA']]);
    expect(mine(await bankIds('manager', { q: 'الخاص' }))).toEqual([banks['private']]);
    expect(mine(await bankIds('manager', { q: '%' }))).toEqual([]);
    expect((await listBanks('manager', { courseId: 'x' })).status).toBe(400);
    expect((await listBanks('manager', { cursor: 'not-a-cursor' })).body).toMatchObject({ statusCode: 400, code: 'cursor_invalid' });

    // Keyset pages, newest first.
    const first = await listBanks('manager', { limit: '1' }).expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(typeof first.body.nextCursor).toBe('string');
    const second = await listBanks('manager', { limit: '1', cursor: first.body.nextCursor as string }).expect(200);
    expect((second.body.items as BankBody[])[0]!.id).not.toBe((first.body.items as BankBody[])[0]!.id);
    expect((second.body.items as BankBody[])[0]!.id < (first.body.items as BankBody[])[0]!.id).toBe(true);
  });

  it('AC3 — PATCH writes the smallest change with one event; an identical body writes nothing; the course must be one the caller may file under', async () => {
    const patch = (user: string, bank: string, body: object) => h.api().patch(`${h.BANKS}/${banks[bank]}`).set(h.as(user)).send(body);
    const m = await h.mark();
    const res = await patch('teacherA2', 'courseA', { name: { ar: 'بنك بايثون', en: 'Python bank' }, description: null });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ description: null, name: { ar: 'بنك بايثون', en: 'Python bank' } });
    const events = await h.eventsSince(m);
    expect(events.map((event) => [event.action, event.actorUserId, event.metadata])).toEqual([['question_banks.updated', h.id('teacherA2'), { fields: ['description'] }]]);

    const quiet = await h.mark();
    expect((await patch('teacherA', 'courseA', { name: { ar: 'بنك بايثون', en: 'Python bank' }, description: null, courseId: h.courses['CA'] })).status).toBe(200);
    expect((await patch('teacherA', 'courseA', {})).body).toMatchObject({ statusCode: 400, code: 'nothing_to_update' });
    expect((await patch('teacherA', 'courseA', { name: null })).status).toBe(400);
    expect((await patch('teacherA', 'courseA', { courseId: h.courses['CB'] })).body).toMatchObject({ statusCode: 404, code: 'course_not_found' });
    expect((await patch('teacherB', 'courseA', { name: { ar: 'اختراق' } })).body).toMatchObject({ statusCode: 404, code: 'question_bank_not_found' });
    expect((await patch('clerk', 'courseA', { name: { ar: 'اختراق' } })).status).toBe(403);
    expect(await h.eventsSince(quiet)).toEqual([]);

    // Unfiling a bank keeps it for its author alone; filing it again shares it again.
    await patch('teacherA', 'courseA', { courseId: null }).expect(200);
    expect((await h.api().get(`${h.BANKS}/${banks['courseA']}`).set(h.as('teacherA2'))).status).toBe(404);
    expect((await patch('teacherA', 'courseA', { courseId: h.courses['CA'] })).body).toMatchObject({ course: { id: h.courses['CA'] } });
    expect((await h.api().get(`${h.BANKS}/${banks['courseA']}`).set(h.as('teacherA2'))).status).toBe(200);
  });

  it('AC4 — creates the two auto-graded types; a ready question passes every rule of its type, a draft may be incomplete', async () => {
    const create = (user: string, bank: string, body: object) => h.api().post(`${h.BANKS}/${banks[bank]}/questions`).set(h.as(user)).send(body);
    const m = await h.mark();
    const res = await create(
      'teacherA',
      'courseA',
      choiceBody('ما ناتج print(2 + 3) في Python؟', ['4', '5', '6', '23'], 1, { prompt: { ar: 'ما ناتج print(2 + 3) في Python؟', en: 'What does print(2 + 3) output?' }, explanation: { ar: 'عملية جمع' }, points: 2, difficulty: 'easy', tags: [' Python ', 'basics', 'PYTHON'] }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = res.body as QuestionBody;
    expect(Object.keys(body).sort()).toEqual(QUESTION_KEYS);
    expect(body).toMatchObject({
      bankId: banks['courseA'],
      type: 'single_choice',
      status: 'ready',
      prompt: { ar: 'ما ناتج print(2 + 3) في Python؟', en: 'What does print(2 + 3) output?' },
      explanation: { ar: 'عملية جمع' },
      points: 2,
      difficulty: 'easy',
      tags: ['python', 'basics'],
      correctAnswer: null,
      missing: [],
      examCount: 0,
    });
    expect(body.options.map((option) => [option.text.ar, option.isCorrect])).toEqual([['4', false], ['5', true], ['6', false], ['23', false]]);
    questions['choice'] = body.id;

    const tf = (await create('teacherA2', 'courseA', trueFalseBody('يمكن استخدام Python لتطوير تطبيقات الويب.', true))).body as QuestionBody;
    expect(tf).toMatchObject({ type: 'true_false', status: 'ready', options: [], correctAnswer: true, points: 1, difficulty: null, tags: [], missing: [] });
    questions['trueFalse'] = tf.id;

    // A draft is saved incomplete and says what it still lacks.
    const draft = (await create('teacherA', 'courseA', { type: 'single_choice', prompt: { ar: 'سؤال قيد الكتابة' }, options: [{ text: { ar: 'خيار وحيد' }, isCorrect: false }] })).body as QuestionBody;
    expect(draft).toMatchObject({ status: 'draft', missing: ['options_too_few', 'correct_option_required'] });
    questions['draft'] = draft.id;
    const tfDraft = (await create('teacherA', 'courseA', { type: 'true_false', prompt: { ar: 'عبارة بلا مفتاح' } })).body as QuestionBody;
    expect(tfDraft).toMatchObject({ status: 'draft', correctAnswer: null, missing: ['correct_answer_required'] });
    questions['tfDraft'] = tfDraft.id;

    const events = await h.eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId])).toEqual([
      ['questions.created', 'questions', questions['choice']],
      ['questions.created', 'questions', questions['trueFalse']],
      ['questions.created', 'questions', questions['draft']],
      ['questions.created', 'questions', questions['tfDraft']],
    ]);
    expect(events[0]!.metadata).toEqual({ bankId: banks['courseA'], type: 'single_choice', status: 'ready' });
    // The key is never part of an audit event.
    expect(JSON.stringify(events)).not.toContain('isCorrect');

    // Refusals, before any write.
    const refused = await h.mark();
    const invalid = async (payload: object, problems: string[]) => {
      const response = await create('teacherA', 'courseA', payload);
      expect(response.body, JSON.stringify(payload)).toMatchObject({ statusCode: 400, code: 'question_invalid', problems });
    };
    await invalid(choiceBody('بلا خيارات', [], -1), ['options_too_few', 'correct_option_required']);
    await invalid(choiceBody('خيار واحد', ['أ'], 0), ['options_too_few']);
    await invalid(choiceBody('بلا صحيح', ['أ', 'ب'], -1), ['correct_option_required']);
    await invalid({ ...choiceBody('صحيحان', ['أ', 'ب'], 0), options: [{ text: { ar: 'أ' }, isCorrect: true }, { text: { ar: 'ب' }, isCorrect: true }] }, ['multiple_correct_options']);
    await invalid(choiceBody('مكرر', ['نفسه', ' نفسه '], 0), ['duplicate_options']);
    await invalid({ ...choiceBody('مفتاح منطقي', ['أ', 'ب'], 0), correctAnswer: true }, ['correct_answer_not_allowed']);
    await invalid({ ...trueFalseBody('بخيارات', true), options: [{ text: { ar: 'صح' }, isCorrect: true }] }, ['options_not_allowed']);
    await invalid(trueFalseBody('بلا مفتاح', null), ['correct_answer_required']);
    // Shape errors are plain validation errors.
    for (const payload of [
      { type: 'essay', prompt: { ar: 'نوع غير مدعوم' } },
      { type: 'single_choice', prompt: { en: 'no arabic' } },
      { ...choiceBody('أكثر من عشرة', Array.from({ length: 11 }, (_, index) => `خيار ${index}`), 0) },
      { ...choiceBody('نقاط', ['أ', 'ب'], 0), points: 0 },
      { ...choiceBody('نقاط نصية', ['أ', 'ب'], 0), points: '2' },
      { ...choiceBody('كسور', ['أ', 'ب'], 0), points: 1.234 },
      { ...choiceBody('وسوم', ['أ', 'ب'], 0), tags: Array.from({ length: 11 }, (_, index) => `t${index}`) },
      { ...choiceBody('حالة', ['أ', 'ب'], 0), status: 'archived' },
      { ...choiceBody('صحيح نصي', ['أ', 'ب'], 0), options: [{ text: { ar: 'أ' }, isCorrect: 'yes' }, { text: { ar: 'ب' }, isCorrect: false }] },
      { ...trueFalseBody('مفتاح نصي', true), correctAnswer: 'true' },
    ]) {
      expect((await create('teacherA', 'courseA', payload)).status, JSON.stringify(payload)).toBe(400);
    }
    // A bank the caller does not see, and a caller without the key.
    expect((await create('teacherB', 'courseA', trueFalseBody('اختراق', true))).body).toMatchObject({ statusCode: 404, code: 'question_bank_not_found' });
    expect((await create('teacherA2', 'private', trueFalseBody('اختراق', true))).body).toMatchObject({ statusCode: 404, code: 'question_bank_not_found' });
    expect((await create('clerk', 'courseA', trueFalseBody('اختراق', true))).status).toBe(403);
    expect((await create('student', 'courseA', trueFalseBody('اختراق', true))).status).toBe(403);
    expect(await h.eventsSince(refused)).toEqual([]);

    const counts = (await h.api().get(`${h.BANKS}/${banks['courseA']}`).set(h.as('teacherA')).expect(200)).body as BankBody;
    expect(counts).toMatchObject({ questionCount: 4, readyCount: 2 });
  });

  it('AC5 — PATCH replaces the options as a whole, validates the merged question for its status, and archives; an identical body writes nothing', async () => {
    const patch = (user: string, question: string, body: object) => h.api().patch(`${h.QUESTIONS}/${questions[question]}`).set(h.as(user)).send(body);
    const read = async (question: string) => (await h.api().get(`${h.QUESTIONS}/${questions[question]}`).set(h.as('teacherA')).expect(200)).body as QuestionBody;
    const before = await read('choice');

    // The co-teacher of the course corrects the options: the list is replaced, its ids change.
    const m = await h.mark();
    const res = await patch('teacherA2', 'choice', { options: [{ text: { ar: '5' }, isCorrect: true }, { text: { ar: '4' }, isCorrect: false }, { text: { ar: '6' }, isCorrect: false }], points: 2.5 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = res.body as QuestionBody;
    expect(after.options.map((option) => [option.text.ar, option.isCorrect])).toEqual([['5', true], ['4', false], ['6', false]]);
    expect(after.options.some((option) => before.options.some((old) => old.id === option.id))).toBe(false);
    expect(after.points).toBe(2.5);
    expect((await h.eventsSince(m)).map((event) => [event.action, event.metadata])).toEqual([['questions.updated', { bankId: banks['courseA'], fields: ['points', 'options'] }]]);

    // Completing a draft and marking it ready in one request.
    const completed = await patch('teacherA', 'draft', { status: 'ready', options: [{ text: { ar: 'أ' }, isCorrect: false }, { text: { ar: 'ب' }, isCorrect: true }], explanation: { ar: 'الجواب ب' }, difficulty: 'hard', tags: ['Review'] });
    expect(completed.body).toMatchObject({ status: 'ready', missing: [], difficulty: 'hard', tags: ['review'], explanation: { ar: 'الجواب ب' } });
    expect((await patch('teacherA', 'tfDraft', { correctAnswer: false, status: 'ready' })).body).toMatchObject({ status: 'ready', correctAnswer: false });

    // No diff, no write, no event; refusals too.
    const quiet = await h.mark();
    const same = await read('draft');
    expect((await patch('teacherA', 'draft', { status: 'ready', difficulty: 'hard', tags: [' REVIEW '], options: same.options.map((option) => ({ text: option.text, isCorrect: option.isCorrect })) })).status).toBe(200);
    expect((await read('draft')).options.map((option) => option.id)).toEqual(same.options.map((option) => option.id));
    expect((await patch('teacherA', 'draft', {})).body).toMatchObject({ statusCode: 400, code: 'nothing_to_update' });
    // A ready question cannot be made incomplete; the same change is fine once it is a draft again.
    expect((await patch('teacherA', 'draft', { options: [{ text: { ar: 'أ' }, isCorrect: true }] })).body).toMatchObject({ statusCode: 400, code: 'question_invalid', problems: ['options_too_few'] });
    expect((await patch('teacherA', 'tfDraft', { correctAnswer: null })).body).toMatchObject({ code: 'question_invalid', problems: ['correct_answer_required'] });
    expect((await patch('teacherA', 'trueFalse', { options: [{ text: { ar: 'صح' }, isCorrect: true }] })).body).toMatchObject({ code: 'question_invalid', problems: ['options_not_allowed'] });
    expect((await patch('teacherA', 'choice', { correctAnswer: true })).body).toMatchObject({ code: 'question_invalid', problems: ['correct_answer_not_allowed'] });
    // The type is fixed: the field is not part of the body at all.
    expect((await patch('teacherA', 'choice', { type: 'true_false' })).status).toBe(400);
    expect((await patch('teacherA', 'choice', { prompt: null })).status).toBe(400);
    expect((await patch('teacherA', 'choice', { points: null })).status).toBe(400);
    expect((await patch('teacherB', 'choice', { points: 9 })).body).toMatchObject({ statusCode: 404, code: 'question_not_found' });
    expect((await patch('clerk', 'choice', { points: 9 })).status).toBe(403);
    expect(await h.eventsSince(quiet)).toEqual([]);
    expect((await read('choice')).points).toBe(2.5);

    // Back to a draft, then incomplete, then archived: an archived question keeps what it had.
    await patch('teacherA', 'tfDraft', { status: 'draft', correctAnswer: null }).expect(200);
    expect(await read('tfDraft')).toMatchObject({ status: 'draft', correctAnswer: null, missing: ['correct_answer_required'] });
    expect((await patch('teacherA', 'tfDraft', { status: 'archived' })).body).toMatchObject({ status: 'archived' });
    expect((await patch('teacherA', 'tfDraft', { status: 'ready' })).body).toMatchObject({ code: 'question_invalid', problems: ['correct_answer_required'] });
  });

  it('AC6 — lists the questions of the visible banks with filters and keyset pages; archived ones only when asked for', async () => {
    const other = await h.question('teacherB', banks['courseB']!, choiceBody('سؤال من دورة أخرى 100%_تمام', ['أ', 'ب'], 0, { tags: ['other'], difficulty: 'medium' }));
    questions['other'] = other.id;
    const ids = async (user: string, query: Record<string, string> = {}) => ((await listQuestions(user, query).expect(200)).body.items as QuestionBody[]).map((item) => item.id);
    const known = (list: string[]) => list.map((id) => Object.keys(questions).find((key) => questions[key] === id)).filter((name) => name !== undefined);

    // Newest first; the archived one is left out by default.
    expect(known(await ids('teacherA', { bankId: banks['courseA']! }))).toEqual(['draft', 'trueFalse', 'choice']);
    expect(known(await ids('teacherA', { bankId: banks['courseA']!, status: 'archived' }))).toEqual(['tfDraft']);
    expect(known(await ids('teacherA', { bankId: banks['courseA']!, type: 'true_false' }))).toEqual(['trueFalse']);
    expect(known(await ids('teacherA', { bankId: banks['courseA']!, difficulty: 'hard' }))).toEqual(['draft']);
    expect(known(await ids('teacherA', { bankId: banks['courseA']!, tag: ' PYTHON ' }))).toEqual(['choice']);
    expect(known(await ids('teacherA', { bankId: banks['courseA']!, q: 'print(2' }))).toEqual(['choice']);
    expect(known(await ids('teacherA', { bankId: banks['courseA']!, q: 'OUTPUT' }))).toEqual(['choice']);
    // Across banks: only what the caller sees; `%` and `_` are literal.
    expect(known(await ids('teacherA'))).toEqual(['draft', 'trueFalse', 'choice']);
    expect(known(await ids('teacherB'))).toEqual(['other']);
    expect(known(await ids('teacherB', { q: '100%_' }))).toEqual(['other']);
    expect(known(await ids('teacherB', { q: '100_%' }))).toEqual([]);
    expect(known(await ids('manager'))).toEqual(['other', 'draft', 'trueFalse', 'choice']);
    // A bank the caller does not see matches nothing; a question of it is 404.
    expect(await ids('teacherB', { bankId: banks['courseA']! })).toEqual([]);
    expect((await h.api().get(`${h.QUESTIONS}/${questions['choice']}`).set(h.as('teacherB'))).body).toMatchObject({ statusCode: 404, code: 'question_not_found' });
    expect((await listQuestions('clerk')).status).toBe(403);
    expect((await listQuestions('student')).status).toBe(403);
    expect((await listQuestions('teacherA', { type: 'essay' })).status).toBe(400);
    expect((await listQuestions('teacherA', { cursor: 'x' })).body).toMatchObject({ code: 'cursor_invalid' });

    const pageOne = await listQuestions('teacherA', { bankId: banks['courseA']!, limit: '2' }).expect(200);
    expect(known((pageOne.body.items as QuestionBody[]).map((item) => item.id))).toEqual(['draft', 'trueFalse']);
    const pageTwo = await listQuestions('teacherA', { bankId: banks['courseA']!, limit: '2', cursor: pageOne.body.nextCursor as string }).expect(200);
    expect(known((pageTwo.body.items as QuestionBody[]).map((item) => item.id))).toEqual(['choice']);
    expect(pageTwo.body.nextCursor).toBeNull();
  });

  it('AC7 — deletes a question no exam links and a bank none of whose questions is linked; a linked one is in use', async () => {
    // An exam links the choice question (the link is written directly — the route is TEST-282's).
    const exam = await h.prisma.exam.create({ data: { classId: h.classes['A1']!, title: { ar: 'اختبار يربط سؤالاً' }, type: 'quiz', maxScore: '2.50', delivery: 'online' }, select: { id: true } });
    await h.prisma.examQuestion.create({ data: { examId: exam.id, questionId: questions['choice']!, sortOrder: 0, points: '2.50' }, select: { id: true } });
    expect((await h.api().get(`${h.QUESTIONS}/${questions['choice']}`).set(h.as('teacherA')).expect(200)).body).toMatchObject({ examCount: 1 });

    const refused = await h.mark();
    expect((await h.api().delete(`${h.QUESTIONS}/${questions['choice']}`).set(h.as('teacherA'))).body).toMatchObject({ statusCode: 409, code: 'question_in_use', examCount: 1 });
    expect((await h.api().delete(`${h.BANKS}/${banks['courseA']}`).set(h.as('teacherA'))).body).toMatchObject({ statusCode: 409, code: 'question_bank_in_use', linkedQuestionCount: 1 });
    expect((await h.api().delete(`${h.QUESTIONS}/${questions['trueFalse']}`).set(h.as('teacherB'))).body).toMatchObject({ statusCode: 404, code: 'question_not_found' });
    expect((await h.api().delete(`${h.BANKS}/${banks['private']}`).set(h.as('teacherA2'))).body).toMatchObject({ statusCode: 404, code: 'question_bank_not_found' });
    expect((await h.api().delete(`${h.QUESTIONS}/${questions['trueFalse']}`).set(h.as('clerk'))).status).toBe(403);
    expect(await h.eventsSince(refused)).toEqual([]);

    // The linked question is archived instead, and stays linked.
    expect((await h.api().patch(`${h.QUESTIONS}/${questions['choice']}`).set(h.as('teacherA')).send({ status: 'archived' })).body).toMatchObject({ status: 'archived', examCount: 1 });

    const m = await h.mark();
    await h.api().delete(`${h.QUESTIONS}/${questions['trueFalse']}`).set(h.as('teacherA')).expect(204);
    await h.api().delete(`${h.BANKS}/${banks['courseB']}`).set(h.as('teacherB')).expect(204);
    expect((await h.eventsSince(m)).map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['questions.deleted', questions['trueFalse'], { bankId: banks['courseA'] }],
      ['question_banks.deleted', banks['courseB'], { questionCount: 1 }],
    ]);
    expect((await h.api().get(`${h.QUESTIONS}/${questions['trueFalse']}`).set(h.as('teacherA'))).status).toBe(404);
    expect(await h.prisma.question.count({ where: { id: questions['other']! } })).toBe(0);
    expect(await h.prisma.questionOption.count({ where: { questionId: questions['other']! } })).toBe(0);

    // Once the exam is gone the bank goes too, with every question and option it held.
    await h.prisma.exam.delete({ where: { id: exam.id } });
    await h.api().delete(`${h.BANKS}/${banks['courseA']}`).set(h.as('teacherA2')).expect(204);
    expect(await h.prisma.question.count({ where: { bankId: banks['courseA']! } })).toBe(0);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = { body: await h.openApiDocument() };
      expect(Object.keys(docs.body.paths['/api/question-banks']).sort()).toEqual(['get', 'post']);
      expect(Object.keys(docs.body.paths['/api/question-banks/{id}']).sort()).toEqual(['delete', 'get', 'patch']);
      expect(Object.keys(docs.body.paths['/api/question-banks/{id}/questions'])).toEqual(['post']);
      expect(Object.keys(docs.body.paths['/api/questions'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/questions/{id}']).sort()).toEqual(['delete', 'get', 'patch']);
      expect(docs.body.paths['/api/questions'].get.security).toEqual([{ bearer: [] }]);
    },
    20_000,
  );
});
