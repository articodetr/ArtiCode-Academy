// State of the announcements list (J-F54): API-174 through the shared keyset
// hook, with the one filter of the contract — the class (`classId`).
import { listAnnouncements } from '../api/announcements'
import type { Announcement } from '../api/announcements'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export interface AnnouncementsFilters {
  classId?: string
}

const loadAnnouncements: KeysetLoader<Announcement, AnnouncementsFilters> = (filters, cursor, signal) =>
  listAnnouncements({ classId: filters.classId, cursor }, signal)

export function useAnnouncementsList(initialFilters: AnnouncementsFilters = {}) {
  return useKeysetList(loadAnnouncements, initialFilters)
}
