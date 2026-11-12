import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { SUBMIT_LINK_MAX_LENGTH, SUBMIT_TEXT_MAX_LENGTH } from '../api/myAssignments'
import { describeMyAssignmentsFailure, isMyAssignmentsFailure } from './myAssignments.errors'
import { buildSubmitInput, hasAnswer, isSubmitLinkValid, isTextAnswerWithinLimit, linkProblemOf, nextAttemptNo, trimmedOrUndefined } from './myAssignments.submit'

describe('the attempt form (mirror of SubmitAssignmentDto)', () => {
  it('trims both fields and treats a blank one as absent', () => {
    expect(trimmedOrUndefined('  جواب  ')).toBe('جواب')
    expect(trimmedOrUndefined('   ')).toBeUndefined()
    expect(trimmedOrUndefined(undefined)).toBeUndefined()
    expect(hasAnswer({ textAnswer: '  ', linkUrl: '' })).toBe(false)
    expect(hasAnswer({ textAnswer: 'جواب' })).toBe(true)
    expect(hasAnswer({ linkUrl: ' https://a.example ' })).toBe(true)
  })

  it('builds the smallest body: only what was typed, trimmed, with the attempt meant; nothing at all when both are blank', () => {
    expect(buildSubmitInput({ textAnswer: '  الحل  ', linkUrl: '  ' }, 1)).toEqual({ textAnswer: 'الحل', attemptNo: 1 })
    expect(buildSubmitInput({ linkUrl: ' https://docs.example.com/x ' }, 2)).toEqual({ linkUrl: 'https://docs.example.com/x', attemptNo: 2 })
    expect(buildSubmitInput({ textAnswer: 'الحل', linkUrl: 'https://docs.example.com/x' }, 3)).toEqual({ textAnswer: 'الحل', linkUrl: 'https://docs.example.com/x', attemptNo: 3 })
    expect(buildSubmitInput({ textAnswer: ' ', linkUrl: '' }, 1)).toBeNull()
  })

  it('numbers the attempt after the highest one, as the server does (lastAttemptNo + 1)', () => {
    expect(nextAttemptNo(null)).toBe(1)
    expect(nextAttemptNo({ attemptNo: 1 })).toBe(2)
    expect(nextAttemptNo({ attemptNo: 4 })).toBe(5)
  })

  it('takes https links without whitespace up to 2,048 characters', () => {
    expect(isSubmitLinkValid(undefined)).toBe(true)
    expect(isSubmitLinkValid('https://docs.example.com/answer?id=1')).toBe(true)
    expect(isSubmitLinkValid('  https://docs.example.com/answer  ')).toBe(true)
    expect(linkProblemOf('http://docs.example.com')).toBe('pattern')
    expect(linkProblemOf('https://docs.example.com/my answer')).toBe('pattern')
    expect(linkProblemOf('docs.example.com')).toBe('pattern')
    const long = `https://a.example/${'x'.repeat(SUBMIT_LINK_MAX_LENGTH)}`
    expect(linkProblemOf(long)).toBe('max')
    expect(linkProblemOf(long.slice(0, SUBMIT_LINK_MAX_LENGTH))).toBeNull()
  })

  it('takes a text answer up to 20,000 characters once trimmed', () => {
    expect(isTextAnswerWithinLimit('ا'.repeat(SUBMIT_TEXT_MAX_LENGTH))).toBe(true)
    expect(isTextAnswerWithinLimit(`  ${'ا'.repeat(SUBMIT_TEXT_MAX_LENGTH)}  `)).toBe(true)
    expect(isTextAnswerWithinLimit('ا'.repeat(SUBMIT_TEXT_MAX_LENGTH + 1))).toBe(false)
  })
})

const refused = (status: number, body: Record<string, unknown>) => new ApiError(status, String(body.message ?? 'refused'), { statusCode: status, ...body })

describe('describeMyAssignmentsFailure', () => {
  it('puts submission_invalid on the answer field and lets the student try again', () => {
    expect(describeMyAssignmentsFailure(refused(400, { code: 'submission_invalid' }))).toEqual({ key: 'myAssignments.errors.submission_invalid', field: ['textAnswer'], terminal: false })
  })

  it('words assignment_closed by its reason and ends the session', () => {
    for (const reason of ['not_published', 'closed', 'past_due']) {
      expect(describeMyAssignmentsFailure(refused(409, { code: 'assignment_closed', reason, dueAt: null }))).toEqual({ key: `myAssignments.errors.assignment_closed_${reason}`, terminal: true })
    }
    expect(describeMyAssignmentsFailure(refused(409, { code: 'assignment_closed', reason: 'weird' })).key).toBe('myAssignments.errors.assignment_closed_closed')
  })

  it('names the attempts of attempts_exhausted — the server puts the effective limit in maxAttempts', () => {
    expect(describeMyAssignmentsFailure(refused(409, { code: 'attempts_exhausted', maxAttempts: 2, attempts: 2 }))).toEqual({
      key: 'myAssignments.errors.attempts_exhausted',
      params: { attempts: '2', allowed: '2' },
      terminal: true,
    })
  })

  it('ends the session on attempt_conflict — the attempt named exists already — with the numbers the server names (D-R49)', () => {
    const conflict = describeMyAssignmentsFailure(refused(409, { code: 'attempt_conflict', expected: 1, next: 2 }))
    expect(conflict).toEqual({ key: 'myAssignments.errors.attempt_conflict', params: { expected: '1', next: '2' }, terminal: true })
    expect(isMyAssignmentsFailure(conflict, 'attempt_conflict')).toBe(true)
    expect(describeMyAssignmentsFailure(refused(409, { code: 'attempt_conflict' })).params).toEqual({ expected: '—', next: '—' })
  })

  it('ends the session on not_enrolled, assignment_not_found and permission_denied (with the missing key)', () => {
    expect(describeMyAssignmentsFailure(refused(403, { code: 'not_enrolled', classId: 'c-1' }))).toEqual({ key: 'myAssignments.errors.not_enrolled', terminal: true })
    expect(describeMyAssignmentsFailure(refused(404, { code: 'assignment_not_found' })).terminal).toBe(true)
    expect(describeMyAssignmentsFailure(refused(403, { code: 'permission_denied', missing: ['assignments.submit'] }))).toEqual({
      key: 'myAssignments.errors.permission_denied',
      params: { list: '(assignments.submit)' },
      terminal: true,
    })
  })

  it('maps a DTO refusal to the field its message names, else shows the server message', () => {
    expect(describeMyAssignmentsFailure(refused(400, { message: ['linkUrl must be an https:// link without spaces'] }))).toEqual({ key: 'myAssignments.validation.link', field: ['linkUrl'], terminal: false })
    expect(describeMyAssignmentsFailure(refused(400, { message: 'textAnswer must be shorter than or equal to 20000 characters' }))).toMatchObject({ field: ['textAnswer'], terminal: false })
    expect(describeMyAssignmentsFailure(refused(400, { message: 'property extra should not exist' }))).toEqual({ key: 'myAssignments.errors.validation', params: { message: 'property extra should not exist' }, terminal: false })
  })

  it('keeps the list and the drawer codes, and lets a retry follow a network or server failure', () => {
    const cursor = describeMyAssignmentsFailure(refused(400, { code: 'cursor_invalid' }))
    expect(isMyAssignmentsFailure(cursor, 'cursor_invalid')).toBe(true)
    expect(describeMyAssignmentsFailure(refused(404, { code: 'submission_not_found' }))).toEqual({ key: 'myAssignments.errors.submission_not_found', terminal: false })
    expect(describeMyAssignmentsFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network', terminal: false })
    expect(describeMyAssignmentsFailure(refused(503, { message: 'down' }))).toEqual({ key: 'login.errors.server', terminal: false })
    expect(describeMyAssignmentsFailure(refused(403, { code: 'origin_forbidden' })).terminal).toBe(false)
    expect(describeMyAssignmentsFailure(refused(429, { code: 'rate_limited' })).terminal).toBe(false)
  })
})
