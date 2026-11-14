// Fixtures of the notifications screen (MOD-12-T07): API-167..175 bodies.
import type { Announcement, AnnouncementDetail } from '../api/announcements'
import type { MyNotification, MyNotificationList, NotificationPreferences } from '../api/notifications'
import { NOTIFICATION_CATEGORIES } from '../api/notifications'

export const NOTIFICATION_ID = '019a0000-0000-7000-8000-00000000a001'
export const ANNOUNCEMENT_ID = '019a0000-0000-7000-8000-00000000b001'
export const ANNOUNCEMENT_CLASS_ID = '019a0000-0000-7000-8000-00000000c001'

export function makeNotification(overrides: Partial<MyNotification> = {}): MyNotification {
  return {
    id: NOTIFICATION_ID,
    eventKey: 'assignment.published',
    category: 'assignments',
    title: 'واجب جديد: المقالة الأولى',
    body: 'نُشر واجب جديد في فصل الإنجليزية.',
    data: { link: '/my-assignments', assignmentId: 'a-1', classId: ANNOUNCEMENT_CLASS_ID },
    student: null,
    announcementId: null,
    readAt: null,
    createdAt: '2026-11-13T09:30:00.000Z',
    ...overrides,
  }
}

export function makeNotificationList(items: MyNotification[] = [makeNotification()], nextCursor: string | null = null): MyNotificationList {
  return { items, nextCursor }
}

export function makePreferences(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    categories: NOTIFICATION_CATEGORIES.map((category) => ({ category, emailEnabled: true })),
    emailVerified: true,
    emailAvailable: true,
    ...overrides,
  }
}

export function makeAnnouncement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: ANNOUNCEMENT_ID,
    audience: { kind: 'class', classId: ANNOUNCEMENT_CLASS_ID, students: true, guardians: true, teachers: false },
    class: { id: ANNOUNCEMENT_CLASS_ID, code: 'ENG-A1', name: { ar: 'الإنجليزية أ1' } },
    title: 'تأجيل درس الغد',
    body: 'يُؤجَّل درس الغد إلى يوم الخميس.',
    sendEmail: true,
    recipientCount: 12,
    sender: { id: 'user-1', fullName: 'مدير الاختبار', displayName: null },
    createdAt: '2026-11-12T08:00:00.000Z',
    ...overrides,
  }
}

export function makeAnnouncementDetail(overrides: Partial<AnnouncementDetail> = {}): AnnouncementDetail {
  return { ...makeAnnouncement(), readCount: 5, email: { none: 2, queued: 0, sent: 9, failed: 1, skipped: 0 }, ...overrides }
}
