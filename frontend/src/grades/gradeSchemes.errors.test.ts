import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { describeGradeSchemesFailure, isGoneGradeScheme } from './gradeSchemes.errors'

function apiError(status: number, body: Record<string, unknown>): ApiError {
  return new ApiError(status, String(body.message ?? 'failed'), { statusCode: status, message: 'failed', ...body })
}

describe('describeGradeSchemesFailure (J-F44)', () => {
  it('splits grade_scheme_is_default by its action, and falls back to the generic message for an action it does not know', () => {
    for (const action of ['deactivate', 'delete', 'unset_default', 'promote_inactive']) {
      expect(describeGradeSchemesFailure(apiError(409, { code: 'grade_scheme_is_default', schemeId: 's1', action }))).toEqual({ key: `gradeSchemes.errors.grade_scheme_is_default_${action}` })
    }
    expect(describeGradeSchemesFailure(apiError(409, { code: 'grade_scheme_is_default', action: 'something_new' }))).toEqual({ key: 'gradeSchemes.errors.grade_scheme_is_default' })
  })

  it('names the first problem of grade_scheme_invalid in the server order, with the repeated minimums', () => {
    expect(describeGradeSchemesFailure(apiError(400, { code: 'grade_scheme_invalid', problems: ['no_passing_band', 'duplicate_min_percent'], duplicates: [60, 70.5] }))).toEqual({
      key: 'gradeSchemes.errors.grade_scheme_invalid_duplicate_min_percent',
      params: { duplicates: '60, 70.5' },
    })
    expect(describeGradeSchemesFailure(apiError(400, { code: 'grade_scheme_invalid', problems: ['pass_not_ascending'], duplicates: [] }))).toEqual({
      key: 'gradeSchemes.errors.grade_scheme_invalid_pass_not_ascending',
    })
    expect(describeGradeSchemesFailure(apiError(400, { code: 'grade_scheme_invalid', problems: ['unknown_rule'] }))).toEqual({ key: 'gradeSchemes.errors.grade_scheme_invalid' })
  })

  it('carries the final-grade count of grade_scheme_in_use and the missing keys of permission_denied; not_found means the scheme is gone', () => {
    expect(describeGradeSchemesFailure(apiError(409, { code: 'grade_scheme_in_use', finalGradeCount: 3 }))).toEqual({
      key: 'gradeSchemes.errors.grade_scheme_in_use',
      params: { finalGradeCount: '3' },
    })
    expect(describeGradeSchemesFailure(apiError(403, { code: 'permission_denied', missing: ['academy.settings.manage'] }))).toEqual({
      key: 'gradeSchemes.errors.permission_denied',
      params: { list: '(academy.settings.manage)' },
    })
    const gone = describeGradeSchemesFailure(apiError(404, { code: 'grade_scheme_not_found', schemeId: 's1' }))
    expect(gone).toEqual({ key: 'gradeSchemes.errors.grade_scheme_not_found' })
    expect(isGoneGradeScheme(gone)).toBe(true)
    expect(isGoneGradeScheme(describeGradeSchemesFailure(apiError(400, { code: 'nothing_to_update' })))).toBe(false)
  })

  it('maps a code-less 400 to the validation message, 5xx to the server message and anything else to the generic ones', () => {
    expect(describeGradeSchemesFailure(new ApiError(400, 'bands must contain at least 2 elements', { statusCode: 400, message: ['bands must contain at least 2 elements'] }))).toEqual({
      key: 'gradeSchemes.errors.validation',
      params: { message: 'bands must contain at least 2 elements' },
    })
    expect(describeGradeSchemesFailure(apiError(503, {}))).toEqual({ key: 'login.errors.server' })
    expect(describeGradeSchemesFailure(apiError(418, { code: 'unknown_code' }))).toEqual({ key: 'login.errors.generic' })
    expect(describeGradeSchemesFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })
})
