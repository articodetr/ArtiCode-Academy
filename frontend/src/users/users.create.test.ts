import { describe, expect, it } from 'vitest'
import { buildCreateUserInput, extraRoleOptions } from './users.create'

describe('buildCreateUserInput', () => {
  it('trims text, lower-cases the identifiers and drops empty fields', () => {
    expect(
      buildCreateUserInput({
        kind: 'guardian',
        fullName: ' خالد محمود ',
        email: ' Khaled@Test.local ',
        username: '',
        phone: '  ',
        fullNameLatin: undefined,
        displayName: ' أبو عمر ',
        locale: 'en',
      }),
    ).toEqual({ kind: 'guardian', fullName: 'خالد محمود', email: 'khaled@test.local', displayName: 'أبو عمر', locale: 'en' })
  })

  it('includes the student profile (with notes) only for a student and never an empty object', () => {
    expect(
      buildCreateUserInput({
        kind: 'student',
        fullName: 'عمر خالد',
        username: 'omar',
        studentProfile: { studentNumber: ' S-2026-001 ', dateOfBirth: '2012-05-01', enrolledOn: '', notes: ' ملاحظة ' },
        employeeProfile: { employeeNumber: 'EMP-9' },
      }),
    ).toEqual({
      kind: 'student',
      fullName: 'عمر خالد',
      username: 'omar',
      studentProfile: { studentNumber: 'S-2026-001', dateOfBirth: '2012-05-01', notes: 'ملاحظة' },
    })
    expect(buildCreateUserInput({ kind: 'student', fullName: 'عمر', username: 'omar', studentProfile: { studentNumber: '' } })).toEqual({
      kind: 'student',
      fullName: 'عمر',
      username: 'omar',
    })
  })

  it('includes the employee profile for teachers and staff', () => {
    expect(
      buildCreateUserInput({
        kind: 'staff',
        fullName: 'ليلى',
        email: 'laila@test.local',
        employeeProfile: { employeeNumber: 'EMP-017', jobTitle: 'محاسبة', specialization: '', hiredOn: '2025-02-10' },
      }).employeeProfile,
    ).toEqual({ employeeNumber: 'EMP-017', jobTitle: 'محاسبة', hiredOn: '2025-02-10' })
  })

  it('normalises the extra roles: lower-case, unique, without the kind role itself, omitted when empty', () => {
    expect(buildCreateUserInput({ kind: 'teacher', fullName: 'سارة', email: 's@test.local', roleKeys: [' Academy_Admin ', 'teacher', 'staff', 'staff'] }).roleKeys).toEqual([
      'academy_admin',
      'staff',
    ])
    expect(buildCreateUserInput({ kind: 'teacher', fullName: 'سارة', email: 's@test.local', roleKeys: ['teacher'] }).roleKeys).toBeUndefined()
  })
})

describe('extraRoleOptions', () => {
  it('offers only the roles that will not trigger a profile 422 for the kind', () => {
    expect(extraRoleOptions('student')).toEqual(['academy_admin', 'guardian'])
    expect(extraRoleOptions('teacher')).toEqual(['academy_admin', 'staff', 'guardian'])
    expect(extraRoleOptions('staff')).toEqual(['academy_admin', 'teacher', 'guardian'])
    expect(extraRoleOptions('guardian')).toEqual(['academy_admin'])
  })
})
