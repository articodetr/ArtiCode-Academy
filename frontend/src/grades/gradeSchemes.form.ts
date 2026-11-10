// Grade scheme form ↔ API bodies (J-F44 — MOD-09-T08 part a, API-123/API-124)
// on the pattern of branches/branches.form.ts. The create body carries what was
// filled in (a letter only when given, `isDefault` only when it matters); an
// edit sends the smallest PATCH the server would write — planned by the mirror
// of planGradeSchemeUpdate() (gradeSchemes.changes.ts): the name when it
// changed, the bands as a whole list only when they differ in canonical
// (ascending) order, nothing changed → null (no request). Localized texts
// travel whole and keep a Turkish text the form does not show (the name's, and
// each band's through a hidden field that moves with its band). The row
// actions (make default, deactivate, delete) read the same mirror.
import type { CreateGradeSchemeInput, GradeScheme, GradeSchemeBandInput, UpdateGradeSchemeInput } from '../api/gradeSchemes'
import { GRADE_SCHEME_BANDS_MAX, GRADE_SCHEME_BANDS_MIN } from '../api/gradeSchemes'
import { localizedOf } from '../courses/courses.form'
import { checkBands, percentText, planGradeSchemeUpdate, sortBands } from './gradeSchemes.changes'
import type { CurrentScheme, DefaultSchemeAction, SchemeBand } from './gradeSchemes.changes'

export interface BandFormValues {
  minPercent?: number | null
  labelAr?: string
  labelEn?: string
  /** The loaded band's Turkish label: not shown (the form edits Arabic and English), kept with its band. */
  labelTr?: string
  letter?: string
  isPass?: boolean
}

export interface GradeSchemeFormValues {
  nameAr: string
  nameEn?: string
  bands: BandFormValues[]
  /** Create only: the new scheme becomes the default (the previous default steps down). */
  isDefault?: boolean
}

/** A band added in the editor: no minimum yet, and failing — a passing band above it is then caught by `pass_not_ascending`. */
export function emptyBand(): BandFormValues {
  return { minPercent: null, labelAr: '', labelEn: '', letter: '', isPass: false }
}

/** A new scheme starts with the two bands every scheme needs: a failing one at 0 and a passing one (labels left to fill). */
export function newGradeSchemeForm(): GradeSchemeFormValues {
  return {
    nameAr: '',
    nameEn: '',
    bands: [
      { minPercent: 0, labelAr: '', labelEn: '', letter: '', isPass: false },
      { minPercent: 60, labelAr: '', labelEn: '', letter: '', isPass: true },
    ],
    isDefault: false,
  }
}

/** Initial form values of a loaded scheme (its bands in the server's ascending order). */
export function gradeSchemeFormValuesOf(scheme: GradeScheme): GradeSchemeFormValues {
  return {
    nameAr: scheme.name.ar,
    nameEn: scheme.name.en ?? '',
    bands: scheme.bands.map((band) => ({
      minPercent: band.minPercent,
      labelAr: band.label.ar,
      labelEn: band.label.en ?? '',
      ...(band.label.tr ? { labelTr: band.label.tr } : {}),
      letter: band.letter ?? '',
      isPass: band.isPass,
    })),
  }
}

/**
 * `IsNumber({ maxDecimalPlaces: 2 })` + `Min(0)` + `Max(100)` of `minPercent`
 * (class-validator counts the decimals of `value.toString()`).
 */
export function isValidMinPercent(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return false
  if (value % 1 === 0) return true
  const decimals = value.toString().split('.')[1]
  return decimals !== undefined && decimals.length <= 2
}

/** Form bands → the canonical bands of the mirror (two-decimal minimums, trimmed texts, blank letter = none). */
export function schemeBandsOf(bands: readonly BandFormValues[]): SchemeBand[] {
  return bands.map((band) => ({
    // An empty minimum stays NaN (never 0): it differs from every loaded band.
    minPercent: percentText(band.minPercent ?? Number.NaN),
    label: localizedOf(band.labelAr, band.labelEn, band.labelTr) ?? { ar: '' },
    letter: (band.letter ?? '').trim() || null,
    isPass: band.isPass === true,
  }))
}

/** The scheme as the mirror compares it (`currentOf()` of the service). */
export function currentSchemeOf(scheme: GradeScheme): CurrentScheme {
  return {
    name: scheme.name,
    isDefault: scheme.isDefault,
    isActive: scheme.isActive,
    bands: scheme.bands.map((band) => ({ minPercent: percentText(band.minPercent), label: band.label, letter: band.letter, isPass: band.isPass })),
  }
}

/** A canonical band as the body carries it: `minPercent` a JSON number, `letter` only when set. */
function bandInputOf(band: SchemeBand): GradeSchemeBandInput {
  const input: GradeSchemeBandInput = { minPercent: Number(band.minPercent), label: band.label, isPass: band.isPass }
  if (band.letter) input.letter = band.letter
  return input
}

/** API-123 body; `firstScheme` = the academy has no scheme yet, so the server makes this one the default anyway. */
export function buildCreateGradeSchemeInput(values: GradeSchemeFormValues, firstScheme: boolean): CreateGradeSchemeInput {
  const input: CreateGradeSchemeInput = {
    name: localizedOf(values.nameAr, values.nameEn) ?? { ar: values.nameAr.trim() },
    bands: sortBands(schemeBandsOf(values.bands)).map(bandInputOf),
  }
  // Server default: not the default — send the flag only when it changes something.
  if (values.isDefault === true && !firstScheme) input.isDefault = true
  return input
}

/** The smallest PATCH body (API-124) of the edit form, or null when nothing changed. */
export function planGradeSchemePatch(scheme: GradeScheme, values: GradeSchemeFormValues): UpdateGradeSchemeInput | null {
  const name = localizedOf(values.nameAr, values.nameEn, scheme.name.tr)
  const plan = planGradeSchemeUpdate(currentSchemeOf(scheme), { ...(name ? { name } : {}), bands: schemeBandsOf(values.bands ?? []) })
  const body: UpdateGradeSchemeInput = {}
  if (plan.name) body.name = plan.name
  if (plan.bands) body.bands = plan.bands.map(bandInputOf)
  return Object.keys(body).length > 0 ? body : null
}

/** Normalised form values, for telling a new scheme's form from its untouched start. */
function snapshotOf(values: Partial<GradeSchemeFormValues>): string {
  return JSON.stringify({
    nameAr: (values.nameAr ?? '').trim(),
    nameEn: (values.nameEn ?? '').trim(),
    bands: (values.bands ?? []).map((band) => [band?.minPercent ?? null, (band?.labelAr ?? '').trim(), (band?.labelEn ?? '').trim(), (band?.letter ?? '').trim(), band?.isPass === true]),
    isDefault: values.isDefault === true,
  })
}

/** True while the form holds work a close would lose: an edit that would send something (or an emptied name), a new scheme off its start. */
export function gradeSchemeFormHasChanges(scheme: GradeScheme | null, values: Partial<GradeSchemeFormValues>): boolean {
  if (!scheme) return snapshotOf(values) !== snapshotOf(newGradeSchemeForm())
  const complete: GradeSchemeFormValues = { nameAr: values.nameAr ?? '', nameEn: values.nameEn, bands: values.bands ?? [] }
  return planGradeSchemePatch(scheme, complete) !== null || complete.nameAr.trim() !== scheme.name.ar
}

/** A problem of the band list, as a translation key under gradeSchemes.validation (+ its values). */
export interface BandListIssue {
  key: string
  params?: Record<string, string>
}

/**
 * The list-level rules of the bands editor: 2..20 bands (ArrayMinSize /
 * ArrayMaxSize), then the server's band rules (checkBands()) once every
 * minimum is a valid number — a missing or malformed one is its field's message.
 */
export function bandListIssues(bands: readonly (BandFormValues | undefined)[] | undefined): BandListIssue[] {
  const list = (bands ?? []).map((band) => band ?? {})
  if (list.length < GRADE_SCHEME_BANDS_MIN) return [{ key: 'gradeSchemes.validation.bandsMin', params: { min: String(GRADE_SCHEME_BANDS_MIN) } }]
  if (list.length > GRADE_SCHEME_BANDS_MAX) return [{ key: 'gradeSchemes.validation.bandsMax', params: { max: String(GRADE_SCHEME_BANDS_MAX) } }]
  if (!list.every((band) => isValidMinPercent(band.minPercent))) return []
  const { problems, duplicates } = checkBands(schemeBandsOf(list))
  return problems.map((problem) =>
    problem === 'duplicate_min_percent' ? { key: `gradeSchemes.validation.${problem}`, params: { duplicates: duplicates.join(', ') } } : { key: `gradeSchemes.validation.${problem}` },
  )
}

/** Row action «make default» (API-124): an inactive scheme is activated in the same request, else the server answers `promote_inactive`. */
export function promoteSchemeBody(scheme: Pick<GradeScheme, 'isActive'>): UpdateGradeSchemeInput {
  return scheme.isActive ? { isDefault: true } : { isDefault: true, isActive: true }
}

/** Why the row action «deactivate» is refused (the mirror's `deactivate` for the default), or null. */
export function deactivateRefusalOf(scheme: GradeScheme): DefaultSchemeAction | null {
  return planGradeSchemeUpdate(currentSchemeOf(scheme), { isActive: false }).refusal ?? null
}

/** Why the row action «delete» is refused, in the order of GradeSchemesService.remove(): the default, then a used scheme; null = allowed. */
export type DeleteBlocker = 'default' | 'in_use'

export function deleteBlockerOf(scheme: Pick<GradeScheme, 'isDefault' | 'finalGradeCount'>): DeleteBlocker | null {
  if (scheme.isDefault) return 'default'
  if ((scheme.finalGradeCount ?? 0) > 0) return 'in_use'
  return null
}
