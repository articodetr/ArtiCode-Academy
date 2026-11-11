// KI-052 (J-F15): while an editor of the class drawer holds unsaved work, Escape
// and a mask click no longer close the drawer, and the close button asks before
// discarding it; since J-F21 an editor without a change (or changed back) holds
// nothing (PR #66 review, note 1). The weekly schedule editor's case sits in
// ClassDrawer.schedule.test.tsx with the schedule fixtures.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AcademyClass } from '../api/classes'
import { ar } from '../i18n/ar'
import { CLASS_ID, makeClass } from '../test/classes'
import { clickWhenSettled } from '../test/drawer'
import { ENROLLMENT_IDS, makeEnrollment, makeEnrollmentList, makeEnrollmentStudent, makeStudentCandidate } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeUserList } from '../test/users'
import { ClassDrawer } from './ClassDrawer'

/** Every key the drawer's editors need: the edit form, the teachers editor with its search, the enroll form. */
const EDITOR_PERMISSIONS = ['classes.read', 'classes.manage', 'classes.teachers.assign', 'courses.read', 'users.read', 'enrollments.read', 'enrollments.manage']

const layla = makeStudentCandidate()

interface Write {
  method: string
  url: string
  body: unknown
}

/** The class, its roster (one student), the user search (Layla) and the enrollment POST; any other write is a 500. */
function mockDrawerApi(cls: AcademyClass = makeClass({ status: 'open', enrolledCount: 1 })) {
  const writes: Write[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname } = new URL(url, 'http://localhost')
    if (method !== 'GET') {
      writes.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (method === 'POST' && pathname === `/api/classes/${CLASS_ID}/enrollments`) {
        return jsonResponse(201, makeEnrollment({ id: ENROLLMENT_IDS[1], student: makeEnrollmentStudent({ id: layla.id, fullName: layla.fullName, email: layla.email }) }))
      }
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    }
    if (pathname === `/api/classes/${CLASS_ID}`) return jsonResponse(200, cls)
    if (pathname === `/api/classes/${CLASS_ID}/enrollments`) return jsonResponse(200, makeEnrollmentList([makeEnrollment()]))
    if (pathname === '/api/users') return jsonResponse(200, makeUserList([layla]))
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return { writes }
}

function renderDrawer() {
  const onClose = vi.fn()
  renderWithProviders(<ClassDrawer classId={CLASS_ID} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: EDITOR_PERMISSIONS }) }),
    route: '/classes',
  })
  return { onClose }
}

/** Escape as the browser sends it: the drawer listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const mask = () => document.querySelector<HTMLElement>('.ant-drawer-mask')!
/** Escape and the mask do nothing at all while an editor is open: no close and no «discard?» question either. */
const expectNoDiscardQuestion = () => expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()

/** Clicks the drawer's close button and returns the «discard?» confirmation it opens (the latest one). */
async function openDiscardDialog(): Promise<HTMLElement> {
  await clickWhenSettled(closeButton)
  const titles = await screen.findAllByText(ar.common.unsaved.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}

describe('ClassDrawer — unsaved editors (KI-052)', () => {
  it('closes at once on Escape, on a mask click and with the close button while no editor is open (as before)', async () => {
    mockDrawerApi()
    const { onClose } = renderDrawer()
    await screen.findByText('PY-101-A')

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    await clickWhenSettled(mask)
    expect(onClose).toHaveBeenCalledTimes(2)
    await clickWhenSettled(closeButton)
    expect(onClose).toHaveBeenCalledTimes(3)
    expectNoDiscardQuestion()
  })

  it('keeps the edit form and its draft on Escape and on a mask click; the close button asks — cancel stays, confirm closes', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = renderDrawer()
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    const capacity = await screen.findByLabelText(ar.classes.fields.capacity)
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '25')

    pressEscape()
    pressEscape()
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    expect(screen.getByLabelText(ar.classes.fields.capacity)).toHaveValue('25')

    const first = await openDiscardDialog()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    fireEvent.click(within(first).getByText(ar.common.unsaved.cancel).closest('button')!)
    await waitFor(() => expect(screen.getByLabelText(ar.classes.fields.capacity)).toHaveValue('25'))
    expect(onClose).not.toHaveBeenCalled()

    const second = await openDiscardDialog()
    fireEvent.click(within(second).getByText(ar.common.unsaved.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(writes).toEqual([])
  })

  it('holds nothing while the edit form is open without a change: Escape closes at once (J-F21 — PR #66 review, note 1)', async () => {
    mockDrawerApi()
    const { onClose } = renderDrawer()
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    await screen.findByLabelText(ar.classes.fields.capacity)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
  })

  it('lets go of a change changed back: Escape keeps the form while it differs and closes once it matches the class again (J-F21)', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = renderDrawer()
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    const capacity = await screen.findByLabelText(ar.classes.fields.capacity)
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '25')
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()

    // The class holds 20 seats: typed back, nothing is left to lose.
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '20')
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    expect(writes).toEqual([])
  })

  it('holds nothing while the teachers editor matches the server list: the close button closes without asking (J-F21)', async () => {
    mockDrawerApi()
    const { onClose } = renderDrawer()
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByRole('tab', { name: 'المعلمون (1)' }))
    fireEvent.click((await screen.findByText(ar.classes.teachers.edit)).closest('button')!)
    await screen.findByLabelText(`${ar.classes.teachers.remove}: خالد المعلم`)
    await clickWhenSettled(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
  })

  it('keeps the teachers draft on Escape; once the editor is left, Escape closes the drawer as before', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = renderDrawer()
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByRole('tab', { name: 'المعلمون (1)' }))
    fireEvent.click((await screen.findByText(ar.classes.teachers.edit)).closest('button')!)
    // A change without opening any popup: the only teacher leaves the draft.
    fireEvent.click(await screen.findByLabelText(`${ar.classes.teachers.remove}: خالد المعلم`))
    expect(screen.getByText(ar.classes.teachers.emptyDraft)).toBeInTheDocument()

    pressEscape()
    pressEscape()
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    expect(screen.getByText(ar.classes.teachers.emptyDraft)).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.common.cancel).closest('button')!)
    expect(await screen.findByText(ar.classes.teachers.edit)).toBeInTheDocument()
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([])
  })

  it('counts a student picked in the enroll form as unsaved: the mask keeps the drawer and the close button asks; once enrolled it closes at once', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = renderDrawer()
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByRole('tab', { name: 'الطلاب (1)' }))
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: ar.classes.enrollments.add }))
    fireEvent.click(await screen.findByText('ليلى سعيد', { selector: '.ant-select-item-option-content' }))
    const enroll = screen.getByText(ar.classes.enrollments.enroll).closest('button')!
    await waitFor(() => expect(enroll).toBeEnabled())

    // No Escape here: jsdom never ends the closing animation of the search popup, which so stays on
    // top of the Escape stack and takes the key itself (in a browser it leaves within ~0.2 s). The
    // Escape path is proven by the other editors; the mask and the close button prove the report.
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    const dialog = await openDiscardDialog()
    fireEvent.click(within(dialog).getByText(ar.common.unsaved.cancel).closest('button')!)
    expect(onClose).not.toHaveBeenCalled()
    expect(enroll).toBeEnabled()

    fireEvent.click(enroll)
    expect(await screen.findByText('تم تسجيل «ليلى سعيد» في الفصل')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(ar.classes.enrollments.enroll).closest('button')).toBeDisabled())
    await clickWhenSettled(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([{ method: 'POST', url: `/api/classes/${CLASS_ID}/enrollments`, body: { studentId: layla.id } }])
  })
})
