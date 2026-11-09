// KI-055 (J-F27): the user drawer's unsaved work also holds a browser back/forward —
// the router blocker asks the drawer's «discard?» question (common.unsaved.*) — and a
// reload or a tab close (beforeunload: the browser's own prompt). Rendered in a data
// router (src/test/navigation.tsx); Escape, the mask and the close button stay in
// UserDrawer.unsaved.test.tsx, the one-question rule in ClassDrawer.navigation.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { answerDiscardQuestion, blockerStates, discardQuestionCount, goBack, latestDiscardQuestion, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser } from '../test/render'
import { ADMIN_PERMISSIONS, makeUserDetail } from '../test/users'
import { UserDrawer } from './UserDrawer'

const student = makeUserDetail()

/** GET returns the student; every write is recorded and refused. */
function mockDetailApi() {
  const writes: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      writes.push(`${method} ${new URL(url, 'http://localhost').pathname}`)
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    }
    return jsonResponse(200, student)
  })
  return { writes }
}

async function renderDrawer() {
  const onClose = vi.fn()
  const { router } = renderInDataRouter(<UserDrawer userId={student.id} onClose={onClose} onUpdated={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: ADMIN_PERMISSIONS }) }),
    path: '/users',
  })
  const drawer = await screen.findByRole('dialog')
  await within(drawer).findByRole('heading', { level: 4, name: student.fullName })
  return { router, onClose, drawer }
}

async function startEditing(drawer: HTMLElement) {
  fireEvent.click(within(drawer).getByText(ar.common.edit).closest('button')!)
  return within(drawer).findByLabelText(ar.users.fields.displayName)
}

const expectBackOnPrevious = async () => expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')

describe('UserDrawer — browser back, reload and tab close with unsaved work (KI-055)', () => {
  it('lets a reload and a back navigation through while nothing is unsaved', async () => {
    mockDetailApi()
    const { router, onClose } = await renderDrawer()
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('holds a back navigation while the edit form has a change: «keep editing» stays with the draft, «discard» goes back and closes', async () => {
    const { writes } = mockDetailApi()
    const { router, onClose, drawer } = await renderDrawer()
    await userEvent.type(await startEditing(drawer), 'عمر')
    expect(unloadWouldPrompt()).toBe(true)

    await goBack(router)
    await answerDiscardQuestion(await latestDiscardQuestion(), 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/users')
    expect(within(drawer).getByLabelText(ar.users.fields.displayName)).toHaveValue('عمر')
    expect(onClose).not.toHaveBeenCalled()

    const asked = discardQuestionCount()
    await goBack(router)
    expect(discardQuestionCount()).toBe(asked + 1)
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await expectBackOnPrevious()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })

  it('lets go of a change typed back to the stored value: a reload is not held and back goes through', async () => {
    const { writes } = mockDetailApi()
    const { router, drawer } = await renderDrawer()
    const displayName = await startEditing(drawer)

    await userEvent.type(displayName, 'ع')
    expect(unloadWouldPrompt()).toBe(true)
    // The stored display name is empty: cleared again, nothing is left to lose.
    await userEvent.clear(displayName)
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
    expect(writes).toEqual([])
  })
})
