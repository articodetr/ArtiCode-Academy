import { describe, expect, it } from 'vitest'
import { THREE_LEVELS, makeLevel } from '../test/courses'
import { buildCreateLevelInput, levelFormValuesOf, moveLevel, planLevelPatch } from './levels.form'

describe('level form helpers (MOD-04-T06)', () => {
  it('builds the create body from what was filled in only; isActive travels only to create an inactive level', () => {
    expect(buildCreateLevelInput({ code: ' beg ', nameAr: ' مبتدئ ', nameEn: '', descriptionAr: '', descriptionEn: '', isActive: true })).toEqual({
      code: 'BEG',
      name: { ar: 'مبتدئ' },
    })
    expect(buildCreateLevelInput({ code: 'ADV', nameAr: 'متقدم', nameEn: 'Advanced', descriptionAr: 'للخبراء', descriptionEn: '', isActive: false })).toEqual({
      code: 'ADV',
      name: { ar: 'متقدم', en: 'Advanced' },
      description: { ar: 'للخبراء' },
      isActive: false,
    })
  })

  it('sends no PATCH without a difference, and only the changed fields otherwise (keeping the Turkish name)', () => {
    const level = makeLevel({ name: { ar: 'مبتدئ', en: 'Beginner', tr: 'Başlangıç' }, description: { ar: 'وصف' } })
    expect(planLevelPatch(level, levelFormValuesOf(level))).toBeNull()
    expect(planLevelPatch(level, { ...levelFormValuesOf(level), nameEn: 'Starter', descriptionAr: '', isActive: false, code: 'beg' })).toEqual({
      name: { ar: 'مبتدئ', en: 'Starter', tr: 'Başlangıç' },
      description: null,
      isActive: false,
    })
  })

  it('moves one level up or down as a full permutation, and refuses the edges', () => {
    const levels = THREE_LEVELS()
    const ids = levels.map((level) => level.id)
    expect(moveLevel(levels, 0, 1)).toEqual([ids[1], ids[0], ids[2]])
    expect(moveLevel(levels, 2, -1)).toEqual([ids[0], ids[2], ids[1]])
    expect(moveLevel(levels, 0, -1)).toBeNull()
    expect(moveLevel(levels, 2, 1)).toBeNull()
  })
})
