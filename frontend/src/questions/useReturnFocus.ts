// A dialog mounted per session (KI-049) leaves the page without the closing
// transition in which Ant Design gives the focus back to what opened it: the
// focus would be left on the document. The page remembers the opener when a
// session starts (`remember()`), and `giveBack()` returns the focus to it once
// the session has ended — or to `fallback` when that element is gone (the row
// was deleted, the list was read again) or can no longer take the focus.
import { useCallback, useRef } from 'react'

export interface ReturnFocus {
  /** Call when the dialog opens: the focused element is its opener. */
  remember: () => void
  /** Call when the dialog has closed: the opener takes the focus back, else `fallback` does. */
  giveBack: (fallback?: HTMLElement | null) => void
}

export function useReturnFocus(): ReturnFocus {
  const opener = useRef<HTMLElement | null>(null)

  const remember = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])

  const giveBack = useCallback((fallback?: HTMLElement | null) => {
    const element = opener.current
    opener.current = null
    // After the render that takes the dialog away.
    setTimeout(() => {
      const target = element && element.isConnected && !element.matches(':disabled') ? element : fallback
      target?.focus({ preventScroll: true })
    }, 0)
  }, [])

  return { remember, giveBack }
}
