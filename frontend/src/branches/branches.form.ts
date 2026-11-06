// Branch form ↔ API bodies (MOD-02-T06 screen) on the pattern of
// courses/levels.form.ts: the create body carries only what was filled in,
// the PATCH body only fields whose normalised value differs from the loaded
// branch (null clears the address, phone and time zone; a localized text
// travels whole and keeps a Turkish text the form does not show), nothing
// changed → null (no request). The main/active rule of the server
// (`branch_is_main`) is mirrored so the form refuses it before any request.
import type { Branch, CreateBranchInput, UpdateBranchInput } from '../api/branches'
import { localizedOf, sameLabel } from '../courses/courses.form'

/** Branch codes: trimmed and upper-cased, 1–16 of A–Z 0–9 . _ - (mirror of BRANCH_CODE_PATTERN = LEVEL_CODE_PATTERN). */
export const BRANCH_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,15}$/
export const BRANCH_CODE_MAX_LENGTH = 16
/** `LOCALIZED_TEXT_MAX_LENGTH` of LocalizedTextDto (name and address). */
export const BRANCH_TEXT_MAX_LENGTH = 200

export interface BranchFormValues {
  code: string
  nameAr: string
  nameEn?: string
  addressAr?: string
  addressEn?: string
  phone?: string
  timezone?: string
  isMain: boolean
  isActive: boolean
}

export const EMPTY_BRANCH_FORM: BranchFormValues = {
  code: '',
  nameAr: '',
  nameEn: '',
  addressAr: '',
  addressEn: '',
  phone: '',
  timezone: '',
  isMain: false,
  isActive: true,
}

export function normaliseBranchCode(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

const trimmed = (value: string | null | undefined) => (value ?? '').trim()

/** Initial form values of a loaded branch (null → empty). */
export function branchFormValuesOf(branch: Branch): BranchFormValues {
  return {
    code: branch.code,
    nameAr: branch.name.ar,
    nameEn: branch.name.en ?? '',
    addressAr: branch.address?.ar ?? '',
    addressEn: branch.address?.en ?? '',
    phone: branch.phone ?? '',
    timezone: branch.timezone ?? '',
    isMain: branch.isMain,
    isActive: branch.isActive,
  }
}

/** Why a main-but-inactive outcome is refused — the `action` of `409 branch_is_main` on API-081/API-082. */
export type MainInactiveReason = 'deactivate' | 'promote_inactive'

/**
 * Mirror of the server rule "a main branch is always active": `promote_inactive`
 * when a branch that is not main yet (or a new one) would be main and inactive,
 * `deactivate` when the current main branch is deactivated without stepping
 * down; null when the outcome is allowed.
 */
export function mainInactiveReason(
  current: Pick<Branch, 'isMain'> | null,
  values: Pick<BranchFormValues, 'isMain' | 'isActive'>,
): MainInactiveReason | null {
  if (!values.isMain || values.isActive) return null
  return current?.isMain ? 'deactivate' : 'promote_inactive'
}

export function buildCreateBranchInput(values: BranchFormValues): CreateBranchInput {
  const input: CreateBranchInput = {
    code: normaliseBranchCode(values.code),
    name: localizedOf(values.nameAr, values.nameEn) ?? { ar: values.nameAr.trim() },
  }
  const address = localizedOf(values.addressAr, values.addressEn)
  if (address) input.address = address
  const phone = trimmed(values.phone)
  if (phone) input.phone = phone
  const timezone = trimmed(values.timezone)
  if (timezone) input.timezone = timezone
  // Server defaults: not main, active — send a flag only when it differs.
  if (values.isMain) input.isMain = true
  if (values.isActive === false) input.isActive = false
  return input
}

/** The smallest PATCH body (API-082), or null when nothing changed. */
export function planBranchPatch(branch: Branch, values: BranchFormValues): UpdateBranchInput | null {
  const body: UpdateBranchInput = {}
  const code = normaliseBranchCode(values.code)
  if (code && code !== branch.code) body.code = code
  const name = localizedOf(values.nameAr, values.nameEn, branch.name.tr)
  if (name && !sameLabel(name, branch.name)) body.name = name
  const address = localizedOf(values.addressAr, values.addressEn, branch.address?.tr)
  if (!sameLabel(address, branch.address)) body.address = address
  const phone = trimmed(values.phone) || null
  if (phone !== branch.phone) body.phone = phone
  const timezone = trimmed(values.timezone) || null
  if (timezone !== branch.timezone) body.timezone = timezone
  if (values.isMain !== branch.isMain) body.isMain = values.isMain
  if (values.isActive !== branch.isActive) body.isActive = values.isActive
  return Object.keys(body).length > 0 ? body : null
}

/**
 * Row action "make this the main branch" (API-082): an inactive branch must be
 * activated in the same request, else the server answers `promote_inactive`.
 */
export function promoteBranchBody(branch: Pick<Branch, 'isActive'>): UpdateBranchInput {
  return branch.isActive ? { isMain: true } : { isMain: true, isActive: true }
}
