// KI-055 (J-F27): the class drawer's unsaved work also holds a browser back/forward —
// the router blocker asks the drawer's «discard?» question (common.unsaved.*), one at a
// time with the close button's — and a reload or a tab close (beforeunload: the
// browser's own prompt). Rendered in a data router (src/test/navigation.tsx), which
// useBlocker needs; Escape, the mask and the close button stay in ClassDrawer.unsaved.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AcademyClass } from '../api/classes'
import { ar } from '../i18n/ar'
import { CLASS_ID, makeClass } from '../test/classes'
import { clickWhenSettled } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { answerDiscardQuestion, blockerStates, discardQuestionCount, goBack, latestDiscardQuestion, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser } from '../test/render'
import { ClassDrawer } from './ClassDrawer'

const EDITOR_PERMISSIONS = ['classes.read', 'classes.manage', 'courses.read', 'users.read']

/** GET returns the class as the server holds it; the edit form's PATCH merges into it. Every write is recorded. */
function mockClassApi() {
  let current: AcademyClass = makeClass({ status: 'open' })
  const writes: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname } = new URL(url, 'http://localhost')
    if (method !== 'GET') writes.push(`${method} ${pathname}`)
    if (pathname !== `/api/classes/${CLASS_ID}`) return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    if (method === 'PATCH') {
      current = { ...current, ...(JSON.parse(String(init?.body)) as Partial<AcademyClass>), updatedAt: '2026-11-09T12:00:00.000Z' }
      return jsonResponse(200, current)
    }
    return method === 'GET' ? jsonResponse(200, current) : jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return { writes }
}

async function renderDrawer() {
  const onClose = vi.fn()
  const { router } = renderInDataRouter(<ClassDrawer classId={CLASS_ID} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: EDITOR_PERMISSIONS }) }),
    path: '/classes',
  })
  await screen.findByText('PY-101-A')
  return { router, onClose }
}

async function startEditing() {
  fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
  return screen.findByLabelText(ar.classes.fields.capacity)
}

/** The class holds 20 seats: 25 is unsaved work. */
async function typeCapacity() {
  const capacity = await startEditing()
  await userEvent.clear(capacity)
  await userEvent.type(capacity, '25')
}

const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const expectBackOnPrevious = async () => expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')

describe('ClassDrawer — browser back, reload and tab close with unsaved work (KI-055)', () => {
  it('lets a reload and a back navigation through while nothing is unsaved, even with the edit form open', async () => {
    mockClassApi()
    const { router, onClose } = await renderDrawer()
    await startEditing()
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('holds a back navigation while the edit form has a change: «keep editing» stays with the draft, «discard» goes back and closes', async () => {
    const { writes } = mockClassApi()
    const { router, onClose } = await renderDrawer()
    await typeCapacity()
    expect(unloadWouldPrompt()).toBe(true)

    await goBack(router)
    const first = await latestDiscardQuestion()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/classes')
    await answerDiscardQuestion(first, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/classes')
    expect(screen.getByLabelText(ar.classes.fields.capacity)).toHaveValue('25')
    expect(onClose).not.toHaveBeenCalled()
    expect(unloadWouldPrompt()).toBe(true)

    // Held again: the second back asks again, and «discard» lets it go on.
    const asked = discardQuestionCount()
    await goBack(router)
    expect(discardQuestionCount()).toBe(asked + 1)
    expect(router.state.location.pathname).toBe('/classes')
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await expectBackOnPrevious()
    expect(onClose).toHaveBeenCalledTimes(1)
    // The drawer left with its page: a reload is no longer held.
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })

  it('asks no second question when a back navigation comes while the close button asks: «discard» goes back and closes', async () => {
    mockClassApi()
    const { router, onClose } = await renderDrawer()
    await typeCapacity()

    await clickWhenSettled(closeButton)
    const dialog = await latestDiscardQuestion()
    await goBack(router)
    expect(discardQuestionCount()).toBe(1)
    expect(router.state.location.pathname).toBe('/classes')

    await answerDiscardQuestion(dialog, 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the work and the route when that one question is answered «keep editing»', async () => {
    mockClassApi()
    const { router, onClose } = await renderDrawer()
    await typeCapacity()

    await clickWhenSettled(closeButton)
    const dialog = await latestDiscardQuestion()
    await goBack(router)
    expect(discardQuestionCount()).toBe(1)

    await answerDiscardQuestion(dialog, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/classes')
    expect(screen.getByLabelText(ar.classes.fields.capacity)).toHaveValue('25')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets go once the change is saved: a reload is not held and back goes through', async () => {
    const { writes } = mockClassApi()
    const { router } = await renderDrawer()
    await typeCapacity()
    expect(unloadWouldPrompt()).toBe(true)

    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.classes.drawer.saved)).toBeInTheDocument()
    await waitFor(() => expect(unloadWouldPrompt()).toBe(false))
    expect(writes).toEqual([`PATCH /api/classes/${CLASS_ID}`])

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
  })

  it('lets go once the work is discarded with the close button: a reload is not held and back goes through', async () => {
    const { writes } = mockClassApi()
    const { router, onClose } = await renderDrawer()
    await typeCapacity()

    await clickWhenSettled(closeButton)
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(unloadWouldPrompt()).toBe(false)

    const asked = discardQuestionCount()
    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(asked)
    expect(writes).toEqual([])
  })
})
