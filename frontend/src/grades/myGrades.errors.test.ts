import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { describeMyGradesFailure } from './myGrades.errors'

const refused = (status: number, body: Record<string, unknown> = {}) => new ApiError(status, typeof body.message === 'string' ? body.message : 'refused', { statusCode: status, ...body })

describe('describeMyGradesFailure (API-129)', () => {
  it('marks the refusal of a caller holding neither grades key as forbidden, whatever the server lists', () => {
    expect(describeMyGradesFailure(refused(403, { code: 'permission_denied', missing: ['grades.read_own', 'grades.read_linked'] }))).toEqual({
      key: 'myGrades.errors.permission_denied',
      forbidden: true,
    })
  })

  it('words the other failures without blocking a retry', () => {
    expect(describeMyGradesFailure(refused(400, { message: 'classId must be a UUID' }))).toEqual({
      key: 'myGrades.errors.validation',
      params: { message: 'classId must be a UUID' },
      forbidden: false,
    })
    expect(describeMyGradesFailure(refused(429, { code: 'rate_limited' }))).toEqual({ key: 'myGrades.errors.rate_limited', forbidden: false })
    expect(describeMyGradesFailure(refused(503))).toEqual({ key: 'login.errors.server', forbidden: false })
    expect(describeMyGradesFailure(refused(404))).toEqual({ key: 'login.errors.generic', forbidden: false })
    expect(describeMyGradesFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network', forbidden: false })
  })
})
