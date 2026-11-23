// Fixtures for the «الأسئلة» tab of the exam drawer (MOD-09 phase 2): the shapes
// of API-270/API-271 (the questions of an online exam, WITH their key — the
// teacher's side), of API-272 (a key correction) and, for the picker, of
// API-260 (a bank) and API-265 (its ready questions), as the backend returns
// them. The exam itself is makeOnlineExam() of test/exams.ts (out of 10).
import type { ExamQuestionItem, ExamQuestions, KeyCorrectionResult, RegradeSummary } from '../api/examQuestions'
import type { Question, QuestionBank, QuestionList } from '../api/questionBanks'
import { CLASS_COURSE_ID, TEACHER_IDS } from './classes'
import { EXAM_ID } from './exams'

export const QUESTION_BANK_ID = '0193f000-0000-7000-8000-0000000b0001'
export const QUESTION_BANK_ID_2 = '0193f000-0000-7000-8000-0000000b0002'

/** The bank questions: the first three are linked by threeExamQuestions(), the last two wait in the picker. */
export const BANK_QUESTION_IDS = [
  '0193f000-0000-7000-8000-0000000c0001',
  '0193f000-0000-7000-8000-0000000c0002',
  '0193f000-0000-7000-8000-0000000c0003',
  '0193f000-0000-7000-8000-0000000c0004',
  '0193f000-0000-7000-8000-0000000c0005',
] as const

/** The ids of the links (what API-272 and an attempt's answer name). */
export const EXAM_QUESTION_IDS = ['0193f000-0000-7000-8000-0000000d0001', '0193f000-0000-7000-8000-0000000d0002', '0193f000-0000-7000-8000-0000000d0003'] as const

/** The options of the first question (`6`, `8` — the key — and `9`). */
export const POWER_OPTION_IDS = ['0193f000-0000-7000-8000-0000000e0001', '0193f000-0000-7000-8000-0000000e0002', '0193f000-0000-7000-8000-0000000e0003'] as const

export const QUESTION_BANK_NAME = { ar: 'أسئلة أساسيات بايثون', en: 'Python basics questions' }

export function makeQuestionBank(overrides: Partial<QuestionBank> = {}): QuestionBank {
  return {
    id: QUESTION_BANK_ID,
    name: QUESTION_BANK_NAME,
    description: null,
    course: { id: CLASS_COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' } },
    createdBy: { userId: TEACHER_IDS[0], fullName: 'خالد المعلم' },
    questionCount: 6,
    readyCount: 5,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  }
}

/** A ready `single_choice` question of the bank worth 2 points by default: «ما الكلمة المفتاحية لتعريف دالة؟» (def is the key). */
export function makeBankQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: BANK_QUESTION_IDS[3],
    bankId: QUESTION_BANK_ID,
    type: 'single_choice',
    status: 'ready',
    prompt: { ar: 'ما الكلمة المفتاحية لتعريف دالة في بايثون؟', en: 'Which keyword defines a function in Python?' },
    explanation: null,
    points: 2,
    difficulty: 'easy',
    tags: [],
    options: [
      { id: '0193f000-0000-7000-8000-0000000e0041', text: { ar: 'def' }, isCorrect: true },
      { id: '0193f000-0000-7000-8000-0000000e0042', text: { ar: 'func' }, isCorrect: false },
    ],
    correctAnswer: null,
    missing: [],
    examCount: 0,
    createdBy: { userId: TEACHER_IDS[0], fullName: 'خالد المعلم' },
    createdAt: '2026-11-02T08:00:00.000Z',
    updatedAt: '2026-11-02T08:00:00.000Z',
    ...overrides,
  }
}

/** The second question waiting in the picker: a ready `true_false` one worth 1.5 points (true is the key). */
export function makeLenQuestion(overrides: Partial<Question> = {}): Question {
  return makeBankQuestion({
    id: BANK_QUESTION_IDS[4],
    type: 'true_false',
    prompt: { ar: 'الدالة len تعيد عدد عناصر القائمة.', en: 'len returns the number of items of a list.' },
    points: 1.5,
    options: [],
    correctAnswer: true,
    ...overrides,
  })
}

export function makeQuestionList(items: Question[], nextCursor: string | null = null): QuestionList {
  return { items, nextCursor }
}

/** A linked question of a draft: the first one — «ما ناتج print(2 ** 3)؟» with the options 6, 8 (the key) and 9, worth 4 points, ready in its bank. */
export function makeExamQuestionItem(overrides: Partial<ExamQuestionItem> = {}): ExamQuestionItem {
  return {
    id: EXAM_QUESTION_IDS[0],
    sortOrder: 0,
    points: 4,
    questionId: BANK_QUESTION_IDS[0],
    bank: { id: QUESTION_BANK_ID, name: QUESTION_BANK_NAME },
    question: {
      type: 'single_choice',
      prompt: { ar: 'ما ناتج print(2 ** 3) في بايثون؟', en: 'What does print(2 ** 3) output in Python?' },
      explanation: { ar: 'العامل ** هو الأس: 2 مرفوعة للقوة 3 تساوي 8.' },
      options: [
        { id: POWER_OPTION_IDS[0], text: { ar: '6' }, isCorrect: false },
        { id: POWER_OPTION_IDS[1], text: { ar: '8' }, isCorrect: true },
        { id: POWER_OPTION_IDS[2], text: { ar: '9' }, isCorrect: false },
      ],
      correctAnswer: null,
      status: 'ready',
    },
    corrections: [],
    ...overrides,
  }
}

/**
 * The three questions of the exam, adding up to its maximum score (4 + 3 + 3 = 10): the power question
 * (`single_choice`, the key is «8»), «القوائم قابلة للتعديل» (`true_false`, the key is true, no explanation) and
 * «أي نوع بيانات يمثّل النص؟» (`single_choice`, the key is «str»).
 */
export function threeExamQuestions(): ExamQuestionItem[] {
  const base = makeExamQuestionItem()
  return [
    base,
    {
      ...base,
      id: EXAM_QUESTION_IDS[1],
      sortOrder: 1,
      points: 3,
      questionId: BANK_QUESTION_IDS[1],
      question: {
        type: 'true_false',
        prompt: { ar: 'القوائم (list) في بايثون قابلة للتعديل بعد إنشائها.', en: 'Lists in Python are mutable.' },
        explanation: null,
        options: [],
        correctAnswer: true,
        status: 'ready',
      },
    },
    {
      ...base,
      id: EXAM_QUESTION_IDS[2],
      sortOrder: 2,
      points: 3,
      questionId: BANK_QUESTION_IDS[2],
      question: {
        type: 'single_choice',
        prompt: { ar: 'أي نوع بيانات يمثّل النص؟', en: 'Which data type holds text?' },
        explanation: null,
        options: [
          { id: '0193f000-0000-7000-8000-0000000e0031', text: { ar: 'int' }, isCorrect: false },
          { id: '0193f000-0000-7000-8000-0000000e0032', text: { ar: 'str' }, isCorrect: true },
          { id: '0193f000-0000-7000-8000-0000000e0033', text: { ar: 'bool' }, isCorrect: false },
        ],
        correctAnswer: null,
        status: 'ready',
      },
    },
  ]
}

/** A bank question as the exam links it once the set was saved (API-271's answer): its content, its points here, ready in its bank. */
export function makeLinkedItem(question: Question, overrides: Partial<ExamQuestionItem> = {}): ExamQuestionItem {
  return {
    id: `link-${question.id}`,
    sortOrder: 0,
    points: question.points,
    questionId: question.id,
    bank: { id: QUESTION_BANK_ID, name: QUESTION_BANK_NAME },
    question: { type: question.type, prompt: question.prompt, explanation: question.explanation, options: question.options, correctAnswer: question.correctAnswer, status: question.status },
    corrections: [],
    ...overrides,
  }
}

/** API-270 for an online DRAFT the caller may compose: the three questions, their points equal to the maximum score, nothing in the way. */
export function makeExamQuestions(overrides: Partial<ExamQuestions> = {}): ExamQuestions {
  return {
    examId: EXAM_ID,
    examStatus: 'draft',
    delivery: 'online',
    frozen: false,
    editable: true,
    maxScore: 10,
    totalPoints: 10,
    problems: [],
    items: threeExamQuestions(),
    ...overrides,
  }
}

/** The same three questions as the FROZEN copies of a scheduled exam: `status` null, the set locked. */
export function frozenItems(): ExamQuestionItem[] {
  return threeExamQuestions().map((item) => ({ ...item, question: { ...item.question, status: null } }))
}

/** API-270 once the exam was made available. */
export function makeFrozenQuestions(overrides: Partial<ExamQuestions> = {}): ExamQuestions {
  return makeExamQuestions({ examStatus: 'scheduled', frozen: true, editable: false, items: frozenItems(), ...overrides })
}

export function makeRegradeSummary(overrides: Partial<RegradeSummary> = {}): RegradeSummary {
  return { attempts: 14, changedAttempts: 3, changedResults: 2, ...overrides }
}

/** API-272: the first question after its key moved from «8» to «9», with one correction in its history. */
export function makeKeyCorrectionResult(overrides: Partial<KeyCorrectionResult> = {}): KeyCorrectionResult {
  const [first] = frozenItems()
  return {
    changed: true,
    question: {
      ...first!,
      question: { ...first!.question, options: first!.question.options.map((option) => ({ ...option, isCorrect: option.id === POWER_OPTION_IDS[2] })) },
      corrections: [{ at: '2026-11-21T08:30:00.000Z', byUserId: TEACHER_IDS[0], reason: 'تصحيح المفتاح بعد مراجعة السؤال' }],
    },
    regrade: makeRegradeSummary(),
    ...overrides,
  }
}
