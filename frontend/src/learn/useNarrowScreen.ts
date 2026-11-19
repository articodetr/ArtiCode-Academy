// True below antd's `lg` breakpoint (992 px): the course player then moves its
// curriculum sidebar into a drawer opened by «محتوى الدورة».
import { useSyncExternalStore } from 'react'

export const NARROW_QUERY = '(max-width: 991.98px)'

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null
}

function subscribe(onChange: () => void): () => void {
  const list = query()
  if (!list || typeof list.addEventListener !== 'function') return () => undefined
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

const snapshot = () => query()?.matches ?? false

export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
