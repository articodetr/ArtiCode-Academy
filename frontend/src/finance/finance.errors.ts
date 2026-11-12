// Maps a failed finance request (API-140..API-155) to a translation key under
// finance.errors.* — the whole MOD-11 dictionary of
// backend/src/finance/finance.errors.ts (20 codes) plus `academy_not_configured`
// (503 — API-146/149/150/151 need the academy row) and the auth/permission/
// origin guards. `fee_plan_invalid` and `invoice_invalid` carry `{ problems }`:
// each problem is worded on its own (finance.problems.*), in the server's order.
// The money of `payment_exceeds_balance { amount, balance }` is formatted by the
// caller's formatter (the invoice's currency). Unit-tested in
// finance.errors.test.ts.
import { ApiError } from '../api/client'
import { failureMessage as usersFailureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'
import { FEE_PLAN_PROBLEMS } from './feePlans.rules'
import { INVOICE_PROBLEMS } from './invoices.rules'

export interface FinanceFailure extends UsersFailure {
  /** The problems of `fee_plan_invalid` / `invoice_invalid` as translation keys, in the server's order. */
  problems?: string[]
  /** Interpolation values that are translation keys themselves (a status the server names), resolved by failureMessage(). */
  translatedParams?: Record<string, string>
  /** The stable code of the failure, when the server sent one. */
  code?: string
}

const KNOWN_CODES = new Set([
  'fee_plan_not_found',
  'fee_plan_invalid',
  'fee_plan_in_use',
  'fee_plan_inactive',
  'course_not_found',
  'class_not_found',
  'fee_plan_mismatch',
  'invoice_not_found',
  'student_not_found',
  'enrollment_mismatch',
  'invoice_invalid',
  'invoice_not_draft',
  'invoice_not_issued',
  'invoice_has_payments',
  'invalid_transition',
  'payment_exceeds_balance',
  'payment_not_found',
  'payment_reversed',
  'nothing_to_update',
  'cursor_invalid',
  'academy_not_configured',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** The form field (antd name path) a code points at, in the forms that have it. */
const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  student_not_found: ['studentId'],
  enrollment_mismatch: ['enrollmentId'],
  fee_plan_not_found: ['feePlanId'],
  fee_plan_inactive: ['feePlanId'],
  fee_plan_mismatch: ['feePlanId'],
  course_not_found: ['courseId'],
  class_not_found: ['classId'],
  payment_exceeds_balance: ['amount'],
}

const INVOICE_STATUS_VALUES = new Set(['draft', 'issued', 'cancelled'])

function bodyOf(error: ApiError): Record<string, unknown> {
  return (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** The problems the server named, in the mirrored order, as translation keys; unknown names are dropped. */
function problemKeysOf(code: string, value: unknown): string[] {
  const named = strings(value)
  const order: readonly string[] = code === 'fee_plan_invalid' ? FEE_PLAN_PROBLEMS : INVOICE_PROBLEMS
  return order.filter((problem) => named.includes(problem)).map((problem) => `finance.problems.${problem}`)
}

const plainAmount = (amount: number) => String(amount)

/**
 * The failure of a finance request. `formatAmount` renders the money the server
 * names (`payment_exceeds_balance`) — pass the invoice's currency formatter.
 */
export function describeFinanceFailure(error: unknown, formatAmount: (amount: number) => string = plainAmount): FinanceFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = bodyOf(error)
  if (error.code && KNOWN_CODES.has(error.code)) {
    const code = error.code
    const failure: FinanceFailure = { key: `finance.errors.${code}`, code }
    const field = FIELD_OF_CODE[code]
    if (field) failure.field = field
    const params: Record<string, string> = {}
    const missing = strings(body.missing)
    if (missing.length > 0) params.list = `(${missing.join(', ')})`
    if (code === 'fee_plan_invalid' || code === 'invoice_invalid') {
      const problems = problemKeysOf(code, body.problems)
      if (problems.length > 0) failure.problems = problems
    }
    if (code === 'fee_plan_in_use' && typeof body.invoiceCount === 'number') params.count = String(body.invoiceCount)
    if (code === 'invoice_has_payments' && typeof body.paymentCount === 'number') params.count = String(body.paymentCount)
    if (code === 'payment_exceeds_balance') {
      if (typeof body.amount === 'number') params.amount = formatAmount(body.amount)
      if (typeof body.balance === 'number') params.balance = formatAmount(body.balance)
    }
    if ((code === 'invoice_not_draft' || code === 'invoice_not_issued') && typeof body.status === 'string' && INVOICE_STATUS_VALUES.has(body.status)) {
      failure.translatedParams = { status: `finance.invoiceStatus.${body.status}` }
    }
    if (code === 'invalid_transition' && typeof body.from === 'string' && INVOICE_STATUS_VALUES.has(body.from)) {
      failure.translatedParams = { status: `finance.invoiceStatus.${body.from}` }
    }
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) {
    // Validation failures carry no code; the server lists the rejected constraints.
    return { key: 'finance.errors.validation', params: { message: error.message } }
  }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

type Translate = (key: string, options?: Record<string, unknown>) => string

/** The failure's own message, without the problems it names (an alert lists those under it — problemTexts()). */
export function failureTitle(t: Translate, failure: FinanceFailure): string {
  const translated = Object.fromEntries(Object.entries(failure.translatedParams ?? {}).map(([name, key]) => [name, t(key)]))
  return usersFailureMessage(t, { ...failure, params: { status: '', count: '', amount: '', balance: '', ...failure.params, ...translated } })
}

/** The failure's text: its message, then each problem it names (worded on its own). */
export function failureMessage(t: Translate, failure: FinanceFailure): string {
  const main = failureTitle(t, failure)
  if (!failure.problems?.length) return main
  return [main, ...failure.problems.map((key) => t(key))].join(' ')
}

/** The problems of the failure as their texts (for a list under the message). */
export function problemTexts(t: (key: string) => string, failure: FinanceFailure): string[] {
  return (failure.problems ?? []).map((key) => t(key))
}

/** True for the failure of one code. */
export function isFinanceFailure(failure: FinanceFailure, code: string): boolean {
  return failure.code === code
}
