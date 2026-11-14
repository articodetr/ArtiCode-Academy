import { describe, expect, it } from 'vitest'
import { defaultPeriod, inclusiveDays, monthsOf, periodProblem } from './reports.period'

describe('reports.period', () => {
  it('defaults to the last 30 days ending today', () => {
    expect(defaultPeriod('2026-11-14')).toEqual({ from: '2026-10-16', to: '2026-11-14' })
    expect(inclusiveDays('2026-10-16', '2026-11-14')).toBe(30)
  })

  it('mirrors the server range check: order and at most 366 inclusive days', () => {
    expect(periodProblem({ from: '2026-11-14', to: '2026-11-14' })).toBeNull()
    expect(periodProblem({ from: '2026-11-15', to: '2026-11-14' })).toBe('order')
    expect(periodProblem({ from: '2025-11-14', to: '2026-11-14' })).toBeNull() // 366 days
    expect(periodProblem({ from: '2025-11-13', to: '2026-11-14' })).toBe('tooLong')
    expect(periodProblem({ from: '', to: '2026-11-14' })).toBe('missing')
    expect(periodProblem({ from: '2026-02-30', to: '2026-03-01' })).toBe('missing')
  })

  it('lists the months a period touches', () => {
    expect(monthsOf({ from: '2025-12-20', to: '2026-02-01' })).toEqual(['2025-12', '2026-01', '2026-02'])
  })
})
