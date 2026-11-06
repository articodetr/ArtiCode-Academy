// Pure presentation helpers of the weekly schedule (J-F07): the label of a
// room and the text of a time range. No React, no i18next instance.
import type { LocalizedLabel } from '../api/users'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

/** What a room needs for its label: the API-084 room and the API-088 slot room both fit. */
export interface RoomLike {
  code: string
  name: LocalizedLabel | null
  branch: { code: string; name: LocalizedLabel } | null
}

/** `LAB-1 — مختبر 1 · الفرع الرئيسي`: the code, then the name when set, then the branch when the room has one. */
export function roomLabel(room: RoomLike, language: Language): string {
  const text = room.name ? `${room.code} — ${localizedLabel(room.name, language)}` : room.code
  return room.branch ? `${text} · ${localizedLabel(room.branch.name, language)}` : text
}

/** `10:00–11:30` (render it with `dir="ltr"`). */
export function timeRange(startTime: string, endTime: string): string {
  return `${startTime}–${endTime}`
}
