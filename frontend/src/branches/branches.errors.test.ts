import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { describeBranchesFailure } from './branches.errors'

function apiError(status: number, body: Record<string, unknown>): ApiError {
  return new ApiError(status, String(body.message ?? 'failed'), { statusCode: status, message: 'failed', ...body })
}

describe('describeBranchesFailure (MOD-02-T06 screen)', () => {
  it('lands a taken code on the code field with the code the server echoes', () => {
    expect(describeBranchesFailure(apiError(409, { code: 'branch_code_taken', branchCode: 'NORTH' }))).toEqual({
      key: 'branches.errors.branch_code_taken',
      field: ['code'],
      params: { branchCode: 'NORTH' },
    })
  })

  it('splits branch_is_main by its action: delete is a plain message, deactivate/promote_inactive point at the active switch', () => {
    expect(describeBranchesFailure(apiError(409, { code: 'branch_is_main', branchId: 'b1', action: 'delete' }))).toEqual({ key: 'branches.errors.branch_is_main_delete' })
    expect(describeBranchesFailure(apiError(409, { code: 'branch_is_main', branchId: 'b1', action: 'deactivate' }))).toEqual({
      key: 'branches.errors.branch_is_main_deactivate',
      field: ['isActive'],
    })
    expect(describeBranchesFailure(apiError(409, { code: 'branch_is_main', branchId: null, action: 'promote_inactive' }))).toEqual({
      key: 'branches.errors.branch_is_main_promote_inactive',
      field: ['isActive'],
    })
    // An action this screen does not know falls back to the generic message.
    expect(describeBranchesFailure(apiError(409, { code: 'branch_is_main', action: 'something_new' }))).toEqual({ key: 'branches.errors.branch_is_main' })
  })

  it('carries the room count of branch_in_use and the missing keys of permission_denied', () => {
    expect(describeBranchesFailure(apiError(409, { code: 'branch_in_use', roomCount: 2 }))).toEqual({ key: 'branches.errors.branch_in_use', params: { roomCount: '2' } })
    expect(describeBranchesFailure(apiError(403, { code: 'permission_denied', missing: ['branches.manage'] }))).toEqual({
      key: 'branches.errors.permission_denied',
      params: { list: '(branches.manage)' },
    })
    expect(describeBranchesFailure(apiError(404, { code: 'branch_not_found', branchId: 'b1' }))).toEqual({ key: 'branches.errors.branch_not_found' })
    expect(describeBranchesFailure(apiError(400, { code: 'nothing_to_update' }))).toEqual({ key: 'branches.errors.nothing_to_update' })
  })

  it('maps a code-less 400 to the validation message, 5xx to the server message and anything else to the generic ones', () => {
    expect(describeBranchesFailure(new ApiError(400, 'phone must be in E.164 form', { statusCode: 400, message: ['phone must be in E.164 form'] }))).toEqual({
      key: 'branches.errors.validation',
      params: { message: 'phone must be in E.164 form' },
    })
    expect(describeBranchesFailure(apiError(503, {}))).toEqual({ key: 'login.errors.server' })
    expect(describeBranchesFailure(apiError(418, { code: 'unknown_code' }))).toEqual({ key: 'login.errors.generic' })
    expect(describeBranchesFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })
})
