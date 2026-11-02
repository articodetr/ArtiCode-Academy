// Syllabus editor ↔ API-049 body (MOD-04-T06). The editor holds one draft per
// item in display order; the PUT body is the complete list (an `id` keeps an
// item, no `id` creates one, a missing item is deleted, the position is the
// index). An existing item keeps a Turkish text the form does not show. The
// unchanged list is not sent (AC1) — the server would write nothing anyway.
import type { SyllabusItem, SyllabusItemInput } from '../api/syllabus'
import { localizedOf, sameLabel } from './courses.form'

export interface SyllabusDraft {
  /** Present for an item the server already holds. */
  id?: string
  titleAr: string
  titleEn?: string
  descriptionAr?: string
  descriptionEn?: string
  estimatedMinutes?: number | null
}

export interface SyllabusFormValues {
  items?: SyllabusDraft[]
}

export function emptySyllabusDraft(): SyllabusDraft {
  return { titleAr: '', titleEn: '', descriptionAr: '', descriptionEn: '', estimatedMinutes: null }
}

export function syllabusDraftsOf(items: readonly SyllabusItem[]): SyllabusDraft[] {
  return items.map((item) => ({
    id: item.id,
    titleAr: item.title.ar,
    titleEn: item.title.en ?? '',
    descriptionAr: item.description?.ar ?? '',
    descriptionEn: item.description?.en ?? '',
    estimatedMinutes: item.estimatedMinutes,
  }))
}

/** The PUT items in display order; only filled optional fields travel. */
export function buildSyllabusInput(drafts: readonly SyllabusDraft[], saved: readonly SyllabusItem[]): SyllabusItemInput[] {
  const stored = new Map(saved.map((item) => [item.id, item]))
  return drafts.map((draft) => {
    const previous = draft.id ? stored.get(draft.id) : undefined
    const item: SyllabusItemInput = {
      title: localizedOf(draft.titleAr, draft.titleEn, previous?.title.tr) ?? { ar: draft.titleAr.trim() },
    }
    if (draft.id) item.id = draft.id
    const description = localizedOf(draft.descriptionAr, draft.descriptionEn, previous?.description?.tr)
    if (description) item.description = description
    if (draft.estimatedMinutes !== undefined && draft.estimatedMinutes !== null) item.estimatedMinutes = draft.estimatedMinutes
    return item
  })
}

/** The PUT body, or null when the edited list equals the stored syllabus (same items, order and values). */
export function planSyllabusReplacement(saved: readonly SyllabusItem[], drafts: readonly SyllabusDraft[]): SyllabusItemInput[] | null {
  const items = buildSyllabusInput(drafts, saved)
  const unchanged =
    items.length === saved.length &&
    items.every((item, index) => {
      const stored = saved[index]!
      return (
        item.id === stored.id &&
        sameLabel(item.title, stored.title) &&
        sameLabel(item.description ?? null, stored.description) &&
        (item.estimatedMinutes ?? null) === stored.estimatedMinutes
      )
    })
  return unchanged ? null : items
}

/** Sum of the estimates (an item without one counts 0). */
export function totalMinutes(items: readonly SyllabusItem[]): number {
  return items.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)
}
