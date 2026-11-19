// How the curriculum screens name a level and show a length (MOD-20, D-R130):
// «المستوى الأول», «المستوى الثاني — الأساسيات» … in Arabic (an ordinal word),
// «Level 1», «Level 2 — Basics» in English.
import type { LocalizedLabel } from '../api/users'
import type { Language } from '../i18n/language'
import { arabicOrdinal, levelOrdinalWord } from '../common/levelOrdinal'
import { localizedLabel } from '../users/users.format'

type Translate = (key: string, options?: Record<string, unknown>) => string

export { arabicOrdinal }

/** «المستوى الثالث» / «Level 3». */
export function levelNumberName(t: Translate, language: Language, number: number): string {
  return t('curriculum.level.name', { ordinal: levelOrdinalWord(number, language) })
}

/** «المستوى الثالث — الحلقات» when the level has a title, else «المستوى الثالث». */
export function levelName(t: Translate, language: Language, number: number, title: LocalizedLabel | null): string {
  const name = levelNumberName(t, language, number)
  return title ? t('curriculum.level.withTitle', { name, title: localizedLabel(title, language) }) : name
}

/** «يُفتح مع بدء الفصل» / «يُفتح بعد 14 يوماً من بدء الفصل» for a level's `releaseAfterDays` (D-R145); null when it opens at once. */
export function releaseLabel(t: Translate, days: number | null): string | null {
  if (days === null) return null
  return days === 0 ? t('curriculum.level.releaseOnStart') : t('curriculum.level.releaseTag', { count: days })
}

/** The learner's view of a course for its author (D-R144 — agent F1's page): the saved curriculum, no progress written. */
export const previewPath = (courseId: string) => `/learn/${encodeURIComponent(courseId)}/preview`

/** A media length as `m:ss` or `h:mm:ss` (Latin digits, shown in an LTR isolate). */
export function formatMediaDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = String(whole % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
