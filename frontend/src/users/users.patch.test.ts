import { describe, expect, it } from 'vitest'
import { makeUserDetail } from '../test/users'
import { editFormValuesOf, planUserPatch } from './users.patch'

const CONTACT = { contact: true }

describe('editFormValuesOf', () => {
  it('turns nulls into empty strings and includes only the profile the user has', () => {
    const values = editFormValuesOf(makeUserDetail())
    expect(values).toEqual({
      fullName: 'عمر خالد',
      fullNameLatin: 'Omar Khaled',
      displayName: '',
      email: 'omar@test.local',
      username: 'omar',
      phone: '',
      avatarUrl: '',
      locale: '',
      studentProfile: { studentNumber: 'S-2026-001', dateOfBirth: '2012-05-01', enrolledOn: '2026-09-01' },
    })
    expect(values.employeeProfile).toBeUndefined()
  })
})

describe('planUserPatch', () => {
  it('returns null when the form still holds the loaded values', () => {
    const user = makeUserDetail()
    expect(planUserPatch(user, editFormValuesOf(user), CONTACT)).toBeNull()
  })

  it('sends only the changed fields, trimmed, with null for a cleared optional field', () => {
    const user = makeUserDetail({ phone: '+905551234567' })
    const values = { ...editFormValuesOf(user), displayName: '  عمر  ', phone: '', fullNameLatin: 'Omar Khaled' }
    expect(planUserPatch(user, values, CONTACT)).toEqual({ displayName: 'عمر', phone: null })
  })

  it('lower-cases the login identifiers like the server does and ignores case-only differences', () => {
    const user = makeUserDetail()
    const values = { ...editFormValuesOf(user), email: ' Omar@Test.local ', username: 'OMAR' }
    expect(planUserPatch(user, values, CONTACT)).toBeNull()
    expect(planUserPatch(user, { ...values, email: 'New@Test.local' }, CONTACT)).toEqual({ email: 'new@test.local' })
  })

  it('never touches contact identifiers for a caller without users.read_contact (reduced projection)', () => {
    const user = makeUserDetail({ email: null, username: null, phone: null })
    const values = { ...editFormValuesOf(user), email: 'x@test.local', phone: '+905550000000', displayName: 'عمر' }
    expect(planUserPatch(user, values, { contact: false })).toEqual({ displayName: 'عمر' })
  })

  it('does not send a blank or unchanged fullName (the server never clears it)', () => {
    const user = makeUserDetail()
    expect(planUserPatch(user, { ...editFormValuesOf(user), fullName: '   ' }, CONTACT)).toBeNull()
    expect(planUserPatch(user, { ...editFormValuesOf(user), fullName: ' عمر خالد الثاني ' }, CONTACT)).toEqual({
      fullName: 'عمر خالد الثاني',
    })
  })

  it('maps the locale: a cleared select becomes null, an unchanged one is omitted', () => {
    const user = makeUserDetail({ locale: 'ar' })
    const values = editFormValuesOf(user)
    expect(values.locale).toBe('ar')
    expect(planUserPatch(user, { ...values, locale: '' }, CONTACT)).toEqual({ locale: null })
    expect(planUserPatch(user, { ...values, locale: 'en' }, CONTACT)).toEqual({ locale: 'en' })
    expect(planUserPatch(makeUserDetail({ locale: null }), { ...values, locale: undefined }, CONTACT)).toBeNull()
  })

  it('diffs the nested profile field by field and omits an unchanged profile object', () => {
    const user = makeUserDetail()
    const values = editFormValuesOf(user)
    expect(
      planUserPatch(user, { ...values, studentProfile: { ...values.studentProfile, enrolledOn: '', studentNumber: 'S-2026-002' } }, CONTACT),
    ).toEqual({ studentProfile: { studentNumber: 'S-2026-002', enrolledOn: null } })

    const employee = makeUserDetail({
      roles: [{ key: 'teacher', label: { ar: 'معلم' } }],
      studentProfile: null,
      employeeProfile: { employeeNumber: 'EMP-1', kind: 'teacher', jobTitle: null, specialization: null, hiredOn: null, isActive: true },
    })
    const employeeValues = editFormValuesOf(employee)
    expect(employeeValues.studentProfile).toBeUndefined()
    expect(planUserPatch(employee, { ...employeeValues, employeeProfile: { ...employeeValues.employeeProfile, jobTitle: ' معلم رياضيات ' } }, CONTACT)).toEqual({
      employeeProfile: { jobTitle: 'معلم رياضيات' },
    })
  })

  it('ignores profile values for a profile the user does not have (no 422 round trip)', () => {
    const guardian = makeUserDetail({ studentProfile: null, guardians: [], roles: [{ key: 'guardian', label: { ar: 'ولي أمر' } }] })
    const values = { ...editFormValuesOf(guardian), studentProfile: { studentNumber: 'S-1' } }
    expect(planUserPatch(guardian, values, CONTACT)).toBeNull()
  })
})
