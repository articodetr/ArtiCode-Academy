import { describe, expect, it } from 'vitest'
import { isQuestionPointsValid, tagsProblemOf } from './questions.validation'

describe('isQuestionPointsValid() — `points` of CreateQuestionDto', () => {
  it('accepts 0.01..9999.99 with at most two decimals', () => {
    for (const value of [0.01, 0.5, 1, 2.25, 100, 9999.99]) expect(isQuestionPointsValid(value)).toBe(true)
  })

  it('refuses zero, a negative, more than the limit, a third decimal, an exponent form and what is no number', () => {
    for (const value of [0, -1, 0.001, 0.009, 10000, 9999.999, 1.005, 1e-7, Number.NaN, Number.POSITIVE_INFINITY, '2', null, undefined]) expect(isQuestionPointsValid(value)).toBe(false)
  })
})

describe('tagsProblemOf() — `tags` of CreateQuestionDto', () => {
  it('accepts up to ten tags of up to 40 characters', () => {
    expect(tagsProblemOf(undefined)).toBeNull()
    expect(tagsProblemOf([])).toBeNull()
    expect(tagsProblemOf(Array.from({ length: 10 }, (_, index) => `tag-${index}`))).toBeNull()
    expect(tagsProblemOf(['a'.repeat(40)])).toBeNull()
  })

  it('names an eleventh tag, and a tag of 41 characters', () => {
    expect(tagsProblemOf(Array.from({ length: 11 }, (_, index) => `tag-${index}`))).toBe('tagsMax')
    expect(tagsProblemOf(['loops', 'a'.repeat(41)])).toBe('tagMax')
    // Too many comes first.
    expect(tagsProblemOf([...Array.from({ length: 10 }, (_, index) => `tag-${index}`), 'a'.repeat(41)])).toBe('tagsMax')
  })
})
