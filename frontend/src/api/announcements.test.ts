import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { ANNOUNCEMENT_ID, makeAnnouncement, makeAnnouncementDetail, makeAnnouncementList } from '../test/announcements'
import { CLASS_ID } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { ANNOUNCEMENT_ROLE_KEYS, announcementsPath, createAnnouncement, getAnnouncement, listAnnouncements } from './announcements'

describe('announcements API (API-173..API-175)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('names the four role keys of an academy audience in the order of a normalised audience', () => {
    expect(ANNOUNCEMENT_ROLE_KEYS).toEqual(['student', 'guardian', 'teacher', 'staff'])
  })

  it('builds the list path with the given parameters only, in a fixed order', () => {
    expect(announcementsPath()).toBe('/api/announcements')
    expect(announcementsPath({ classId: '', cursor: '' })).toBe('/api/announcements')
    expect(announcementsPath({ cursor: 'c-1', limit: 20, classId: CLASS_ID })).toBe(`/api/announcements?classId=${CLASS_ID}&limit=20&cursor=c-1`)
  })

  it('lists and reads one with the Bearer token and the abort signal', async () => {
    const list = makeAnnouncementList([makeAnnouncement()], 'next-1')
    const detail = makeAnnouncementDetail()
    const fetchMock = mockFetch((url) => (url === `/api/announcements/${ANNOUNCEMENT_ID}` ? jsonResponse(200, detail) : jsonResponse(200, list)))
    const controller = new AbortController()

    await expect(listAnnouncements({ classId: CLASS_ID }, controller.signal)).resolves.toEqual(list)
    await expect(getAnnouncement(ANNOUNCEMENT_ID, controller.signal)).resolves.toEqual(detail)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/announcements?classId=${CLASS_ID}`)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
  })

  it('sends a class announcement as one POST with the body as given', async () => {
    const answer = makeAnnouncement()
    const fetchMock = mockFetch(() => jsonResponse(201, answer))
    const input = {
      audience: { kind: 'class' as const, classId: CLASS_ID, students: true, guardians: true, teachers: false },
      title: 'تأجيل درس الغد',
      body: 'يُؤجَّل درس الغد.',
      sendEmail: false,
    }

    await expect(createAnnouncement(input)).resolves.toEqual(answer)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/announcements')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(input)
  })

  it('rejects with the code and details of a refusal', async () => {
    mockFetch(() => jsonResponse(422, { statusCode: 422, code: 'audience_too_large', recipients: 6200, max: 5000 }))
    await expect(createAnnouncement({ audience: { kind: 'academy', roleKeys: ['student'] }, title: 'x', body: 'y' })).rejects.toMatchObject({
      status: 422,
      code: 'audience_too_large',
      body: { recipients: 6200, max: 5000 },
    })
  })
})
