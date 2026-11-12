import { describe, expect, it } from 'vitest'
import { MONEY_MAX } from '../api/feePlans'
import { evenSplitCents, fromCents, isDiscountAmount, isPositiveAmount, isSharePercent, isTwoDecimalAmount, isWholeDays, sumCents, toCents } from './finance.money'

describe('finance money helpers', () => {
  it('takes two decimals at most and refuses the exponent forms (Number(v.toFixed(2)) === v)', () => {
    for (const value of [0, 1, 1.5, 1.25, 1500, 9999999999.99, 0.01]) expect(isTwoDecimalAmount(value)).toBe(true)
    for (const value of [1.005, 0.001, 1e-7, 0.1 + 0.2, Number.NaN, Number.POSITIVE_INFINITY, '10', null]) expect(isTwoDecimalAmount(value)).toBe(false)
  })

  it('bounds the amounts, the discount, the shares and the day offsets as the DTOs do', () => {
    expect(isPositiveAmount(0.01)).toBe(true)
    expect(isPositiveAmount(0)).toBe(false)
    expect(isPositiveAmount(MONEY_MAX)).toBe(true)
    expect(isPositiveAmount(MONEY_MAX + 1)).toBe(false)
    expect(isDiscountAmount(0)).toBe(true)
    expect(isDiscountAmount(-0.01)).toBe(false)
    expect(isSharePercent(100)).toBe(true)
    expect(isSharePercent(100.01)).toBe(false)
    expect(isSharePercent(33.33)).toBe(true)
    expect(isWholeDays(0, 3650)).toBe(true)
    expect(isWholeDays(3651, 3650)).toBe(false)
    expect(isWholeDays(1.5, 3650)).toBe(false)
  })

  it('sums in integer cents, never in floating point', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(sumCents([0.1, 0.2])).toBe(30)
    expect(toCents(1.15)).toBe(115)
    expect(fromCents(sumCents([1000, 200, 0.05]))).toBe(1200.05)
    // An invalid value counts as nothing (its own field says why).
    expect(sumCents([100, 1e-7, '5'])).toBe(10000)
  })

  it('splits a total evenly, the remainder on the last part', () => {
    expect(evenSplitCents(10000, 3)).toEqual([3333, 3333, 3334])
    expect(evenSplitCents(120000, 2)).toEqual([60000, 60000])
    expect(evenSplitCents(5, 4)).toEqual([1, 1, 1, 2])
    expect(evenSplitCents(100, 0)).toEqual([])
  })
})
