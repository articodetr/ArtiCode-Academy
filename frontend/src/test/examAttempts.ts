// Fixtures for the teacher's side of an online exam (MOD-09 phase 2 — OEX-T07):
// the shapes of API-273..API-275 as the backend returns them
// (backend/src/exams/exam-attempts.dto.ts) and the results sheet of an online
// exam (API-119 with `delivery`, `source` and `attemptCount`). The permission
// sets are those of test/exams.ts: teachers hold `exams.grade`, the reader does
// not.
import type { ExamAttemptDetail, ExamAttemptRow, ExamAttempts, ExamAttemptsStats, ExamAttemptsStudent, ExamQuestionStat, TeacherAttemptQuestion } from '../api/examAttempts'
import type { RegradeSummary } from '../api/examQuestions'
import type { ExamResultItem, ExamResultsSheet } from '../api/examResults'
import type { Exam } from '../api/exams'
import { makeAttendanceStudent } from './attendance'
import { CLASS_ID } from './classes'
import { EXAM_ID, RESULT_STUDENT_IDS, makeExamResult, makeOnlineExam, makeOnlineSummary, makeResultItem, makeResultsSheet } from './exams'

/** سارة, يوسف, ليلى and عمر of test/exams.ts, then هند — active, never started, no result. */
export const HIND_ID = '0193f000-0000-7000-8000-00000000e005'
export const ATTEMPT_STUDENT_IDS = [...RESULT_STUDENT_IDS, HIND_ID] as const

/** سارة's first and second attempt, يوسف's attempt in progress, ليلى's attempt the server closed. */
export const ATTEMPT_IDS = [
  '0193f000-0000-7000-8000-0000000a7001',
  '0193f000-0000-7000-8000-0000000a7002',
  '0193f000-0000-7000-8000-0000000a7003',
  '0193f000-0000-7000-8000-0000000a7004',
] as const

export const EXAM_QUESTION_IDS = [
  '0193f000-0000-7000-8000-0000000b0001',
  '0193f000-0000-7000-8000-0000000b0002',
  '0193f000-0000-7000-8000-0000000b0003',
  '0193f000-0000-7000-8000-0000000b0004',
  '0193f000-0000-7000-8000-0000000b0005',
] as const

/** The options of the four choice questions, three each: `OPTION_IDS[question][option]`. */
export const OPTION_IDS = [0, 1, 2, 3].map((question) => [0, 1, 2].map((option) => `0193f000-0000-7000-8000-0000000c0${question}0${option}`))

/**
 * The online quiz of test/exams.ts (makeOnlineExam(): out of 10 with a pass score of 5, two attempts of 30 minutes,
 * open on 2026-11-20 from 10:00 to 12:00 in Asia/Riyadh — 07:00–09:00 UTC) once it has been made available and is
 * being taken: scheduled, its questions frozen, three students started — one still in progress, two finished.
 */
export function makeScheduledOnlineExam(overrides: Partial<Exam> = {}): Exam {
  return makeOnlineExam({ status: 'scheduled', online: makeOnlineSummary({ frozen: true, attempts: { students: 3, inProgress: 1, finished: 2 } }), ...overrides })
}

/** A submitted second attempt of سارة: 6 out of 10, three correct answers, the counted one. */
export function makeAttemptRow(overrides: Partial<ExamAttemptRow> = {}): ExamAttemptRow {
  return {
    id: ATTEMPT_IDS[1],
    attemptNo: 2,
    status: 'submitted',
    startedAt: '2026-11-20T07:20:00.000Z',
    expiresAt: '2026-11-20T07:50:00.000Z',
    submittedAt: '2026-11-20T07:31:00.000Z',
    score: 6,
    correctCount: 3,
    counted: true,
    timeUp: false,
    ...overrides,
  }
}

export function makeAttemptsStudent(overrides: Partial<ExamAttemptsStudent> = {}): ExamAttemptsStudent {
  return { student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[0] }), enrollmentStatus: 'active', result: null, attempts: [], ...overrides }
}

/**
 * The five students of the roster:
 * سارة (active) — attempt 1 submitted 4/10, attempt 2 submitted 6/10 and COUNTED; her result is 6, online;
 * يوسف (active) — attempt 1 still open on the server although its deadline has passed (`timeUp`); no result;
 * ليلى (withdrawn after the exam) — attempt 1 closed by the server at its deadline, 2/10, counted; her result is 2, online;
 * عمر (completed) — never started; recorded absent on the results sheet (manual);
 * هند (active) — never started, no result.
 */
export function fiveAttemptStudents(): ExamAttemptsStudent[] {
  return [
    makeAttemptsStudent({
      result: { status: 'scored', score: 6, source: 'online' },
      attempts: [
        makeAttemptRow({ id: ATTEMPT_IDS[0], attemptNo: 1, startedAt: '2026-11-20T07:02:00.000Z', expiresAt: '2026-11-20T07:32:00.000Z', submittedAt: '2026-11-20T07:15:00.000Z', score: 4, correctCount: 2, counted: false }),
        makeAttemptRow(),
      ],
    }),
    makeAttemptsStudent({
      student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[1], fullName: 'يوسف الطالب', fullNameLatin: 'Yousef' }),
      attempts: [
        makeAttemptRow({ id: ATTEMPT_IDS[2], attemptNo: 1, status: 'in_progress', startedAt: '2026-11-20T07:04:00.000Z', expiresAt: '2026-11-20T07:34:00.000Z', submittedAt: null, score: null, correctCount: null, counted: false, timeUp: true }),
      ],
    }),
    makeAttemptsStudent({
      student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[2], fullName: 'ليلى المنسحبة', fullNameLatin: 'Layla' }),
      enrollmentStatus: 'withdrawn',
      result: { status: 'scored', score: 2, source: 'online' },
      attempts: [
        makeAttemptRow({ id: ATTEMPT_IDS[3], attemptNo: 1, status: 'timed_out', startedAt: '2026-11-20T07:01:00.000Z', expiresAt: '2026-11-20T07:31:00.000Z', submittedAt: '2026-11-20T07:31:00.000Z', score: 2, correctCount: 1 }),
      ],
    }),
    makeAttemptsStudent({
      student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[3], fullName: 'عمر الخريج', fullNameLatin: 'Omar' }),
      enrollmentStatus: 'completed',
      result: { status: 'absent', score: null, source: 'manual' },
    }),
    makeAttemptsStudent({ student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[4], fullName: 'هند الطالبة', fullNameLatin: 'Hind' }) }),
  ]
}

/**
 * The server's figures — on purpose NOT what the five rows above would add up to (a larger class): a screen that
 * shows these numbers shows the server's, not a sum, a mean or a rate of its own.
 */
export function makeAttemptsStats(overrides: Partial<ExamAttemptsStats> = {}): ExamAttemptsStats {
  return { students: 18, started: 15, inProgress: 1, finished: 14, notStarted: 3, mean: 7.25, highest: 9.5, lowest: 2.5, passed: 11, failed: 3, passRate: 78.57, ...overrides }
}

/** Five questions of two points each; how many counted attempts answered each, and how many correctly. */
export function fiveQuestionStats(): ExamQuestionStat[] {
  const answered = [14, 13, 14, 12, 9]
  const correct = [12, 8, 14, 6, 5]
  return EXAM_QUESTION_IDS.map((examQuestionId, sortOrder) => ({ examQuestionId, sortOrder, points: 2, answered: answered[sortOrder]!, correct: correct[sortOrder]! }))
}

/** The roster of the online exam (API-274), read at 10:35 in Asia/Riyadh — inside the window. */
export function makeExamAttempts(overrides: Partial<ExamAttempts> = {}): ExamAttempts {
  return {
    examId: EXAM_ID,
    classId: CLASS_ID,
    examStatus: 'scheduled',
    maxScore: 10,
    passScore: 5,
    questionCount: 5,
    scheduledAt: '2026-11-20T07:00:00.000Z',
    closesAt: '2026-11-20T09:00:00.000Z',
    window: 'open',
    serverNow: '2026-11-20T07:35:00.000Z',
    stats: makeAttemptsStats(),
    questions: fiveQuestionStats(),
    items: fiveAttemptStudents(),
    ...overrides,
  }
}

function choiceQuestion(index: number, prompt: string, texts: [string, string, string], key: number, chosen: number | null, overrides: Partial<TeacherAttemptQuestion> = {}): TeacherAttemptQuestion {
  const correct = chosen === key
  return {
    id: EXAM_QUESTION_IDS[index]!,
    sortOrder: index,
    points: 2,
    type: 'single_choice',
    prompt: { ar: prompt },
    explanation: null,
    options: texts.map((text, option) => ({ id: OPTION_IDS[index]![option]!, text: { ar: text }, isCorrect: option === key })),
    correctAnswer: null,
    answer: chosen === null ? null : { optionId: OPTION_IDS[index]![chosen]!, value: null },
    isCorrect: correct,
    pointsAwarded: correct ? 2 : 0,
    ...overrides,
  }
}

/**
 * The five frozen questions with سارة's answers as the server graded them: 1 right, 2 wrong (she chose «func», the key
 * is «def»), 3 right, 4 left unanswered, 5 (true/false, the key is «true») right — 6 out of 10, three correct.
 */
export function fiveAttemptQuestions(): TeacherAttemptQuestion[] {
  return [
    choiceQuestion(0, 'ما ناتج 3 + 4 في بايثون؟', ['7', '34', '12'], 0, 0),
    choiceQuestion(1, 'بأي كلمة تُعرَّف الدالة؟', ['def', 'func', 'lambda'], 0, 1, { explanation: { ar: 'تُعرَّف الدالة بالكلمة def.' } }),
    choiceQuestion(2, 'أي نوع يخزّن نصاً؟', ['int', 'str', 'bool'], 1, 1),
    choiceQuestion(3, 'أي حلقة تكرّر عدداً معلوماً من المرات؟', ['for', 'while', 'if'], 0, null),
    {
      id: EXAM_QUESTION_IDS[4],
      sortOrder: 4,
      points: 2,
      type: 'true_false',
      prompt: { ar: 'القوائم في بايثون قابلة للتعديل.', en: 'Python lists are mutable.' },
      explanation: null,
      options: [],
      correctAnswer: true,
      answer: { optionId: null, value: true },
      isCorrect: true,
      pointsAwarded: 2,
    },
  ]
}

/** سارة's counted attempt with the key and her answers (API-275). */
export function makeAttemptDetail(overrides: Partial<ExamAttemptDetail> = {}): ExamAttemptDetail {
  return {
    id: ATTEMPT_IDS[1],
    examId: EXAM_ID,
    attemptNo: 2,
    status: 'submitted',
    startedAt: '2026-11-20T07:20:00.000Z',
    expiresAt: '2026-11-20T07:50:00.000Z',
    submittedAt: '2026-11-20T07:31:00.000Z',
    gradedAt: '2026-11-20T07:31:00.000Z',
    score: 6,
    maxScore: 10,
    correctCount: 3,
    questionCount: 5,
    counted: true,
    student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[0] }),
    questions: fiveAttemptQuestions(),
    ...overrides,
  }
}

/**
 * يوسف's attempt while it is still open: nothing is graded (`isCorrect` and `pointsAwarded` null on every question,
 * no score); he has saved an answer to questions 1 and 5 only.
 */
export function makeOpenAttemptDetail(overrides: Partial<ExamAttemptDetail> = {}): ExamAttemptDetail {
  const answered = new Set([0, 4])
  return makeAttemptDetail({
    id: ATTEMPT_IDS[2],
    attemptNo: 1,
    status: 'in_progress',
    startedAt: '2026-11-20T07:04:00.000Z',
    expiresAt: '2026-11-20T07:34:00.000Z',
    submittedAt: null,
    gradedAt: null,
    score: null,
    correctCount: null,
    counted: false,
    student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[1], fullName: 'يوسف الطالب', fullNameLatin: 'Yousef' }),
    questions: fiveAttemptQuestions().map((question, index) => ({ ...question, answer: answered.has(index) ? question.answer : null, isCorrect: null, pointsAwarded: null })),
    ...overrides,
  })
}

/** The answer of a regrade that rewrote something (API-273). */
export function makeRegradeSummary(overrides: Partial<RegradeSummary> = {}): RegradeSummary {
  return { attempts: 14, changedAttempts: 3, changedResults: 2, ...overrides }
}

/**
 * The results sheet of the online exam (API-119) for the same five students:
 * سارة — two attempts, her counted result 6 written by the server (no recorder, no feedback);
 * يوسف — an attempt in progress, no result yet;
 * ليلى — withdrawn, one attempt, her result 2 written by the server;
 * عمر — completed, no attempt, recorded absent here by the teacher;
 * هند — active, no attempt, no result: the row the sheet is for.
 */
export function fiveOnlineResultStudents(): ExamResultItem[] {
  const online = (score: number) => makeExamResult({ score, source: 'online', recordedBy: null, recordedAt: '2026-11-20T07:31:00.000Z', updatedAt: '2026-11-20T07:31:00.000Z' })
  return [
    makeResultItem({ result: online(6), attemptCount: 2 }),
    makeResultItem({ student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[1], fullName: 'يوسف الطالب', fullNameLatin: 'Yousef' }), attemptCount: 1 }),
    makeResultItem({ student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[2], fullName: 'ليلى المنسحبة', fullNameLatin: 'Layla' }), enrollmentStatus: 'withdrawn', result: online(2), attemptCount: 1 }),
    makeResultItem({
      student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[3], fullName: 'عمر الخريج', fullNameLatin: 'Omar' }),
      enrollmentStatus: 'completed',
      result: makeExamResult({ status: 'absent', score: null }),
    }),
    makeResultItem({ student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[4], fullName: 'هند الطالبة', fullNameLatin: 'Hind' }) }),
  ]
}

export function makeOnlineResultsSheet(overrides: Partial<ExamResultsSheet> = {}): ExamResultsSheet {
  return makeResultsSheet({ delivery: 'online', maxScore: 10, counts: { students: 3, scored: 2, absent: 1, excused: 0 }, items: fiveOnlineResultStudents(), ...overrides })
}
