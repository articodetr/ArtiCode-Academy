// KI-055 (J-F27): holds every router navigation — browser back/forward, a link, a
// navigate() call — while `when` is true, and hands the held one to `onBlocked` (null
// once none is held), so the drawer can ask «discard?» first (useUnsavedChangesGuard).
// react-router's useBlocker works in a data router only (createBrowserRouter in
// src/app/router.tsx, or createMemoryRouter + RouterProvider) and throws under a plain
// <MemoryRouter> — the one renderWithProviders mounts in the tests. Only RouterProvider
// provides UNSAFE_DataRouterContext (exported by react-router, pinned to major 7), so
// without it nothing is held and nothing renders; a test that needs the blocker renders
// through renderInDataRouter (src/test/navigation.tsx).
import { useContext, useEffect } from 'react'
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router'
import type { BlockedNavigation } from './unsavedChanges'

interface NavigationBlockerProps {
  /** Hold router navigations while true (a drawer holding unsaved work). */
  when: boolean
  /** The navigation held now (proceed or reset it), or null once none is. */
  onBlocked: (navigation: BlockedNavigation | null) => void
}

export function NavigationBlocker(props: NavigationBlockerProps) {
  const dataRouter = useContext(UNSAFE_DataRouterContext)
  return dataRouter ? <DataRouterBlocker {...props} /> : null
}

function DataRouterBlocker({ when, onBlocked }: NavigationBlockerProps) {
  const blocker = useBlocker(when)

  useEffect(() => {
    onBlocked(blocker.state === 'blocked' ? blocker : null)
  }, [blocker, onBlocked])

  // Unmounted (the drawer's body left): react-router drops the blocker with whatever it held.
  useEffect(() => () => onBlocked(null), [onBlocked])

  return null
}
