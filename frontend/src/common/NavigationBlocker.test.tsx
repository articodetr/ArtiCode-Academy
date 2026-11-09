// KI-055 (J-F27): NavigationBlocker holds every router navigation while `when` is true
// and hands the held one over (null once none is held). Under the plain <MemoryRouter>
// of renderWithProviders it renders nothing — react-router's useBlocker throws there.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { blockerStates, goBack, renderInDataRouter } from '../test/navigation'
import { renderWithProviders } from '../test/render'
import { NavigationBlocker } from './NavigationBlocker'
import type { BlockedNavigation } from './unsavedChanges'

type OnBlocked = (navigation: BlockedNavigation | null) => void

/** A page whose guard can leave (as a drawer's body does when the drawer closes). */
function GuardedPage({ when, onBlocked }: { when: boolean; onBlocked: OnBlocked }) {
  const [guarding, setGuarding] = useState(true)
  return (
    <>
      {guarding ? <NavigationBlocker when={when} onBlocked={onBlocked} /> : null}
      <p>صفحة المحرّر</p>
      <button type="button" onClick={() => setGuarding(false)}>
        إزالة الحارس
      </button>
    </>
  )
}

/** The navigation handed over last (null when none is held). */
const lastHeld = (onBlocked: Mock<OnBlocked>) => onBlocked.mock.lastCall?.[0] ?? null

describe('NavigationBlocker', () => {
  it('renders nothing and holds nothing outside a data router (the MemoryRouter of renderWithProviders)', () => {
    const onBlocked = vi.fn<OnBlocked>()
    renderWithProviders(<GuardedPage when onBlocked={onBlocked} />, { route: '/page' })
    expect(screen.getByText('صفحة المحرّر')).toBeInTheDocument()
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('holds a back navigation while `when` is true: reset stays on the route, proceed goes back', async () => {
    const onBlocked = vi.fn<OnBlocked>()
    const { router } = renderInDataRouter(<GuardedPage when onBlocked={onBlocked} />, { path: '/page' })
    await screen.findByText('صفحة المحرّر')

    await goBack(router)
    const held = lastHeld(onBlocked)
    expect(held).toMatchObject({ state: 'blocked' })
    expect(router.state.location.pathname).toBe('/page')

    act(() => held!.reset())
    expect(blockerStates(router)).toEqual(['unblocked'])
    await waitFor(() => expect(lastHeld(onBlocked)).toBeNull())
    expect(router.state.location.pathname).toBe('/page')

    await goBack(router)
    const again = lastHeld(onBlocked)
    expect(again).toMatchObject({ state: 'blocked' })
    await act(async () => again!.proceed())
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/')
    // The page left, and its blocker with it: nothing is held any more.
    expect(lastHeld(onBlocked)).toBeNull()
  })

  it('lets every navigation through while `when` is false', async () => {
    const onBlocked = vi.fn<OnBlocked>()
    const { router } = renderInDataRouter(<GuardedPage when={false} onBlocked={onBlocked} />, { path: '/page' })
    await screen.findByText('صفحة المحرّر')

    await goBack(router)
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
    expect(onBlocked.mock.calls.every(([navigation]) => navigation === null)).toBe(true)
  })

  it('reports nothing held once it leaves while holding a navigation, and the next back goes through', async () => {
    const onBlocked = vi.fn<OnBlocked>()
    const { router } = renderInDataRouter(<GuardedPage when onBlocked={onBlocked} />, { path: '/page' })
    await screen.findByText('صفحة المحرّر')

    await goBack(router)
    expect(lastHeld(onBlocked)).toMatchObject({ state: 'blocked' })
    fireEvent.click(screen.getByText('إزالة الحارس'))
    expect(lastHeld(onBlocked)).toBeNull()

    await goBack(router)
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
  })
})
