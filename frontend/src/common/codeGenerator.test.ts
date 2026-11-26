// TEST-332 — the random subject/level code (CH-0372).
import { describe, expect, it } from 'vitest'
import { LEVEL_CODE_PATTERN } from '../courses/levels.form'
import { SUBJECT_CODE_PATTERN } from '../courses/subjects.form'
import { LEVEL_CODE_PREFIX, SUBJECT_CODE_PREFIX, generateUniqueCode } from './codeGenerator'

describe('generateUniqueCode', () => {
  it('makes PREFIX-XXXX codes the server accepts, without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const subject = generateUniqueCode(SUBJECT_CODE_PREFIX, [])
      const level = generateUniqueCode(LEVEL_CODE_PREFIX, [])
      expect(subject).toMatch(/^SUB-[A-Z2-9]{4}$/)
      expect(level).toMatch(/^LVL-[A-Z2-9]{4}$/)
      expect(SUBJECT_CODE_PATTERN.test(subject)).toBe(true)
      expect(LEVEL_CODE_PATTERN.test(level)).toBe(true)
      expect(subject.slice(4) + level.slice(4)).not.toMatch(/[01OIL]/)
    }
  })

  it('never returns a code already in the list, whatever its case', () => {
    // A scripted random: the first two draws give SUB-AAAA (taken, in lower case), the next SUB-BBBB.
    const draws = [0, 0, 0, 0, 0.04, 0.04, 0.04, 0.04]
    let n = 0
    const random = () => draws[n++] ?? 0.5
    expect(generateUniqueCode('SUB', ['sub-aaaa'], random)).toBe('SUB-BBBB')
  })

  it('grows the code when the short ones keep clashing, so it always ends', () => {
    const code = generateUniqueCode('SUB', ['SUB-AAAA'], () => 0)
    expect(code).toBe('SUB-AAAAA')
  })
})
