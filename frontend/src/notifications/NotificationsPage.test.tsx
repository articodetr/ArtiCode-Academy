import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makeClass, makeClassList } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { ANNOUNCEMENT_CLASS_ID, makeAnnouncement, makeAnnouncementDetail, makeNotification, makeNotificationList, makePreferences } from '../test/notifications'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { NotificationsPage } from './NotificationsPage'

const n = ar.notifications

interface Calls {
  method: string
  path: string
  search: URLSearchParams
  body: unknown
}

/** Serves the MOD-12 routes (recording every call) plus the academy and the class picker. */
function mockApi(handlers: { [route: string]: (call: Calls) => Response } = {}) {
  const calls: Calls[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const call: Calls = { method: init?.method ?? 'GET', path: parsed.pathname, search: parsed.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const custom = handlers[`${call.method} ${call.path}`]
    if (custom) return custom(call)
    if (call.path === '/api/academy') return jsonResponse(200, { id: 'a', timezone: 'Asia/Riyadh', name: { ar: 'أكاديمية' } })
    if (call.path === '/api/me/notifications') return jsonResponse(200, makeNotificationList())
    if (call.path === '/api/me/notification-preferences') return jsonResponse(200, makePreferences())
    if (call.path === '/api/announcements' && call.method === 'GET') return jsonResponse(200, { items: [makeAnnouncement()], nextCursor: null })
    if (call.path.startsWith('/api/announcements/')) return jsonResponse(200, makeAnnouncementDetail())
    if (call.path === '/api/announcements') return jsonResponse(201, makeAnnouncement())
    if (call.path === '/api/classes') return jsonResponse(200, makeClassList([makeClass({ id: ANNOUNCEMENT_CLASS_ID, code: 'ENG-A1' })]))
    return jsonResponse(404, { statusCode: 404, code: 'not_found', message: 'nope' })
  })
  return calls
}

function renderPage(permissions: string[] = []) {
  return renderWithProviders(<NotificationsPage />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/notifications',
    routes: { '/my-assignments': <LocationProbe /> },
  })
}

describe('NotificationsPage — inbox', () => {
  it('lists the server’s notifications and marks one read when it is opened, staying on the page for its own link', async () => {
    const announcement = makeNotification({ id: 'n-2', category: 'announcements', eventKey: 'announcement', title: 'إعلان الفصل', data: { link: '/notifications' } })
    const calls = mockApi({
      'GET /api/me/notifications': () => jsonResponse(200, makeNotificationList([announcement])),
      'POST /api/me/notifications/n-2/read': () => jsonResponse(200, { ...announcement, readAt: '2026-11-14T10:00:00.000Z' }),
    })
    renderPage()
    const title = await screen.findByText('إعلان الفصل')
    const row = title.closest('button')!
    expect(row).toHaveClass('notif-item--unread')
    expect(within(row).getByText(n.inbox.unreadMark)).toBeInTheDocument()
    expect(within(row).getByText(n.categories.announcements)).toBeInTheDocument()
    fireEvent.click(row)
    await waitFor(() => expect(row).not.toHaveClass('notif-item--unread'))
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual(['/api/me/notifications/n-2/read'])
  })

  it('follows the notification’s link inside the app', async () => {
    const calls = mockApi({ 'POST /api/me/notifications/019a0000-0000-7000-8000-00000000a001/read': () => jsonResponse(200, makeNotification({ readAt: '2026-11-14T10:00:00.000Z' })) })
    renderPage()
    fireEvent.click((await screen.findByText(makeNotification().title)).closest('button')!)
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/my-assignments')
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/read'))).toBe(true))
  })

  it('marks everything read in one request and reads the list again; the unread filter goes to the server', async () => {
    const calls = mockApi({ 'POST /api/me/notifications/read-all': () => jsonResponse(200, { updated: 1 }) })
    renderPage()
    await screen.findByText(makeNotification().title)
    fireEvent.click(screen.getByText(n.inbox.markAllRead).closest('button')!)
    await waitFor(() => expect(calls.filter((call) => call.path === '/api/me/notifications').length).toBe(2))
    expect(calls.find((call) => call.path === '/api/me/notifications/read-all')?.body).toEqual({})

    fireEvent.click(screen.getByText(n.inbox.unread))
    await waitFor(() => expect(calls.some((call) => call.path === '/api/me/notifications' && call.search.get('unread') === 'true')).toBe(true))
  })

  it('words an empty inbox', async () => {
    mockApi({ 'GET /api/me/notifications': () => jsonResponse(200, makeNotificationList([])) })
    renderPage()
    expect(await screen.findByText(n.inbox.empty)).toBeInTheDocument()
  })
})

describe('NotificationsPage — e-mail preferences', () => {
  it('saves the six switches in ONE PUT only after a change, and explains an unconfirmed address', async () => {
    const calls = mockApi({
      'GET /api/me/notification-preferences': () => jsonResponse(200, makePreferences({ emailVerified: false })),
      'PUT /api/me/notification-preferences': (call) =>
        jsonResponse(200, makePreferences({ emailVerified: false, categories: (call.body as { categories: never[] }).categories })),
    })
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: n.tabs.preferences }))
    expect(await screen.findByText(n.preferences.emailUnverified)).toBeInTheDocument()
    const save = screen.getByText(n.preferences.save).closest('button')!
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByLabelText(`بريد ${n.categories.finance}`))
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(save).toBeDisabled())
    const puts = calls.filter((call) => call.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0]!.body).toEqual({
      categories: [
        { category: 'lessons', emailEnabled: true },
        { category: 'assignments', emailEnabled: true },
        { category: 'exams', emailEnabled: true },
        { category: 'grades', emailEnabled: true },
        { category: 'finance', emailEnabled: false },
        { category: 'announcements', emailEnabled: true },
      ],
    })
  })
})

describe('NotificationsPage — announcements', () => {
  it('hides the announcements tab without notifications.send', async () => {
    mockApi()
    renderPage()
    await screen.findByText(makeNotification().title)
    expect(screen.queryByRole('tab', { name: n.tabs.announcements })).not.toBeInTheDocument()
  })

  it('lists the sent announcements and opens one with its read and e-mail counts', async () => {
    mockApi()
    renderPage(['notifications.send', 'classes.read'])
    fireEvent.click(screen.getByRole('tab', { name: n.tabs.announcements }))
    fireEvent.click(await screen.findByText('تأجيل درس الغد'))
    expect(await screen.findByText('قرأه 5 من 12')).toBeInTheDocument()
    expect(screen.getByText(`${n.announcements.emailStates.sent}: 9`)).toBeInTheDocument()
  })

  async function composeClassAnnouncement() {
    fireEvent.click(screen.getByRole('tab', { name: n.tabs.announcements }))
    fireEvent.click((await screen.findByText(n.announcements.new)).closest('button')!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: n.announcements.fields.class }))
    fireEvent.click(await screen.findByText((_, element) => element?.classList.contains('ant-select-item-option-content') === true && element.textContent?.startsWith('ENG-A1') === true))
    fireEvent.click(within(dialog).getByLabelText(n.announcements.groups.teachers))
    await userEvent.type(within(dialog).getByLabelText(n.announcements.fields.title), '  تأجيل  ')
    await userEvent.type(within(dialog).getByLabelText(n.announcements.fields.body), 'يُؤجَّل الدرس.')
    fireEvent.click(within(dialog).getByText(n.announcements.create.send).closest('button')!)
    return dialog
  }

  it('sends a class announcement with the audience spelled out and the texts trimmed', async () => {
    const calls = mockApi()
    renderPage(['notifications.send', 'classes.read'])
    await composeClassAnnouncement()
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path === '/api/announcements')).toBe(true))
    expect(calls.find((call) => call.method === 'POST' && call.path === '/api/announcements')?.body).toEqual({
      audience: { kind: 'class', classId: ANNOUNCEMENT_CLASS_ID, students: true, guardians: true, teachers: true },
      title: 'تأجيل',
      body: 'يُؤجَّل الدرس.',
      sendEmail: false,
    })
  })

  it('words audience_too_large with the count and the maximum', async () => {
    mockApi({
      'POST /api/announcements': () =>
        jsonResponse(422, { statusCode: 422, error: 'Unprocessable Entity', code: 'audience_too_large', message: 'too many', recipients: 6200, max: 5000 }),
    })
    renderPage(['notifications.send', 'classes.read'])
    const dialog = await composeClassAnnouncement()
    expect(await within(dialog).findByText('يصل الإعلان إلى 6200 مستلم، والحد الأقصى 5000. ضيّق الجمهور.')).toBeInTheDocument()
  })
})
