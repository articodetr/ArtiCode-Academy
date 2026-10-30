// Turns the edit form of the user drawer into the smallest PATCH body
// (API-018): only fields whose normalised value differs from the loaded detail
// are sent; a cleared optional field becomes null; nothing changed → null.
import type {
  UpdateEmployeeProfileInput,
  UpdateStudentProfileInput,
  UpdateUserInput,
  UserDetail,
  UserLocale,
} from '../api/users'

export interface EditStudentProfileValues {
  studentNumber?: string
  dateOfBirth?: string
  enrolledOn?: string
}

export interface EditEmployeeProfileValues {
  employeeNumber?: string
  jobTitle?: string
  specialization?: string
  hiredOn?: string
}

/** Form values: every field a string (empty = cleared); nested profiles only for the profile the user has. */
export interface EditUserFormValues {
  fullName: string
  fullNameLatin?: string
  displayName?: string
  email?: string
  username?: string
  phone?: string
  avatarUrl?: string
  locale?: UserLocale | ''
  studentProfile?: EditStudentProfileValues
  employeeProfile?: EditEmployeeProfileValues
}

const text = (value: string | null | undefined) => value ?? ''

/** Initial values of the edit form from the loaded detail (null → empty string). */
export function editFormValuesOf(user: UserDetail): EditUserFormValues {
  const values: EditUserFormValues = {
    fullName: user.fullName,
    fullNameLatin: text(user.fullNameLatin),
    displayName: text(user.displayName),
    email: text(user.email),
    username: text(user.username),
    phone: text(user.phone),
    avatarUrl: text(user.avatarUrl),
    locale: isUserLocale(user.locale) ? user.locale : '',
  }
  if (user.studentProfile) {
    values.studentProfile = {
      studentNumber: text(user.studentProfile.studentNumber),
      dateOfBirth: text(user.studentProfile.dateOfBirth),
      enrolledOn: text(user.studentProfile.enrolledOn),
    }
  }
  if (user.employeeProfile) {
    values.employeeProfile = {
      employeeNumber: text(user.employeeProfile.employeeNumber),
      jobTitle: text(user.employeeProfile.jobTitle),
      specialization: text(user.employeeProfile.specialization),
      hiredOn: text(user.employeeProfile.hiredOn),
    }
  }
  return values
}

function isUserLocale(value: string | null | undefined): value is UserLocale {
  return value === 'ar' || value === 'en' || value === 'tr'
}

/** Same normalisation as the backend DTO transforms: trimmed; identifiers lower-cased. */
function normalise(value: string | undefined, lowerCase = false): string {
  const trimmed = (value ?? '').trim()
  return lowerCase ? trimmed.toLowerCase() : trimmed
}

/** The PATCH value for an optional field, or undefined when it did not change. */
function changedOptional(current: string | null, next: string | undefined, lowerCase = false): string | null | undefined {
  const value = normalise(next, lowerCase)
  if (value === (current ?? '')) return undefined
  return value === '' ? null : value
}

function pickChanges<T extends object>(changes: T): T | undefined {
  const entries = Object.entries(changes).filter(([, value]) => value !== undefined)
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as T)
}

export interface PlanUserPatchOptions {
  /** Whether the caller sees the contact identifiers (`users.read_contact`); false leaves them untouched. */
  contact: boolean
}

/**
 * The PATCH body that moves `current` to `values`, or null when nothing
 * differs. `fullName` is only sent when it changed and is not blank (the
 * backend never clears it); a user without a profile never gets one here.
 */
export function planUserPatch(current: UserDetail, values: EditUserFormValues, options: PlanUserPatchOptions): UpdateUserInput | null {
  const body: UpdateUserInput = {}

  const fullName = normalise(values.fullName)
  if (fullName && fullName !== current.fullName) body.fullName = fullName

  const fullNameLatin = changedOptional(current.fullNameLatin, values.fullNameLatin)
  if (fullNameLatin !== undefined) body.fullNameLatin = fullNameLatin
  const displayName = changedOptional(current.displayName, values.displayName)
  if (displayName !== undefined) body.displayName = displayName
  const avatarUrl = changedOptional(current.avatarUrl, values.avatarUrl)
  if (avatarUrl !== undefined) body.avatarUrl = avatarUrl

  const locale = values.locale ? values.locale : null
  if (locale !== (isUserLocale(current.locale) ? current.locale : null)) body.locale = locale

  if (options.contact) {
    const email = changedOptional(current.email, values.email, true)
    if (email !== undefined) body.email = email
    const username = changedOptional(current.username, values.username, true)
    if (username !== undefined) body.username = username
    const phone = changedOptional(current.phone, values.phone)
    if (phone !== undefined) body.phone = phone
  }

  if (current.studentProfile && values.studentProfile) {
    const profile = pickChanges<UpdateStudentProfileInput>({
      studentNumber: changedOptional(current.studentProfile.studentNumber, values.studentProfile.studentNumber),
      dateOfBirth: changedOptional(current.studentProfile.dateOfBirth, values.studentProfile.dateOfBirth),
      enrolledOn: changedOptional(current.studentProfile.enrolledOn, values.studentProfile.enrolledOn),
    })
    if (profile) body.studentProfile = profile
  }

  if (current.employeeProfile && values.employeeProfile) {
    const profile = pickChanges<UpdateEmployeeProfileInput>({
      employeeNumber: changedOptional(current.employeeProfile.employeeNumber, values.employeeProfile.employeeNumber),
      jobTitle: changedOptional(current.employeeProfile.jobTitle, values.employeeProfile.jobTitle),
      specialization: changedOptional(current.employeeProfile.specialization, values.employeeProfile.specialization),
      hiredOn: changedOptional(current.employeeProfile.hiredOn, values.employeeProfile.hiredOn),
    })
    if (profile) body.employeeProfile = profile
  }

  return Object.keys(body).length === 0 ? null : body
}
