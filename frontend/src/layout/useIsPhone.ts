// True on a phone-sized viewport (below antd's `md` breakpoint, 768 px): the app shell then trades its side menu for a
// drawer opened from the header (AppLayout). Read from `matchMedia` and followed on a resize; antd's
// `Grid.useBreakpoint()` is not used because jsdom's `matchMedia` shim (src/test/setup.ts) answers `false` to every query
// — that reads as «no breakpoint reached» (a phone) there, while here `false` means a desktop.
import { useSyncExternalStore } from 'react'

/** The same edge as `@media (max-width: 767.98px)` in AppLayout.css. */
export const PHONE_QUERY = '(max-width: 767.98px)'

function phoneQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null
}

function subscribe(onChange: () => void): () => void {
  const list = phoneQuery()
  if (!list) return () => undefined
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }
  // Safari before 14 has only the deprecated listener methods.
  list.addListener?.(onChange)
  return () => list.removeListener?.(onChange)
}

const snapshot = () => phoneQuery()?.matches ?? false

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
