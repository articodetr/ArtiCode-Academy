// Maps a failed question-banks request (API-260..API-269 — MOD-09 phase 2,
// OEX-T07) to a translation key under questionBanks.errors.* and, where the
// code points at one input, the form field that carries the message. Codes:
// backend/src/questions/questions.errors.ts (8) plus the auth/permission/origin
// guards; a validation 400 carries no code; a failure that is no HTTP answer is
// the network's.
//
// Two refusals carry a number the message words in its plural form —
// `question_bank_in_use { linkedQuestionCount }` and `question_in_use
// { examCount }` — so it reaches i18next as the NUMBER `count` (a string picks
// no plural form — CH-0297). `question_invalid { problems }` keeps the problems
// the server named, in its catalogue order: the editor maps them onto the form
// problem by problem, and failureMessage() spells them out for every other
// caller. Unit-tested in questions.errors.test.ts.
import { ApiError } from '../api/client'
import { QUESTION_PROBLEMS } from '../api/questionBanks'
import type { QuestionProblem } from '../api/questionBanks'
import type { UsersFailure } from '../users/users.errors'

/** A users failure plus what the question-banks refusals carry. */
export interface QuestionsFailure extends UsersFailure {
  /** The server's code, when it named one this dictionary knows. */
  code?: string
  /** `linkedQuestionCount` of `question_bank_in_use`, `examCount` of `question_in_use` — a number, for the plural forms. */
  count?: number
  /** `question_invalid`: the problems the server named, in catalogue order. */
  problems?: QuestionProblem[]
}

type Translate = (key: string, options?: Record<string, unknown>) => string

const KNOWN_CODES = new Set([
  'question_bank_not_found',
  'question_bank_in_use',
  'course_not_found',
  'question_not_found',
  'question_invalid',
  'question_in_use',
  'nothing_to_update',
  'cursor_invalid',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** The form field (BankFormValues) a code points at. */
const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  course_not_found: ['courseId'],
}

/** The detail that carries the number of a counted refusal. */
const COUNT_DETAIL_OF_CODE: Readonly<Record<string, string>> = {
  question_bank_in_use: 'linkedQuestionCount',
  question_in_use: 'examCount',
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** The problems of the catalogue among what the server sent, in catalogue order (anything else is dropped). */
function knownProblems(value: unknown): QuestionProblem[] {
  const named = new Set(strings(value))
  return QUESTION_PROBLEMS.filter((problem) => named.has(problem))
}

export function describeQuestionsFailure(error: unknown): QuestionsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: QuestionsFailure = { key: `questionBanks.errors.${error.code}`, code: error.code }
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = field
    const countDetail = COUNT_DETAIL_OF_CODE[error.code]
    const count = countDetail ? body[countDetail] : undefined
    if (typeof count === 'number' && Number.isInteger(count) && count > 0) failure.count = count
    if (error.code === 'question_invalid') {
      const problems = knownProblems(body.problems)
      if (problems.length > 0) failure.problems = problems
      // Without a problem this dictionary knows, the message cannot list any.
      else failure.key = 'questionBanks.errors.question_invalid_plain'
    }
    const missing = strings(body.missing)
    if (missing.length > 0) failure.params = { list: `(${missing.join(', ')})` }
    return failure
  }
  // Validation failures carry no code; the server lists the rejected constraints.
  if (error.status === 400) return { key: 'questionBanks.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

/**
 * The failure's text. A counted refusal hands its number to i18next as `count`
 * (the plural form); `question_invalid` lists its problems as sentences; keys
 * with an optional `{{list}}` or `{{message}}` render cleanly without one.
 */
export function failureMessage(t: Translate, failure: QuestionsFailure): string {
  const options: Record<string, unknown> = { list: '', message: '', ...failure.params }
  if (failure.count !== undefined) options.count = failure.count
  if (failure.problems?.length) options.problems = failure.problems.map((problem) => t(`questionBanks.problems.${problem}`)).join(' ')
  return t(failure.key, options).trim()
}

/** True for the failure of one server code. */
export function isQuestionsFailure(failure: QuestionsFailure, code: string): boolean {
  return failure.code === code
}

/** The bank or the question is gone, or out of the caller's reach (404): the page re-reads its lists. */
export function isGoneFailure(failure: QuestionsFailure): boolean {
  return failure.code === 'question_bank_not_found' || failure.code === 'question_not_found'
}
