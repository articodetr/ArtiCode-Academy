// Fixtures for a learner's own attempts at an online exam (MOD-09 phase 2 —
// OEX-T07): the shapes of API-276..API-279 as the backend returns them
// (my-attempts.dto.ts). The class, course and zone are those of the exam
// fixture (test/exams.ts), so they are the same everywhere.
//
// An attempt in progress carries NO key: options are `{ id, text }`, `review`
// and `result` are null. The review builders below exist for the finished
// attempt whose exam has released its answers.
import type { AttemptExam, AttemptQuestion, AttemptResult, AttemptReview, AttemptSummary, MyAttempt, SaveAnswersResult } from '../api/myAttempts'
import { EXAM_ID, EXAM_TIME_ZONE, makeExam } from './exams'

export const ATTEMPT_ID = '0193f000-0000-7000-8000-00000000f001'
export const ATTEMPT_ID_2 = '0193f000-0000-7000-8000-00000000f002'

/** The three questions of the fixture exam, in its order. */
export const QUESTION_IDS = ['0193f000-0000-7000-8000-0000000a0001', '0193f000-0000-7000-8000-0000000a0002', '0193f000-0000-7000-8000-0000000a0003'] as const

/** The options of the two choice questions, in display order. */
export const OPTION_IDS = {
  first: ['0193f000-0000-7000-8000-0000000b0101', '0193f000-0000-7000-8000-0000000b0102', '0193f000-0000-7000-8000-0000000b0103'],
  second: ['0193f000-0000-7000-8000-0000000b0201', '0193f000-0000-7000-8000-0000000b0202', '0193f000-0000-7000-8000-0000000b0203'],
} as const

export const QUESTION_PROMPTS = ['ما ناتج العملية 2 ** 3 في بايثون؟', 'أي نوع يمثّل النصوص في بايثون؟', 'القوائم في بايثون قابلة للتعديل.'] as const

/** What a learner may know of the online quiz of PY-101-A: 10 points (pass 5), 30 minutes, open 10:00–12:00 on 2026-11-20 in Asia/Riyadh, one attempt, results on publication, answers not revealed. */
export function makeAttemptExam(overrides: Partial<AttemptExam> = {}): AttemptExam {
  return {
    id: EXAM_ID,
    title: { ar: 'اختبار قصير: أساسيات بايثون', en: 'Quiz: Python basics' },
    description: { ar: 'أجب عن كل الأسئلة. لكل سؤال إجابة واحدة.' },
    type: 'quiz',
    maxScore: 10,
    passScore: 5,
    durationMinutes: 30,
    scheduledAt: '2026-11-20T07:00:00.000Z',
    closesAt: '2026-11-20T09:00:00.000Z',
    timeZone: EXAM_TIME_ZONE,
    attemptsAllowed: 1,
    resultsRelease: 'on_publish',
    revealAnswers: false,
    class: makeExam().class,
    ...overrides,
  }
}

/** The three questions without any answer and without their key: two `single_choice` (4 points each) and one `true_false` (2 points). */
export function makeAttemptQuestions(): AttemptQuestion[] {
  return [
    {
      id: QUESTION_IDS[0],
      sortOrder: 0,
      points: 4,
      type: 'single_choice',
      prompt: { ar: QUESTION_PROMPTS[0] },
      options: [
        { id: OPTION_IDS.first[0], text: { ar: 'ستة' } },
        { id: OPTION_IDS.first[1], text: { ar: 'ثمانية' } },
        { id: OPTION_IDS.first[2], text: { ar: 'تسعة' } },
      ],
      answer: null,
      review: null,
    },
    {
      id: QUESTION_IDS[1],
      sortOrder: 1,
      points: 4,
      type: 'single_choice',
      prompt: { ar: QUESTION_PROMPTS[1] },
      options: [
        { id: OPTION_IDS.second[0], text: { ar: 'int' } },
        { id: OPTION_IDS.second[1], text: { ar: 'str' } },
        { id: OPTION_IDS.second[2], text: { ar: 'list' } },
      ],
      answer: null,
      review: null,
    },
    {
      id: QUESTION_IDS[2],
      sortOrder: 2,
      points: 2,
      type: 'true_false',
      prompt: { ar: QUESTION_PROMPTS[2] },
      options: [],
      answer: null,
      review: null,
    },
  ]
}

export function makeAttemptSummary(overrides: Partial<AttemptSummary> = {}): AttemptSummary {
  return { id: ATTEMPT_ID, attemptNo: 1, status: 'in_progress', startedAt: '2026-11-20T07:30:00.000Z', submittedAt: null, score: null, ...overrides }
}

/** The first attempt, in progress since 10:30 with 30 minutes left on the server's clock and nothing answered. */
export function makeMyAttempt(overrides: Partial<MyAttempt> = {}): MyAttempt {
  const questions = overrides.questions ?? makeAttemptQuestions()
  return {
    id: ATTEMPT_ID,
    attemptNo: 1,
    status: 'in_progress',
    startedAt: '2026-11-20T07:30:00.000Z',
    expiresAt: '2026-11-20T08:00:00.000Z',
    submittedAt: null,
    serverNow: '2026-11-20T07:30:00.000Z',
    remainingSeconds: 1800,
    timeUp: false,
    answeredCount: questions.filter((question) => question.answer !== null).length,
    questionCount: questions.length,
    exam: makeAttemptExam(),
    questions,
    resultReleased: false,
    reviewReleased: false,
    result: null,
    attempts: [makeAttemptSummary()],
    ...overrides,
  }
}

/** The fixture's questions with the learner's answers: «ثمانية» for the first, none for the second, «صحيح» for the third. */
export function makeAnsweredQuestions(): AttemptQuestion[] {
  const [first, second, third] = makeAttemptQuestions() as [AttemptQuestion, AttemptQuestion, AttemptQuestion]
  return [{ ...first, answer: { optionId: OPTION_IDS.first[1], value: null } }, second, { ...third, answer: { optionId: null, value: true } }]
}

/** The same attempt submitted at 10:50 with two answers — and nothing released yet: no result, no review. */
export function makeFinishedAttempt(overrides: Partial<MyAttempt> = {}): MyAttempt {
  return makeMyAttempt({
    status: 'submitted',
    submittedAt: '2026-11-20T07:50:00.000Z',
    serverNow: '2026-11-20T07:50:01.000Z',
    remainingSeconds: 0,
    questions: makeAnsweredQuestions(),
    attempts: [makeAttemptSummary({ status: 'submitted', submittedAt: '2026-11-20T07:50:00.000Z' })],
    ...overrides,
  })
}

/** A released result as the server computed it: 6 of 10, two of three correct, passed, the attempt that counts. */
export function makeAttemptResult(overrides: Partial<AttemptResult> = {}): AttemptResult {
  return { score: 6, maxScore: 10, correctCount: 2, questionCount: 3, isPass: true, counted: true, ...overrides }
}

export function makeAttemptReview(overrides: Partial<AttemptReview> = {}): AttemptReview {
  return { isCorrect: true, pointsAwarded: 4, correctOptionId: OPTION_IDS.first[1], correctAnswer: null, explanation: null, ...overrides }
}

/** The answered questions with the review the server releases once the exam reveals its answers: right, unanswered (wrong), right. */
export function makeReviewedQuestions(): AttemptQuestion[] {
  const [first, second, third] = makeAnsweredQuestions() as [AttemptQuestion, AttemptQuestion, AttemptQuestion]
  return [
    { ...first, review: makeAttemptReview({ explanation: { ar: 'العامل ** هو الأُس: 2 × 2 × 2.' } }) },
    { ...second, review: makeAttemptReview({ isCorrect: false, pointsAwarded: 0, correctOptionId: OPTION_IDS.second[1] }) },
    { ...third, review: makeAttemptReview({ pointsAwarded: 2, correctOptionId: null, correctAnswer: true }) },
  ]
}

/** API-278's answer: one answer written, 29 minutes and 50 seconds left. */
export function makeSaveResult(overrides: Partial<SaveAnswersResult> = {}): SaveAnswersResult {
  return { attemptId: ATTEMPT_ID, saved: 1, answeredCount: 1, questionCount: 3, expiresAt: '2026-11-20T08:00:00.000Z', serverNow: '2026-11-20T07:30:10.000Z', remainingSeconds: 1790, ...overrides }
}
