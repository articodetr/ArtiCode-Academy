// Turns the values of the creation wizard into the body of POST /api/users
// (API-014): trimmed text, lower-cased identifiers, empty fields dropped, the
// profile object only for the kind that owns one.
import type { CreateEmployeeProfileInput, CreateStudentProfileInput, CreateUserInput, UserKind, UserLocale } from '../api/users'

export interface CreateUserFormValues {
  kind: UserKind
  fullName: string
  fullNameLatin?: string
  displayName?: string
  email?: string
  username?: string
  phone?: string
  locale?: UserLocale | ''
  studentProfile?: {
    studentNumber?: string
    dateOfBirth?: string
    enrolledOn?: string
    notes?: string
  }
  employeeProfile?: {
    employeeNumber?: string
    jobTitle?: string
    specialization?: string
    hiredOn?: string
  }
  roleKeys?: string[]
}

/** Which profile a kind creates along with the account (API-014). */
export const KIND_PROFILE: Readonly<Record<UserKind, 'student' | 'employee' | null>> = {
  student: 'student',
  teacher: 'employee',
  staff: 'employee',
  guardian: null,
}

/**
 * System roles that may be added on top of the kind's role without a 422:
 * `student` needs a student profile (profile_mismatch), `teacher`/`staff`
 * need an employee profile (employee_kind_required) — so each is offered
 * only where the profile exists. Custom roles can still be typed in.
 */
export function extraRoleOptions(kind: UserKind): string[] {
  switch (kind) {
    case 'student':
      return ['academy_admin', 'guardian']
    case 'teacher':
      return ['academy_admin', 'staff', 'guardian']
    case 'staff':
      return ['academy_admin', 'teacher', 'guardian']
    case 'guardian':
      return ['academy_admin']
  }
}

function clean(value: string | undefined, lowerCase = false): string | undefined {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return undefined
  return lowerCase ? trimmed.toLowerCase() : trimmed
}

function compact<T extends object>(object: T): T | undefined {
  const entries = Object.entries(object).filter(([, value]) => value !== undefined)
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as T)
}

export function buildCreateUserInput(values: CreateUserFormValues): CreateUserInput {
  const input: CreateUserInput = { kind: values.kind, fullName: (values.fullName ?? '').trim() }

  const email = clean(values.email, true)
  if (email) input.email = email
  const username = clean(values.username, true)
  if (username) input.username = username
  const phone = clean(values.phone)
  if (phone) input.phone = phone
  const fullNameLatin = clean(values.fullNameLatin)
  if (fullNameLatin) input.fullNameLatin = fullNameLatin
  const displayName = clean(values.displayName)
  if (displayName) input.displayName = displayName
  if (values.locale) input.locale = values.locale

  const profile = KIND_PROFILE[values.kind]
  if (profile === 'student' && values.studentProfile) {
    const student = compact<CreateStudentProfileInput>({
      studentNumber: clean(values.studentProfile.studentNumber),
      dateOfBirth: clean(values.studentProfile.dateOfBirth),
      enrolledOn: clean(values.studentProfile.enrolledOn),
      notes: clean(values.studentProfile.notes),
    })
    if (student) input.studentProfile = student
  }
  if (profile === 'employee' && values.employeeProfile) {
    const employee = compact<CreateEmployeeProfileInput>({
      employeeNumber: clean(values.employeeProfile.employeeNumber),
      jobTitle: clean(values.employeeProfile.jobTitle),
      specialization: clean(values.employeeProfile.specialization),
      hiredOn: clean(values.employeeProfile.hiredOn),
    })
    if (employee) input.employeeProfile = employee
  }

  const roleKeys = Array.from(
    new Set((values.roleKeys ?? []).map((key) => key.trim().toLowerCase()).filter((key) => key && key !== values.kind)),
  )
  if (roleKeys.length > 0) input.roleKeys = roleKeys

  return input
}
