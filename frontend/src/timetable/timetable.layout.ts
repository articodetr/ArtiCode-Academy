// Geometry of the weekly time grid (J-F08), pure and unit-tested in
// timetable.layout.test.ts: the hours the grid shows, where a card sits and
// how tall it is (its real start and duration), overlapping slots side by
// side in columns (never on top of each other), and which days the week
// shows (working days, without ever hiding a day that holds a slot).

export interface HourRange {
  /** First hour line (0–23). */
  startHour: number
  /** Last hour line (1–24). */
  endHour: number
}

/** The working-day frame every grid shows; slots outside it extend it. */
export const DAY_FRAME: HourRange = { startHour: 8, endHour: 17 }

/** The frame, widened to the whole hours that hold every given slot. */
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

/** Pixels per hour: roomy for an ordinary day, tighter when the range is long. */
export function hourHeightOf(range: HourRange): number {
  return range.endHour - range.startHour > 12 ? 52 : 64
}

/** Top offset and height (px) of a time span inside a grid of `range`. */
export function verticalBox(startMinutes: number, endMinutes: number, range: HourRange, hourHeight: number): { top: number; height: number } {
  const origin = range.startHour * 60
  return { top: ((startMinutes - origin) / 60) * hourHeight, height: ((endMinutes - startMinutes) / 60) * hourHeight }
}

/**
 * How a card of the grid is laid out by its height: `tiny` = one row (the course and the time),
 * `compact` = a one-line course over the time, `regular` and `full` = a course on up to two lines.
 * Between the course and the time a card shows as many WHOLE secondary lines (class code, why it is
 * in «my schedule», room, teacher) as its real height and width allow — timetable.css, J-F17.
 */
export type CardDensity = 'tiny' | 'compact' | 'regular' | 'full'

/** The density a card of `height` px can afford. */
export function densityOf(height: number): CardDensity {
  if (height < 44) return 'tiny'
  if (height < 84) return 'compact'
  if (height < 124) return 'regular'
  return 'full'
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
