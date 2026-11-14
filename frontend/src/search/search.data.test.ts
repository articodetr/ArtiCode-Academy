import { afterEach, describe, expect, it } from 'vitest'
import { actionsFor, forgetRecent, matchScore, normalize, queryKind, readRecent, rememberRecent, RECENT_MAX } from './search.data'

describe('global search rules (redesign)', () => {
  afterEach(() => localStorage.clear())

  it('ignores Arabic spelling variants, diacritics and case', () => {
    expect(normalize('الإشعارات')).toBe(normalize('الاشعارات'))
    expect(normalize('فاتورة')).toBe(normalize('فاتوره'))
    expect(normalize('مُدرِّس')).toBe('مدرس')
    expect(normalize('  Python  A ')).toBe('python a')
  })

  it('ranks a start of text above a word start above a contained match', () => {
    expect(matchScore('pay', 'Payments')).toBeGreaterThan(matchScore('men', 'Payments'))
    expect(matchScore('rec', 'Record a payment')).toBe(80)
    expect(matchScore('payment', 'Record a payment')).toBe(60)
    expect(matchScore('xyz', 'Payments')).toBe(0)
    expect(matchScore('حضور', 'تسجيل الحضور')).toBeGreaterThan(0)
  })

  it('recognises numbers and e-mails', () => {
    expect(queryKind('INV-2026-00041')).toBe('invoice')
    expect(queryKind('rcpt-2026')).toBe('receipt')
    expect(queryKind('ACA-2026-00004')).toBe('serial')
    expect(queryKind('lina@example.com')).toBe('email')
    expect(queryKind('بايثون')).toBe('text')
  })

  it('offers an action only to whoever may open its page and holds its key', () => {
    const keys = actionsFor((nav) => nav === 'payments', (key) => key === 'payments.record').map((action) => action.key)
    expect(keys).toEqual(['recordPayment'])
  })

  it('keeps the recent searches newest first, once each, at most six', () => {
    for (let index = 0; index < 8; index += 1) rememberRecent('u1', { title: `T${index}`, path: `/p${index}`, group: 'users' })
    rememberRecent('u1', { title: 'T3', path: '/p3', group: 'users' })
    const recent = readRecent('u1')
    expect(recent).toHaveLength(RECENT_MAX)
    expect(recent[0]!.path).toBe('/p3')
    expect(new Set(recent.map((entry) => entry.path)).size).toBe(RECENT_MAX)
    forgetRecent('u1')
    expect(readRecent('u1')).toEqual([])
  })
})
