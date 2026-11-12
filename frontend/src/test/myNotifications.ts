// Fixtures for «my notifications» (MOD-12-T02 — J-F54): the shapes of
// API-167..API-170 as the backend returns them (my-notifications.dto.ts). The
// texts are what the engine's templates write — already in the reader's
// language, never translated by the client.
import type { MyNotification, MyNotificationList } from '../api/myNotifications'

export const NOTIFICATION_ID = '019a1000-0000-7000-8000-00000000a001'
/** The signed-in student of the tests (makeUser's default id is `user-1`). */
export const NOTIFIED_STUDENT = { id: 'user-1', fullName: 'سارة الطالبة', displayName: null }
/** A guardian's child. */
export const NOTIFIED_CHILD = { id: '019a1000-0000-7000-8000-00000000b002', fullName: 'عمر الأحمد', displayName: 'عمر' }

/** An unread `assignment.published` about the signed-in student, pointing at «my assignments». */
export function makeMyNotification(overrides: Partial<MyNotification> = {}): MyNotification {
  return {
    id: NOTIFICATION_ID,
    eventKey: 'assignment.published',
    category: 'assignments',
    title: 'واجب جديد: تمارين الوحدة الأولى',
    body: 'نُشر واجب «تمارين الوحدة الأولى» في الفصل PY-101-A، وموعده 2026-11-20 23:59.',
    data: { link: '/my-assignments', assignmentId: '019a1000-0000-7000-8000-00000000c001', classId: '019a1000-0000-7000-8000-00000000c002' },
    student: NOTIFIED_STUDENT,
    announcementId: null,
    readAt: null,
    createdAt: '2026-11-12T08:30:00.000Z',
    ...overrides,
  }
}

/** A manual announcement as its recipients get it: no student, the notifications page as its link. */
export function makeAnnouncementNotification(overrides: Partial<MyNotification> = {}): MyNotification {
  return makeMyNotification({
    id: '019a1000-0000-7000-8000-00000000a009',
    eventKey: 'announcement',
    category: 'announcements',
    title: 'تأجيل درس الغد',
    body: 'يُؤجَّل درس الغد إلى يوم الخميس في الموعد نفسه.\nأحضروا دفاتركم.',
    data: { link: '/notifications', announcementId: '019a1000-0000-7000-8000-00000000d001', classId: '019a1000-0000-7000-8000-00000000c002' },
    student: null,
    announcementId: '019a1000-0000-7000-8000-00000000d001',
    ...overrides,
  })
}

export function makeMyNotificationList(items: MyNotification[], nextCursor: string | null = null): MyNotificationList {
  return { items, nextCursor }
}
