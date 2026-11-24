/** Brings a part of the lessons page into view, without the animation for a reader who asked for less motion. */
export function scrollToStart(element: HTMLElement | null) {
  const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element?.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
}
