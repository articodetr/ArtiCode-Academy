import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { ANNOUNCEMENT_CLASS_ID, ANNOUNCEMENT_ID, makeAnnouncement, makeAnnouncementDetail } from '../test/notifications'
import { announcementsListPath, createAnnouncement, getAnnouncement, listAnnouncements } from './announcements'

describe('announcements API (API-173..API-175)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the given parameters only, in a fixed order', () => {
    expect(announcementsListPath()).toBe('/api/announcements')
    expect(announcementsListPath({ classId: 'c-1', limit: 20, cursor: 'x' })).toBe('/api/announcements?classId=c-1&limit=20&cursor=x')
  })

  it('reads and sends with the documented methods, paths and bodies', async () => {
    const fetchMock = mockFetch((url, init) =>
      init?.method === 'POST' ? jsonResponse(201, makeAnnouncement()) : url.includes(ANNOUNCEMENT_ID) ? jsonResponse(200, makeAnnouncementDetail()) : jsonResponse(200, { items: [], nextCursor: null }),
    )
    await listAnnouncements({ limit: 5 })
    await getAnnouncement(ANNOUNCEMENT_ID)
    const input = { audience: { kind: 'class' as const, classId: ANNOUNCEMENT_CLASS_ID, students: true, guardians: false, teachers: false }, title: 'ت', body: 'ن', sendEmail: false }
    await createAnnouncement(input)
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/announcements?limit=5', 'GET', undefined],
      [`/api/announcements/${ANNOUNCEMENT_ID}`, 'GET', undefined],
      ['/api/announcements', 'POST', JSON.stringify(input)],
    ])
  })
})
