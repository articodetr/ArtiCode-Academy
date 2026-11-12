// Fixtures for the announcements (MOD-12-T05 — J-F54): API-173..API-175 as the
// backend returns them (announcements.dto.ts) — the audience normalised.
import type { Announcement, AnnouncementDetail, AnnouncementList } from '../api/announcements'
import { CLASS_ID } from './classes'

export const ANNOUNCEMENT_ID = '019a2000-0000-7000-8000-00000000d001'

/** Who may send them: the seeded teacher's key, and the academy admin's two keys (any class, the academy by role). */
export const TEACHER_ANNOUNCER_PERMISSIONS = ['notifications.send', 'classes.read']
export const ADMIN_ANNOUNCER_PERMISSIONS = ['notifications.send', 'classes.read', 'classes.manage']

/** A class announcement of PY-101-A to its students and their guardians, sent by the signed-in teacher (`user-1`). */
export function makeAnnouncement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: ANNOUNCEMENT_ID,
    audience: { kind: 'class', classId: CLASS_ID, students: true, guardians: true, teachers: false },
    class: { id: CLASS_ID, code: 'PY-101-A', name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' } },
    title: 'تأجيل درس الغد',
    body: 'يُؤجَّل درس الغد إلى يوم الخميس في الموعد نفسه.\nأحضروا دفاتركم.',
    sendEmail: false,
    recipientCount: 12,
    sender: { id: 'user-1', fullName: 'خالد المعلم', displayName: null },
    createdAt: '2026-11-12T09:15:00.000Z',
    ...overrides,
  }
}

/** An academy announcement to every student and guardian (`classes.manage`). */
export function makeAcademyAnnouncement(overrides: Partial<Announcement> = {}): Announcement {
  return makeAnnouncement({
    id: '019a2000-0000-7000-8000-00000000d002',
    audience: { kind: 'academy', roleKeys: ['student', 'guardian'] },
    class: null,
    title: 'إجازة منتصف الفصل',
    body: 'تتوقف الدروس من 2026-11-25 إلى 2026-11-29.',
    sendEmail: true,
    recipientCount: 340,
    sender: { id: 'user-2', fullName: 'مدير الأكاديمية', displayName: null },
    createdAt: '2026-11-11T07:00:00.000Z',
    ...overrides,
  })
}

export function makeAnnouncementDetail(overrides: Partial<AnnouncementDetail> = {}): AnnouncementDetail {
  return {
    ...makeAnnouncement(),
    readCount: 5,
    email: { none: 12, queued: 0, sent: 0, failed: 0, skipped: 0 },
    ...overrides,
  }
}

export function makeAnnouncementList(items: Announcement[], nextCursor: string | null = null): AnnouncementList {
  return { items, nextCursor }
}
