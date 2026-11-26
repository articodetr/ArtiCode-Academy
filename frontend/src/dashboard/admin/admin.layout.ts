// How the card grids of the admin home fill their rows (2026-11-26). How many cards a grid holds depends on the viewer's
// keys — eleven quick actions for a full admin since the classes card left, fewer for the staff; five figures at most —
// so a fixed column count would end the last row on empty slots. For each column count its width allows (admin.css,
// container queries), a grid gets the count that balances its rows — 7 cards in rows of at most 6 become 4 + 3, never
// 6 + 1 — and the cards of a shorter last row grow to close it (flex-grow), so no row ends on a gap.
import type { CSSProperties } from 'react'

/** Cards per row when a row holds at most `max`: as few rows as `max` allows, the cards spread evenly over them. */
export function balancedColumns(count: number, max: number): number {
  if (count <= 0) return max
  return Math.ceil(count / Math.ceil(count / max))
}

/** The custom properties admin.css reads (`--<name>-<max>`), one per column count the grid's breakpoints allow. */
export function columnsStyle(name: string, count: number, maxima: readonly number[]): CSSProperties {
  return Object.fromEntries(maxima.map((max) => [`--${name}-${max}`, String(balancedColumns(count, max))])) as CSSProperties
}

/** The quick actions: 2 per row on a phone, 3 on a narrow tablet, 4 on a small laptop, 6 from a wide content area. */
export const ACTION_COLUMNS = [2, 3, 4, 6] as const

/** The figures: 2 per row on a phone, then 3, 4 and 5 as the section widens (a figure keeps about 200 px). */
export const STAT_COLUMNS = [2, 3, 4, 5] as const
