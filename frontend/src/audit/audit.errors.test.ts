import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ar } from '../i18n/ar'
import { describeAuditFailure, failureMessage } from './audit.errors'

const t = (key: string, options?: Record<string, unknown>) => {
  const text = key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined), ar)
  return typeof text === 'string' ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')) : key
}

describe('describeAuditFailure', () => {
  it('names the missing permission on 403 and renders it', () => {
    const failure = describeAuditFailure(new ApiError(403, 'Missing permission', { statusCode: 403, code: 'permission_denied', message: 'Missing permission', missing: ['audit.read'] }))
    expect(failure).toEqual({ key: 'audit.errors.permission_denied', params: { list: '(audit.read)' } })
    expect(failureMessage(t, failure)).toBe('ليست لديك الصلاحية اللازمة لقراءة سجل التدقيق (audit.read)')
  })

  it('carries the server message of a 400 validation failure', () => {
    const failure = describeAuditFailure(new ApiError(400, 'entityType is required when entityId is given', { statusCode: 400, message: ['entityType is required when entityId is given'] }))
    expect(failure).toEqual({ key: 'audit.errors.validation', params: { message: 'entityType is required when entityId is given' } })
  })

  it('maps origin/rate codes, server errors, unknown statuses and network failures', () => {
    expect(describeAuditFailure(new ApiError(403, 'x', { code: 'origin_forbidden' })).key).toBe('audit.errors.origin_forbidden')
    expect(describeAuditFailure(new ApiError(429, 'x', { code: 'rate_limited' })).key).toBe('audit.errors.rate_limited')
    expect(describeAuditFailure(new ApiError(503, 'x')).key).toBe('login.errors.server')
    expect(describeAuditFailure(new ApiError(404, 'x')).key).toBe('login.errors.generic')
    expect(describeAuditFailure(new TypeError('fetch failed')).key).toBe('login.errors.network')
  })
})
