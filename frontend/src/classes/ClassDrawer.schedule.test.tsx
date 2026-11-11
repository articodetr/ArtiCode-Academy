// The weekly schedule tab of the class drawer (J-F07). In its own file so the
// drawer's main test file stays untouched by J-F07 (J-F04 edits it too). Since
// J-F15 it also holds the KI-052 regression test of the schedule editor.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { CLASS_ID, CLASS_READER_PERMISSIONS, makeClass } from '../test/classes'
import { clickWhenSettled } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { SCHEDULE_ADMIN_PERMISSIONS, makeRoom, makeSchedule } from '../test/schedule'
import { ClassDrawer } from './ClassDrawer'

/**
 * Opens the schedule editor. Its «تعديل» button is disabled until the class schedule has
 * arrived, and a click on a disabled button is lost; under load the button can be on screen
 * before the schedule (KI-060).
 */
async function openScheduleEditor() {
  const edit = () => screen.getByText(ar.classSchedule.edit).closest('button')!
  await waitFor(() => expect(edit()).toBeEnabled())
  fireEvent.click(edit())
}

describe('ClassDrawer — weekly schedule tab', () => {
  it('opens the weekly schedule tab and reads the class schedule; a reader gets no edit button', async () => {
    mockFetch((url, init) => {
      const parsed = new URL(url, 'http://localhost')
      if ((init?.method ?? 'GET') !== 'GET') return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
      if (parsed.pathname === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass())
      if (parsed.pathname === `/api/classes/${CLASS_ID}/schedule`) return jsonResponse(200, makeSchedule())
      if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    })
    renderWithProviders(<ClassDrawer classId={CLASS_ID} onClose={vi.fn()} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
      auth: makeAuth({ user: makeUser({ permissions: CLASS_READER_PERMISSIONS }) }),
      route: '/classes',
    })
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByRole('tab', { name: ar.classSchedule.tab }))
    expect(await screen.findByText('10:00–11:00')).toBeInTheDocument()
    expect(screen.getByText('LAB-1 — مختبر 1')).toBeInTheDocument()
    expect(screen.queryByText(ar.classSchedule.edit)).not.toBeInTheDocument()
  })

  it('keeps the schedule editor and its new slot on Escape (twice) and on a mask click; after Cancel, Escape closes the drawer as before (KI-052)', async () => {
    const writes: string[] = []
    mockFetch((url, init) => {
      const parsed = new URL(url, 'http://localhost')
      if ((init?.method ?? 'GET') !== 'GET') {
        writes.push(`${init?.method} ${parsed.pathname}`)
        return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
      }
      if (parsed.pathname === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass())
      if (parsed.pathname === `/api/classes/${CLASS_ID}/schedule`) return jsonResponse(200, makeSchedule())
      if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
      if (parsed.pathname === '/api/rooms') return jsonResponse(200, { items: [makeRoom()] })
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    })
    const onClose = vi.fn()
    renderWithProviders(<ClassDrawer classId={CLASS_ID} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
      auth: makeAuth({ user: makeUser({ permissions: SCHEDULE_ADMIN_PERMISSIONS }) }),
      route: '/classes',
    })
    await screen.findByText('PY-101-A')
    const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })

    fireEvent.click(screen.getByRole('tab', { name: ar.classSchedule.tab }))
    await openScheduleEditor()
    // A change without opening any popup: a new slot card.
    fireEvent.click((await screen.findByText(ar.classSchedule.addSlot)).closest('button')!)
    expect(screen.getByText('الحصة 2')).toBeInTheDocument()

    pressEscape()
    pressEscape()
    await clickWhenSettled(() => document.querySelector('.ant-drawer-mask')!)
    expect(onClose).not.toHaveBeenCalled()
    // Nothing at all happens: no «discard?» question either (that is the close button's).
    expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()
    const editor = screen.getByTestId('schedule-editor')
    expect(within(editor).getByText('الحصة 2')).toBeInTheDocument()

    fireEvent.click(within(editor).getByText(ar.common.cancel).closest('button')!)
    await waitFor(() => expect(screen.queryByTestId('schedule-editor')).not.toBeInTheDocument())
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([])
  })

  it('lets the drawer go while the schedule editor matches the server: a new slot holds it, removing that slot again lets Escape close (J-F21 — PR #66 review, note 1)', async () => {
    mockFetch((url, init) => {
      const parsed = new URL(url, 'http://localhost')
      if ((init?.method ?? 'GET') !== 'GET') return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
      if (parsed.pathname === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass())
      if (parsed.pathname === `/api/classes/${CLASS_ID}/schedule`) return jsonResponse(200, makeSchedule())
      if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
      if (parsed.pathname === '/api/rooms') return jsonResponse(200, { items: [makeRoom()] })
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    })
    const onClose = vi.fn()
    renderWithProviders(<ClassDrawer classId={CLASS_ID} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
      auth: makeAuth({ user: makeUser({ permissions: SCHEDULE_ADMIN_PERMISSIONS }) }),
      route: '/classes',
    })
    await screen.findByText('PY-101-A')
    const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })

    fireEvent.click(screen.getByRole('tab', { name: ar.classSchedule.tab }))
    await openScheduleEditor()
    const editor = await screen.findByTestId('schedule-editor')
    fireEvent.click(within(editor).getByText(ar.classSchedule.addSlot).closest('button')!)
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(within(editor).getByLabelText(`${ar.classSchedule.removeSlot}: 2`))
    expect(within(editor).queryByText('الحصة 2')).not.toBeInTheDocument()
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()
  })
})
