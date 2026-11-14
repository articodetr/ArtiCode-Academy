// The caller's announcements (API-174) on the shared keyset hook — newest first.
import { listAnnouncements } from '../api/announcements'
import type { Announcement } from '../api/announcements'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export const ANNOUNCEMENTS_PAGE_SIZE = 20

type Filters = Record<string, never>

const load: KeysetLoader<Announcement, Filters> = (_filters, cursor, signal) => listAnnouncements({ limit: ANNOUNCEMENTS_PAGE_SIZE, cursor }, signal)

const NO_FILTERS: Filters = {}

export function useAnnouncementsList() {
  return useKeysetList<Announcement, Filters>(load, NO_FILTERS)
}
