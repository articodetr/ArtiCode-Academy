// The admin home's two colours for its two-tone icons (J-F59). The palette lives once, as CSS custom properties on
// :root in layout/AppLayout.css (`--ac-primary`, `--ac-accent`, …), so an academy's branding can override it later;
// an icon needs literal colours, so they are read from those properties, with the spec's defaults when unset.
import { useMemo } from 'react'

export const DEFAULT_TONES = { primary: '#2E5BBA', accent: '#E9AC3C' } as const

/** The value of a CSS custom property on the document root, trimmed; '' when unset or outside a browser. */
function rootProperty(name: string): string {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return ''
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** `[outline, fill]` for antd's two-tone icons: the primary blue, then the gold accent. */
export function useTwoTone(): [string, string] {
  return useMemo(() => [rootProperty('--ac-primary') || DEFAULT_TONES.primary, rootProperty('--ac-accent') || DEFAULT_TONES.accent], [])
}
