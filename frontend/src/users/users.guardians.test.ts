import { describe, expect, it } from 'vitest'
import { makeUserDetail } from '../test/users'
import { buildLinkInput, counterpartRole, linkRefusal, linkSidesOf, partiesOf, planLinkUpdate } from './users.guardians'

describe('link sides and parties', () => {
  it('gives a student the guardians tab, a guardian the students tab, both to a user holding both, and keeps a tab for orphaned links', () => {
    expect(linkSidesOf(makeUserDetail())).toEqual(['guardians'])
    expect(linkSidesOf(makeUserDetail({ roles: [{ key: 'guardian', label: { ar: 'ولي أمر' } }], guardians: [], students: [] }))).toEqual(['students'])
    expect(
      linkSidesOf(makeUserDetail({ roles: [{ key: 'student', label: { ar: 'طالب' } }, { key: 'guardian', label: { ar: 'ولي أمر' } }] })),
    ).toEqual(['guardians', 'students'])
    expect(linkSidesOf(makeUserDetail({ roles: [{ key: 'teacher', label: { ar: 'معلم' } }] }))).toEqual(['guardians'])
    expect(linkSidesOf(makeUserDetail({ roles: [{ key: 'teacher', label: { ar: 'معلم' } }], guardians: [] }))).toEqual([])
  })

  it('addresses every write to the student’s path and searches the counterpart role', () => {
    expect(partiesOf('guardians', 'S', 'G')).toEqual({ studentId: 'S', guardianId: 'G' })
    expect(partiesOf('students', 'G', 'S')).toEqual({ studentId: 'S', guardianId: 'G' })
    expect(counterpartRole('guardians')).toBe('guardian')
    expect(counterpartRole('students')).toBe('student')
  })
})

describe('local refusals and bodies', () => {
  it('refuses the same person before any request (AC3) and a party already linked', () => {
    expect(linkRefusal('S', 'S', [])).toBe('same_person')
    expect(linkRefusal('S', 'G', ['G', 'H'])).toBe('already_linked')
    expect(linkRefusal('S', 'X', ['G'])).toBeNull()
    expect(linkRefusal('S', undefined, ['G'])).toBeNull()
  })

  it('builds the API-031 body with isPrimary only when true, from either side', () => {
    expect(buildLinkInput('guardians', 'S', { otherId: 'G', relationship: 'mother', isPrimary: true })).toEqual({ guardianId: 'G', relationship: 'mother', isPrimary: true })
    expect(buildLinkInput('students', 'G', { otherId: 'S', relationship: 'father', isPrimary: false })).toEqual({ guardianId: 'G', relationship: 'father' })
  })

  it('plans the smallest PATCH and nothing when nothing changes', () => {
    const current = { relationship: 'father' as const, isPrimary: false }
    expect(planLinkUpdate(current, { isPrimary: true })).toEqual({ isPrimary: true })
    expect(planLinkUpdate(current, { relationship: 'legal_guardian', isPrimary: false })).toEqual({ relationship: 'legal_guardian' })
    expect(planLinkUpdate(current, { relationship: 'father' })).toBeNull()
    expect(planLinkUpdate(current, {})).toBeNull()
  })
})
