// Question bank form ↔ API bodies (MOD-09 phase 2 — OEX-T07, API-261/API-263),
// on the pattern of branches/branches.form.ts: the create body carries only
// what was filled in (no description and no course unless given); an edit
// sends the smallest PATCH the server would write (planBankUpdate() of
// backend/src/questions/questions.rules.ts — keep in sync): the name when it
// changed, the description and the course when they changed, `null` clearing
// either; nothing changed → null (no request). A localized text travels as a
// whole `{ ar, en? }` object and keeps a Turkish text the form does not show.
// Pure; unit-tested in questionBanks.form.test.ts.
import type { CreateQuestionBankInput, QuestionBank, UpdateQuestionBankInput } from '../api/questionBanks'
import { englishWithoutArabic, localizedOf, sameLabel } from '../courses/courses.form'

export interface BankFormValues {
  nameAr: string
  nameEn?: string
  descriptionAr?: string
  descriptionEn?: string
  /** The course the bank is filed under; empty = none. */
  courseId?: string | null
}

const text = (value: string | undefined) => (value ?? '').trim()

/** The form of a new bank. */
export function newBankForm(): BankFormValues {
  return { nameAr: '', nameEn: '', descriptionAr: '', descriptionEn: '', courseId: undefined }
}

/** Initial form values of a loaded bank (null → empty). */
export function bankFormValuesOf(bank: QuestionBank): BankFormValues {
  return {
    nameAr: bank.name.ar,
    nameEn: bank.name.en ?? '',
    descriptionAr: bank.description?.ar ?? '',
    descriptionEn: bank.description?.en ?? '',
    courseId: bank.course?.id,
  }
}

/** The body of API-261: the name, and the description and the course only when given. */
export function buildCreateBankInput(values: BankFormValues): CreateQuestionBankInput {
  const input: CreateQuestionBankInput = { name: localizedOf(values.nameAr, values.nameEn) ?? { ar: text(values.nameAr) } }
  const description = localizedOf(values.descriptionAr, values.descriptionEn)
  if (description) input.description = description
  if (values.courseId) input.courseId = values.courseId
  return input
}

/** The smallest PATCH body (API-263), or null when nothing changed. */
export function planBankPatch(bank: QuestionBank, values: BankFormValues): UpdateQuestionBankInput | null {
  const body: UpdateQuestionBankInput = {}
  const name = localizedOf(values.nameAr, values.nameEn, bank.name.tr)
  if (name && !sameLabel(name, bank.name)) body.name = name
  const description = localizedOf(values.descriptionAr, values.descriptionEn, bank.description?.tr)
  if (!sameLabel(description, bank.description)) body.description = description
  const courseId = values.courseId || null
  if (courseId !== (bank.course?.id ?? null)) body.courseId = courseId
  return Object.keys(body).length > 0 ? body : null
}

/**
 * Whether the bank form holds unsaved work: a new bank with anything written or
 * chosen; an existing one whose smallest PATCH is non-empty, or which holds what
 * the save would refuse instead of sending — an emptied Arabic name, an English
 * description without its Arabic text. A field changed back holds nothing.
 */
export function bankFormHasChanges(bank: QuestionBank | null, values: BankFormValues): boolean {
  if (!bank) {
    return text(values.nameAr) !== '' || text(values.nameEn) !== '' || text(values.descriptionAr) !== '' || text(values.descriptionEn) !== '' || Boolean(values.courseId)
  }
  return text(values.nameAr) === '' || englishWithoutArabic(values.descriptionAr, values.descriptionEn) || planBankPatch(bank, values) !== null
}
