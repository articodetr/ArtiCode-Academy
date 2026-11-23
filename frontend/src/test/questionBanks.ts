// Fixtures for the question banks page and the question editor (MOD-09 phase 2
// — OEX-T07): the shapes of API-260..API-269 as the backend returns them
// (backend/src/questions/questions.dto.ts), plus the permission sets the tests
// use (`questions.manage` is seeded to teachers; the admin holds every key).
import type { Question, QuestionBank, QuestionBankList, QuestionList, QuestionOption } from '../api/questionBanks'
import { TEACHER_IDS } from './classes'
import { COURSE_ID } from './courses'

export const BANK_IDS = ['0194a000-0000-7000-8000-00000000a001', '0194a000-0000-7000-8000-00000000a002', '0194a000-0000-7000-8000-00000000a003'] as const
export const BANK_ID = BANK_IDS[0]

export const QUESTION_IDS = [
  '0194a000-0000-7000-8000-00000000b001',
  '0194a000-0000-7000-8000-00000000b002',
  '0194a000-0000-7000-8000-00000000b003',
  '0194a000-0000-7000-8000-00000000b004',
] as const
export const QUESTION_ID = QUESTION_IDS[0]

/** A teacher by seed as far as this page is concerned: the banks they created and those of their courses (D-R162), and the course picker. */
export const QUESTION_TEACHER_PERMISSIONS = ['questions.manage', 'courses.read', 'classes.read', 'exams.read', 'exams.manage']

/** An academy admin: every bank (`classes.manage`). */
export const QUESTION_ADMIN_PERMISSIONS = ['questions.manage', 'courses.read', 'courses.manage', 'classes.read', 'classes.manage']

export const BANK_COURSE = { id: COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' } }

/** «بنك بايثون» of PY-101 by خالد المعلم: 12 questions, 9 of them ready. */
export function makeBank(overrides: Partial<QuestionBank> = {}): QuestionBank {
  return {
    id: BANK_ID,
    name: { ar: 'بنك بايثون', en: 'Python bank' },
    description: { ar: 'أسئلة أساسيات اللغة' },
    course: BANK_COURSE,
    createdBy: { userId: TEACHER_IDS[0], fullName: 'خالد المعلم' },
    questionCount: 12,
    readyCount: 9,
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-21T09:30:00.000Z',
    ...overrides,
  }
}

/**
 * In the server's order (newest first): «بنك بايثون» of PY-101; «أسئلة عامة» filed under no course, with a Turkish name
 * the form does not show and no description; «بنك قديم» whose author's account is gone, with no question.
 */
export function THREE_BANKS(): QuestionBank[] {
  return [
    makeBank(),
    makeBank({ id: BANK_IDS[1], name: { ar: 'أسئلة عامة', tr: 'Genel sorular' }, description: null, course: null, questionCount: 2, readyCount: 0 }),
    makeBank({ id: BANK_IDS[2], name: { ar: 'بنك قديم' }, description: null, createdBy: null, questionCount: 0, readyCount: 0 }),
  ]
}

export function makeBankList(items: QuestionBank[], nextCursor: string | null = null): QuestionBankList {
  return { items, nextCursor }
}

export function makeOption(ar: string, isCorrect = false, overrides: Partial<QuestionOption> = {}): QuestionOption {
  return { id: `option-${ar}`, text: { ar }, isCorrect, ...overrides }
}

/**
 * A ready single-choice question of «بنك بايثون»: four options, «5» the key (its third option carries a Turkish text
 * the form does not show), two points, easy, two tags, an Arabic explanation, used by no exam.
 */
export function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: QUESTION_ID,
    bankId: BANK_ID,
    type: 'single_choice',
    status: 'ready',
    prompt: { ar: 'ما ناتج print(2 + 3) في بايثون؟', en: 'What does print(2 + 3) output in Python?' },
    explanation: { ar: 'عامل الجمع يجمع العددين.' },
    points: 2,
    difficulty: 'easy',
    tags: ['python', 'حساب'],
    options: [makeOption('4'), makeOption('5', true), makeOption('6', false, { text: { ar: '6', tr: 'altı' } }), makeOption('23')],
    correctAnswer: null,
    missing: [],
    examCount: 0,
    createdBy: { userId: TEACHER_IDS[0], fullName: 'خالد المعلم' },
    createdAt: '2026-11-20T08:10:00.000Z',
    updatedAt: '2026-11-21T09:00:00.000Z',
    ...overrides,
  }
}

/** A ready true/false question whose key is «صحيح», one point, no difficulty, no tag. */
export function makeTrueFalseQuestion(overrides: Partial<Question> = {}): Question {
  return makeQuestion({
    id: QUESTION_IDS[1],
    type: 'true_false',
    prompt: { ar: 'بايثون لغة مفسَّرة.' },
    explanation: null,
    points: 1,
    difficulty: null,
    tags: [],
    options: [],
    correctAnswer: true,
    ...overrides,
  })
}

/** A draft single-choice question with one option and no key: the server names what it lacks. */
export function makeDraftQuestion(overrides: Partial<Question> = {}): Question {
  return makeQuestion({
    id: QUESTION_IDS[2],
    status: 'draft',
    prompt: { ar: 'أيّ هذه حلقة تكرار؟' },
    explanation: null,
    points: 1,
    difficulty: null,
    tags: [],
    options: [makeOption('for')],
    missing: ['options_too_few', 'correct_option_required'],
    ...overrides,
  })
}

export function makeQuestionList(items: Question[], nextCursor: string | null = null): QuestionList {
  return { items, nextCursor }
}
