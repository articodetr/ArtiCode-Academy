import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MyNotification, MyNotificationList } from '../api/myNotifications'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { NOTIFICATION_ID, NOTIFIED_CHILD, makeAnnouncementNotification, makeMyNotification, makeMyNotificationList } from '../test/myNotifications'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { NotificationsPage } from './NotificationsPage'

const READ_AT = '2026-11-12T10:00:00.000Z'
const assignment = makeMyNotification()
const announcement = makeAnnouncementNotification()
const invoice = makeMyNotification({
  id: '019a1000-0000-7000-8000-00000000a003',
  eventKey: 'invoice.issued',
  category: 'finance',
  title: 'فاتورة جديدة INV-2026-00057',
  body: 'الإجمالي 1200.00 SAR، وأول قسط مستحق في 2026-12-01.',
  data: { link: '/my-invoices', invoiceId: '019a1000-0000-7000-8000-00000000c009' },
  readAt: READ_AT,
})

type ListAnswer = MyNotificationList | Response

interface ApiOptions {
  read?: (id: string) => MyNotification | Response
  readAll?: Response
}

/** Serves API-167 (recording its queries) and API-169/170 (recording the posts). */
function mockInboxApi(list: ListAnswer | ((query: URLSearchParams) => ListAnswer), { read, readAll }: ApiOptions = {}) {
  const queries: URLSearchParams[] = []
  const posts: { path: string; body: unknown }[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (method === 'GET' && parsed.pathname === '/api/me/notifications') {
      queries.push(parsed.searchParams)
      const answer = typeof list === 'function' ? list(parsed.searchParams) : list
      return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
    }
    if (method === 'POST') {
      posts.push({ path: parsed.pathname, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
      if (parsed.pathname === '/api/me/notifications/read-all') return readAll ? readAll.clone() : jsonResponse(200, { updated: 2 })
      const id = parsed.pathname.split('/')[4] ?? ''
      const answer = read ? read(id) : { ...assignment, id, readAt: READ_AT }
      return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
    }
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${method} ${url}` })
  })
  return { queries, posts }
}

function renderPage(user = makeUser({ role: 'student', roles: ['student'], permissions: [] })) {
  return renderWithProviders(<NotificationsPage />, {
    auth: makeAuth({ user }),
    route: '/notifications',
    routes: { '/my-assignments': <LocationProbe />, '/my-invoices': <LocationProbe /> },
  })
}

function rowOf(title: string): HTMLElement {
  const row = screen.getByText(title).closest<HTMLElement>('li')
  if (!row) throw new Error(`No notification titled ${title}`)
  return row
}

function button(scope: HTMLElement, text: string): HTMLElement {
  const found = within(scope).getByText(text).closest<HTMLElement>('button')
  if (!found) throw new Error(`No button ${text}`)
  return found
}

async function pickOption(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  const item = await screen.findByText(option, { selector: '.ant-select-item-option-content' })
  fireEvent.click(item)
}

describe('NotificationsPage (J-F54, API-167..170)', () => {
  it('shows the newest page as the server worded it: unread state, category, the child of a guardian, the plain-text body', async () => {
    const childCopy = makeMyNotification({ id: '019a1000-0000-7000-8000-00000000a004', title: 'درجة جديدة لعمر', student: NOTIFIED_CHILD })
    const markup = makeAnnouncementNotification({ id: '019a1000-0000-7000-8000-00000000a005', title: 'إعلان بعلامات', body: '<b>غير غامق</b> <script>alert(1)</script>' })
    const api = mockInboxApi(makeMyNotificationList([assignment, childCopy, markup, invoice]))
    renderPage(makeUser({ id: 'guardian-1', role: 'guardian', roles: ['guardian'], permissions: [] }))

    await screen.findByText(assignment.title)
    const first = rowOf(assignment.title)
    expect(within(first).getByText(ar.notifications.unread)).toBeInTheDocument()
    expect(within(first).getByText(ar.notifications.categories.assignments)).toBeInTheDocument()
    expect(within(first).getByText(assignment.body)).toBeInTheDocument()
    // A guardian's copy names the child it is about; an announcement (no student) names nobody.
    expect(within(rowOf(childCopy.title)).getByText(i18n.t('notifications.about', { name: 'عمر' }))).toBeInTheDocument()
    expect(within(rowOf(markup.title)).queryByText(/^عن /)).toBeNull()
    // A read one has no unread tag and no «mark as read» button.
    const read = rowOf(invoice.title)
    expect(within(read).queryByText(ar.notifications.unread)).toBeNull()
    expect(within(read).queryByText(ar.notifications.markRead)).toBeNull()
    expect(within(read).getByText(ar.notifications.categories.finance)).toBeInTheDocument()
    // The body is text: no element is made of it.
    const body = within(rowOf(markup.title)).getByText(markup.body)
    expect(body.querySelector('b, script')).toBeNull()
    expect(api.queries.map((query) => query.toString())).toEqual([''])
  })

  it('filters by unread and by category, says why the list is empty, and names the category in «mark all»', async () => {
    const api = mockInboxApi((query) => (query.has('category') ? makeMyNotificationList([]) : makeMyNotificationList([assignment])))
    renderPage()
    await screen.findByText(assignment.title)

    fireEvent.click(screen.getByText(ar.notifications.views.unread))
    await waitFor(() => expect(api.queries.at(-1)?.toString()).toBe('unread=true'))

    await pickOption(ar.notifications.filters.category, ar.notifications.categories.finance)
    await waitFor(() => expect(api.queries.at(-1)?.toString()).toBe('unread=true&category=finance'))
    expect(await screen.findByText(ar.notifications.empty.filtered)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('notifications.markCategoryRead', { category: ar.notifications.categories.finance }))).toBeInTheDocument()
  })

  it('says there is nothing yet, and nothing unread, without filters', async () => {
    mockInboxApi(makeMyNotificationList([]))
    renderPage()
    expect(await screen.findByText(ar.notifications.empty.all)).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.notifications.views.unread))
    expect(await screen.findByText(ar.notifications.empty.unread)).toBeInTheDocument()
  })

  it('opens a notification: marks it read (API-169) and goes to its link', async () => {
    const api = mockInboxApi(makeMyNotificationList([assignment]))
    renderPage()

    fireEvent.click(await screen.findByText(assignment.title))

    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/my-assignments')
    await waitFor(() => expect(api.posts).toEqual([{ path: `/api/me/notifications/${NOTIFICATION_ID}/read`, body: undefined }]))
  })

  it('opens an announcement in place: its link is this page, so it is only marked read — the row follows the answer', async () => {
    const api = mockInboxApi(makeMyNotificationList([announcement]), { read: () => ({ ...announcement, readAt: READ_AT }) })
    renderPage()

    fireEvent.click(await screen.findByText(announcement.title))

    await waitFor(() => expect(within(rowOf(announcement.title)).queryByText(ar.notifications.unread)).toBeNull())
    expect(api.posts).toEqual([{ path: `/api/me/notifications/${announcement.id}/read`, body: undefined }])
    expect(screen.queryByTestId('location')).toBeNull()
  })

  it('marks one read with its button, and reads the list again when the notification is gone (404)', async () => {
    let gone = false
    const api = mockInboxApi(makeMyNotificationList([assignment]), {
      read: (id) => (gone ? jsonResponse(404, { statusCode: 404, code: 'notification_not_found', notificationId: id }) : { ...assignment, readAt: READ_AT }),
    })
    renderPage()

    await screen.findByText(assignment.title)
    fireEvent.click(button(rowOf(assignment.title), ar.notifications.markRead))
    await waitFor(() => expect(within(rowOf(assignment.title)).queryByText(ar.notifications.unread)).toBeNull())
    expect(api.posts).toHaveLength(1)
    expect(screen.queryByTestId('location')).toBeNull()

    // A second copy of the list where it is unread again, then the server says it is gone.
    gone = true
    fireEvent.click(screen.getByLabelText(ar.notifications.refresh))
    await waitFor(() => expect(api.queries).toHaveLength(2))
    fireEvent.click(button(rowOf(assignment.title), ar.notifications.markRead))
    expect(await screen.findByText(ar.notifications.errors.notification_not_found)).toBeInTheDocument()
    await waitFor(() => expect(api.queries).toHaveLength(3))
  })

  it('marks everything read with API-170 — every category, or the one chosen — then reads the list again', async () => {
    const api = mockInboxApi(makeMyNotificationList([assignment, invoice]))
    renderPage()
    await screen.findByText(assignment.title)

    fireEvent.click(screen.getByText(ar.notifications.markAllRead).closest('button')!)
    expect(await screen.findByText(i18n.t('notifications.markedAll', { count: 2 }))).toBeInTheDocument()
    await waitFor(() => expect(api.queries).toHaveLength(2))
    expect(api.posts).toEqual([{ path: '/api/me/notifications/read-all', body: undefined }])

    await pickOption(ar.notifications.filters.category, ar.notifications.categories.assignments)
    await waitFor(() => expect(api.queries.at(-1)?.get('category')).toBe('assignments'))
    fireEvent.click(screen.getByText(i18n.t('notifications.markCategoryRead', { category: ar.notifications.categories.assignments })).closest('button')!)
    await waitFor(() => expect(api.posts).toHaveLength(2))
    expect(api.posts[1]).toEqual({ path: '/api/me/notifications/read-all', body: { category: 'assignments' } })
  })

  it('says so when nothing was unread', async () => {
    mockInboxApi(makeMyNotificationList([invoice]), { readAll: jsonResponse(200, { updated: 0 }) })
    renderPage()
    await screen.findByText(invoice.title)

    fireEvent.click(screen.getByText(ar.notifications.markAllRead).closest('button')!)
    expect(await screen.findByText(ar.notifications.nothingUnread)).toBeInTheDocument()
  })

  it('pages with the cursor of the server, back and forth', async () => {
    const older = makeMyNotification({ id: '019a1000-0000-7000-8000-00000000a000', title: 'إشعار أقدم' })
    const api = mockInboxApi((query) => (query.get('cursor') === NOTIFICATION_ID ? makeMyNotificationList([older]) : makeMyNotificationList([assignment], NOTIFICATION_ID)))
    renderPage()
    await screen.findByText(assignment.title)

    fireEvent.click(screen.getByText(ar.notifications.pagination.next).closest('button')!)
    expect(await screen.findByText(older.title)).toBeInTheDocument()
    expect(api.queries.at(-1)?.get('cursor')).toBe(NOTIFICATION_ID)
    expect(screen.getByText(i18n.t('notifications.pagination.page', { page: 2 }))).toBeInTheDocument()
    expect(screen.getByText(ar.notifications.pagination.next).closest('button')).toBeDisabled()

    fireEvent.click(screen.getByText(ar.notifications.pagination.previous).closest('button')!)
    expect(await screen.findByText(assignment.title)).toBeInTheDocument()
  })

  it('reports a failed read and reads again on demand', async () => {
    let fail = true
    mockInboxApi(() => (fail ? jsonResponse(503, { statusCode: 503, message: 'Service Unavailable' }) : makeMyNotificationList([assignment])))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ar.login.errors.server)
    fail = false
    fireEvent.click(button(alert, ar.notifications.refresh))
    expect(await screen.findByText(assignment.title)).toBeInTheDocument()
  })
})
