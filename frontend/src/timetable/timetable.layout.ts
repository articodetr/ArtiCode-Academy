// Geometry of the weekly time grid (J-F08), pure and unit-tested in
// timetable.layout.test.ts: the hours the grid shows, where a card sits and
// how tall it is (its real start and duration), overlapping slots in lanes —
// side by side, or as a cascade when three or more share a week column
// (KI-119, `slotBox()`) — and which days the week shows (working days,
// without ever hiding a day that holds a slot).

export interface HourRange {
  /** First hour line (0–23). */
  startHour: number
  /** Last hour line (1–24). */
  endHour: number
}

/** The full 24-hour frame every grid shows on one screen without scrolling. */
export const DAY_FRAME: HourRange = { startHour: 0, endHour: 24 }

export const MIN_HOUR_HEIGHT = 16
export const DEFAULT_HOUR_HEIGHT = 24
export const MAX_HOUR_HEIGHT = 36

/** The frame, covering all 24 hours of the day. */
export function hourRangeOf(items: ReadonlyArray<{ startMinutes: number; endMinutes: number }>): HourRange {
  let { startHour, endHour } = DAY_FRAME
  for (const item of items) {
    startHour = Math.min(startHour, Math.floor(item.startMinutes / 60))
    endHour = Math.max(endHour, Math.ceil(item.endMinutes / 60))
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) }
}

/** The hour lines of a range, `startHour` to `endHour` inclusive. */
export function hoursOf(range: HourRange): number[] {
  return Array.from({ length: range.endHour - range.startHour + 1 }, (_, index) => range.startHour + index)
}

/**
 * Pixels per hour: sized so the whole `range` (all 24 hours) fits inside `availableHeight` without
 * scrolling down, clamped between `MIN_HOUR_HEIGHT` and `MAX_HOUR_HEIGHT` (`DEFAULT_HOUR_HEIGHT` when
 * unmeasured, e.g. before layout or in jsdom).
 */
export function hourHeightOf(range: HourRange, availableHeight?: number): number {
  const span = Math.max(1, range.endHour - range.startHour)
  if (availableHeight === undefined || availableHeight <= 0) return DEFAULT_HOUR_HEIGHT
  return Math.max(MIN_HOUR_HEIGHT, Math.min(MAX_HOUR_HEIGHT, Math.floor(availableHeight / span)))
}

/** Top offset and height (px) of a time span inside a grid of `range`. */
export function verticalBox(startMinutes: number, endMinutes: number, range: HourRange, hourHeight: number): { top: number; height: number } {
  const origin = range.startHour * 60
  return { top: ((startMinutes - origin) / 60) * hourHeight, height: ((endMinutes - startMinutes) / 60) * hourHeight }
}

/**
 * How a card of the grid is laid out by its height: `tiny` = one row (the course and the time),
 * `compact` = a one-line course over the time (or one row when the slot is very tight), `regular` = a
 * course on up to two lines. Between the course and the time a card shows as many WHOLE secondary lines
 * (class code, why it is in «my schedule», room, teacher) as its real height and width allow —
 * timetable.css, J-F17.
 */
export type CardDensity = 'tiny' | 'compact' | 'regular'

/** The density a card of `height` px can afford in the compact 24-hour grid. */
export function densityOf(height: number): CardDensity {
  if (height < 16) return 'tiny'
  if (height < 56) return 'compact'
  return 'regular'
}

/**
 * Where the "now" marker of the phone's day timeline goes, as an index into the day's slots (sorted by
 * start): before the first slot that has not started yet, else after the last one — so it stays on
 * screen while the day's last slot runs (J-F17). `null` = no marker (the day is not today).
 */
export function nowMarkerIndex(items: ReadonlyArray<{ startMinutes: number }>, nowMinutes: number | null): number | null {
  if (nowMinutes === null) return null
  const next = items.findIndex((item) => item.startMinutes > nowMinutes)
  return next === -1 ? items.length : next
}

export interface LaidOut<T> {
  item: T
  /** 0-based column inside its cluster. */
  column: number
  /** Columns of its cluster (1 = alone). */
  columns: number
}

/**
 * Places overlapping slots side by side. Slots overlap on half-open ranges —
 * 10:00–11:00 and 11:00–12:00 do not, as the server's EXCLUDE constraints —
 * and transitively overlapping slots form a cluster; each slot takes the
 * first column that is free at its start, and every slot of a cluster shares
 * the cluster's column count. Longer slots go first at equal starts.
 */
export function layoutDay<T extends { id: string; startMinutes: number; endMinutes: number }>(items: readonly T[]): Array<LaidOut<T>> {
  const sorted = [...items].sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes || a.id.localeCompare(b.id))
  const laidOut: Array<LaidOut<T>> = []
  let cluster: Array<LaidOut<T>> = []
  let columnEnds: number[] = []
  let clusterEnd = Number.NEGATIVE_INFINITY

  const closeCluster = () => {
    for (const placed of cluster) placed.columns = columnEnds.length
    cluster = []
    columnEnds = []
  }

  for (const item of sorted) {
    if (item.startMinutes >= clusterEnd) {
      closeCluster()
      clusterEnd = Number.NEGATIVE_INFINITY
    }
    let column = columnEnds.findIndex((end) => end <= item.startMinutes)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(item.endMinutes)
    } else {
      columnEnds[column] = item.endMinutes
    }
    const placed: LaidOut<T> = { item, column, columns: 1 }
    cluster.push(placed)
    laidOut.push(placed)
    clusterEnd = Math.max(clusterEnd, item.endMinutes)
  }
  closeCluster()
  return laidOut
}

/**
 * Where a laid-out slot sits across its day column, in percent of the column and measured from the
 * column's inline-start edge — the right edge in Arabic, the left in English: the grid places it with
 * `inset-inline-start`, so nothing here depends on the direction and the whole cluster mirrors with it.
 */
export interface SlotBox {
  /** Offset from the column's inline-start edge (% of the column). */
  inlineStart: number
  /** Width (% of the column). */
  inlineSize: number
  /** Part of a cascade: the card overlaps the cards of its cluster's later lanes. */
  cascade: boolean
}

/** A cluster of this many lanes or more cascades in a week column. */
export const CASCADE_MIN_LANES = 3
/** The width of every card of a cascade (% of the column). */
export const CASCADE_CARD_WIDTH = 60

/**
 * The box of a slot in lane `lane` of a cluster of `lanes` lanes (from `layoutDay()`).
 *
 * KI-119 (D-R142, a layout decision delegated to the session): side by side, three overlapping slots of
 * a seven-day week left each card about 26 px at 1366 px (a week column is 102–130 px) — the course cut,
 * no time. So in a week column (`weekColumn` — the grid shows more than one day, the same test as the
 * card's `narrow` flag) a cluster of three lanes or more becomes a CASCADE, as calendar apps do: every
 * card is 60 % of the column and lane i starts i × 40 % ÷ (lanes − 1) from the inline-start edge, so the
 * first lane touches the start and the last one the end. The cards keep their DOM order — start time,
 * the keyboard's order — so a card painted later lies on top, and the one that starts last shows its
 * course and start time (about 54 px of a 102 px column, against 26). A covered card keeps its top (its
 * course) unless another card starts at the same time. While a card of a later lane lies on it, it keeps
 * a strip at its inline-start edge, where its text begins — 20 % of the column with three lanes (≥ 24 px
 * from a 120 px column); a later card that takes a lower lane back (c over b in the partial cluster of
 * timetable.layout.test.ts) covers that edge instead and leaves it a strip at its inline-end edge.
 * Hovering a card or focusing it from the keyboard brings it to the front whole (timetable.css,
 * `.tt-slot.is-cascade`); its accessible name already says everything. One lane, two lanes (today's
 * halves read well enough) and the day view (a wide column: even five lanes keep more than 120 px each
 * at 1366 px) stay side by side. A «+N» marker was ruled out: it would need a new string. Five lanes or
 * more leave thin strips — the filters narrow the week, and the day view lays them side by side.
 */
export function slotBox(lane: number, lanes: number, weekColumn: boolean): SlotBox {
  if (!weekColumn || lanes < CASCADE_MIN_LANES) return { inlineStart: (lane * 100) / lanes, inlineSize: 100 / lanes, cascade: false }
  return { inlineStart: (lane * (100 - CASCADE_CARD_WIDTH)) / (lanes - 1), inlineSize: CASCADE_CARD_WIDTH, cascade: true }
}

export interface VisibleDaysOptions {
  /** The academy's working days; null = not set (every day). */
  workingDays: readonly number[] | null
  /** Show the whole week whatever the working days. */
  showAll: boolean
  /** Weekdays that hold at least one slot this week — never hidden. */
  busy: ReadonlySet<number>
  /** The selected date's weekday — never hidden. */
  selected: number
  /** The weekday filter of the academy schedule: that day alone. */
  onlyWeekday?: number
}

/**
 * The weekdays the week shows, in the academy's order (`order`): the working
 * days (every day when they are not set, or with `showAll`), plus any day that
 * holds a slot or is the selected date, so a slot on a day off is never
 * hidden. The weekday filter shows its day alone.
 */
export function visibleWeekdays(order: readonly number[], options: VisibleDaysOptions): number[] {
  if (options.onlyWeekday !== undefined) return order.filter((day) => day === options.onlyWeekday)
  const working = options.showAll || options.workingDays === null ? null : new Set(options.workingDays)
  return order.filter((day) => working === null || working.has(day) || options.busy.has(day) || day === options.selected)
}
