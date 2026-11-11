// KI-054 (J-F23): while the edit form or the syllabus editor of the course drawer
// holds unsaved work, Escape and a mask click no longer close the drawer, and the
// close button asks before discarding it. An editor opened without a change, or
// changed back, holds nothing (the J-F21 rule of the class drawer).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { COURSE_ID, COURSE_MANAGER_PERMISSIONS, makeCourse, makeLevel, makeSyllabus } from '../test/courses'
import { clickWhenSettled } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CourseDrawer } from './CourseDrawer'

/** The course and its syllabus; every write is recorded and refused. */
function mockCourseApi() {
  const writes: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      writes.push(`${method} ${url}`)
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    }
    return jsonResponse(200, url.endsWith('/syllabus') ? makeSyllabus() : makeCourse())
  })
  return { writes }
}

function renderDrawer() {
  const onClose = vi.fn()
  renderWithProviders(<CourseDrawer courseId={COURSE_ID} levels={[makeLevel()]} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: COURSE_MANAGER_PERMISSIONS }) }),
    route: '/courses',
  })
  return { onClose }
}

/** Escape as the browser sends it: the drawer listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const mask = () => document.querySelector<HTMLElement>('.ant-drawer-mask')!
/** Escape and the mask do nothing at all while an editor holds unsaved work: no close and no «discard?» question either. */
const expectNoDiscardQuestion = () => expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()

async function startEditing() {
  await screen.findByText('PY-101')
  fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
  return screen.findByLabelText(ar.courses.fields.nameEn)
}

async function startSyllabusEditing() {
  await screen.findByText('PY-101')
  fireEvent.click(screen.getByRole('tab', { name: ar.courses.drawer.tabs.syllabus }))
  fireEvent.click((await screen.findByText(ar.courses.syllabus.edit)).closest('button')!)
  await screen.findAllByTestId('syllabus-item-editor')
}

/** Clicks the drawer's close button and returns the «discard?» confirmation it opens (the latest one). */
async function openDiscardDialog(): Promise<HTMLElement> {
  await clickWhenSettled(closeButton)
  const titles = await screen.findAllByText(ar.common.unsaved.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}

describe('CourseDrawer — unsaved editors (KI-054)', () => {
  it('closes at once on Escape, on a mask click and with the close button while nothing is unsaved (as before)', async () => {
    mockCourseApi()
    const { onClose } = renderDrawer()
    await screen.findByText('PY-101')

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    await clickWhenSettled(mask)
    expect(onClose).toHaveBeenCalledTimes(2)
    await clickWhenSettled(closeButton)
    expect(onClose).toHaveBeenCalledTimes(3)
    expectNoDiscardQuestion()
  })

  it('keeps the edit form and its draft on Escape and on a mask click; the close button asks — cancel stays, confirm closes', async () => {
    const { writes } = mockCourseApi()
    const { onClose } = renderDrawer()
    const english = await startEditing()
    await userEvent.clear(english)
    await userEvent.type(english, 'Python 3')

    pressEscape()
    pressEscape()
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    expect(screen.getByLabelText(ar.courses.fields.nameEn)).toHaveValue('Python 3')

    const first = await openDiscardDialog()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    fireEvent.click(within(first).getByText(ar.common.unsaved.cancel).closest('button')!)
    await waitFor(() => expect(screen.getByLabelText(ar.courses.fields.nameEn)).toHaveValue('Python 3'))
    expect(onClose).not.toHaveBeenCalled()

    const second = await openDiscardDialog()
    fireEvent.click(within(second).getByText(ar.common.unsaved.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(writes).toEqual([])
  })

  it('holds nothing while the edit form is open without a change: Escape closes at once', async () => {
    mockCourseApi()
    const { onClose } = renderDrawer()
    await startEditing()

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
  })

  it('lets go of a change typed back: Escape keeps the form while it differs and closes once it matches the course again', async () => {
    const { writes } = mockCourseApi()
    const { onClose } = renderDrawer()
    const english = await startEditing()

    // The course is «Python Basics» in English: typed away and back, nothing is left to lose.
    await userEvent.type(english, '!')
    expect(english).toHaveValue('Python Basics!')
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.type(english, '{Backspace}')
    expect(english).toHaveValue('Python Basics')
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    expect(writes).toEqual([])
  })

  it('keeps the syllabus draft on Escape and on a mask click; the close button asks, and confirm closes', async () => {
    const { writes } = mockCourseApi()
    const { onClose } = renderDrawer()
    await startSyllabusEditing()

    // A change without opening any popup: the first item leaves the list.
    fireEvent.click(screen.getByLabelText(`${ar.courses.syllabus.remove} 1`))
    expect(screen.getAllByTestId('syllabus-item-editor')).toHaveLength(2)

    pressEscape()
    pressEscape()
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    expect(screen.getAllByTestId('syllabus-item-editor')).toHaveLength(2)

    const first = await openDiscardDialog()
    fireEvent.click(within(first).getByText(ar.common.unsaved.cancel).closest('button')!)
    expect(onClose).not.toHaveBeenCalled()
    const second = await openDiscardDialog()
    fireEvent.click(within(second).getByText(ar.common.unsaved.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(writes).toEqual([])
  })

  it('holds nothing while the syllabus editor is open without a change: Escape closes at once', async () => {
    mockCourseApi()
    const { onClose } = renderDrawer()
    await startSyllabusEditing()

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
  })

  it('lets go of an item added and removed again: Escape keeps the editor while the list differs and closes once it matches', async () => {
    const { writes } = mockCourseApi()
    const { onClose } = renderDrawer()
    await startSyllabusEditing()

    fireEvent.click(screen.getByText(ar.courses.syllabus.add).closest('button')!)
    expect(screen.getAllByTestId('syllabus-item-editor')).toHaveLength(4)
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText(`${ar.courses.syllabus.remove} 4`))
    expect(screen.getAllByTestId('syllabus-item-editor')).toHaveLength(3)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    expect(writes).toEqual([])
  })
})
