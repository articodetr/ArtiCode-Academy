import { describe, expect, it } from 'vitest'
import { clockMinutes } from './timetable.dates'
import { densityOf, hourHeightOf, hourRangeOf, hoursOf, layoutDay, nowMarkerIndex, slotBox, verticalBox, visibleWeekdays } from './timetable.layout'

function slot(id: string, start: string, end: string) {
  return { id, startMinutes: clockMinutes(start), endMinutes: clockMinutes(end) }
}

function columnsOf(items: Array<ReturnType<typeof slot>>) {
  return Object.fromEntries(layoutDay(items).map(({ item, column, columns }) => [item.id, [column, columns]]))
}

describe('hour range and boxes', () => {
  it('keeps the 08–17 frame and widens it to whole hours around early or late slots', () => {
    expect(hourRangeOf([])).toEqual({ startHour: 8, endHour: 17 })
    expect(hourRangeOf([slot('a', '09:00', '11:00')])).toEqual({ startHour: 8, endHour: 17 })
    expect(hourRangeOf([slot('a', '07:30', '09:00'), slot('b', '18:00', '20:15')])).toEqual({ startHour: 7, endHour: 21 })
    expect(hourRangeOf([slot('a', '00:00', '23:59')])).toEqual({ startHour: 0, endHour: 24 })
    expect(hoursOf({ startHour: 8, endHour: 10 })).toEqual([8, 9, 10])
    expect(hourHeightOf({ startHour: 8, endHour: 17 })).toBe(64)
    expect(hourHeightOf({ startHour: 7, endHour: 21 })).toBe(52)
  })

  it('places a card at its start time with a height equal to its duration', () => {
    const range = { startHour: 8, endHour: 17 }
    expect(verticalBox(clockMinutes('09:00'), clockMinutes('11:00'), range, 64)).toEqual({ top: 64, height: 128 })
    expect(verticalBox(clockMinutes('10:30'), clockMinutes('11:15'), range, 64)).toEqual({ top: 160, height: 48 })
    expect(verticalBox(clockMinutes('08:00'), clockMinutes('08:30'), range, 52)).toEqual({ top: 0, height: 26 })
    expect(densityOf(26)).toBe('tiny')
    expect(densityOf(48)).toBe('compact')
    expect(densityOf(96)).toBe('regular')
    expect(densityOf(128)).toBe('regular')
  })

  it('has three densities: one row under 44 px, a one-line course over the time under 84 px, else up to two lines (J-F22)', () => {
    expect(densityOf(43.99)).toBe('tiny')
    expect(densityOf(44)).toBe('compact')
    // A one-hour slot of a long week (52 px per hour) and of an ordinary one (64): both compact — the
    // short ones keep their time in a tightened card (timetable.css; browser-checked, jsdom has no
    // container queries).
    expect(densityOf(52)).toBe('compact')
    expect(densityOf(64)).toBe('compact')
    expect(densityOf(83.99)).toBe('compact')
    expect(densityOf(84)).toBe('regular')
    // The former `full` (from 124 px) was laid out exactly like `regular`: folded into it.
    expect(densityOf(124)).toBe('regular')
    expect(densityOf(24 * 64)).toBe('regular')
  })
})

describe('overlapping slots', () => {
  it('keeps separate and back-to-back slots full width (half-open ranges, as the EXCLUDE constraints)', () => {
    expect(columnsOf([slot('a', '09:00', '10:00'), slot('b', '10:00', '11:00'), slot('c', '12:00', '13:00')])).toEqual({ a: [0, 1], b: [0, 1], c: [0, 1] })
    expect(layoutDay([])).toEqual([])
  })

  it('puts overlapping slots side by side and shares the column count across a cluster', () => {
    expect(columnsOf([slot('a', '09:00', '11:00'), slot('b', '10:00', '12:00')])).toEqual({ a: [0, 2], b: [1, 2] })
    // a overlaps b and b overlaps c, a and c do not: c takes a's column back; the three share two columns.
    expect(columnsOf([slot('a', '09:00', '10:30'), slot('b', '10:00', '12:00'), slot('c', '11:00', '12:30')])).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2] })
    // Equal starts: the longer slot first, then by id.
    expect(columnsOf([slot('x', '09:00', '10:00'), slot('y', '09:00', '11:00'), slot('z', '09:00', '10:00')])).toEqual({ y: [0, 3], x: [1, 3], z: [2, 3] })
    // A later, separate cluster starts again at one column.
    expect(columnsOf([slot('a', '09:00', '11:00'), slot('b', '10:00', '12:00'), slot('d', '13:00', '14:00')]).d).toEqual([0, 1])
  })
})

describe('the box of a slot across its column (KI-119)', () => {
  /** Each slot's box in a week column (`weekColumn`) or the day view, by id. */
  function boxesOf(items: Array<ReturnType<typeof slot>>, weekColumn = true) {
    return Object.fromEntries(layoutDay(items).map(({ item, column, columns }) => [item.id, slotBox(column, columns, weekColumn)]))
  }

  it('keeps one lane full width and two lanes side by side, as before', () => {
    expect(slotBox(0, 1, true)).toEqual({ inlineStart: 0, inlineSize: 100, cascade: false })
    expect(boxesOf([slot('a', '09:00', '11:00'), slot('b', '10:00', '12:00')])).toEqual({
      a: { inlineStart: 0, inlineSize: 50, cascade: false },
      b: { inlineStart: 50, inlineSize: 50, cascade: false },
    })
  })

  it('cascades three lanes in a week column: every card 60 % of the column, each lane a fifth further, the last touching the end', () => {
    const boxes = boxesOf([slot('a', '09:00', '10:30'), slot('b', '09:00', '10:30'), slot('c', '09:00', '10:30')])
    expect(boxes).toEqual({
      a: { inlineStart: 0, inlineSize: 60, cascade: true },
      b: { inlineStart: 20, inlineSize: 60, cascade: true },
      c: { inlineStart: 40, inlineSize: 60, cascade: true },
    })
    // Side by side, each card had a third of the column; in the cascade each has more, and here — three
    // lanes painted in lane order — each covered card keeps a strip of a fifth at its inline-start edge.
    for (const box of Object.values(boxes)) expect(box.inlineSize).toBeGreaterThan(100 / 3)
  })

  it('cascades five lanes with the same card width and even steps, from the start to the end of the column', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((id) => slot(id, '09:00', '10:00'))
    const boxes = Object.values(boxesOf(five))
    expect(boxes.map((box) => box.inlineStart)).toEqual([0, 10, 20, 30, 40])
    expect(boxes.every((box) => box.inlineSize === 60 && box.cascade)).toBe(true)
  })

  it('cascades every slot of a cluster with three lanes, also one that overlaps a single other slot; a separate cluster stays full width', () => {
    // a overlaps b and d; c overlaps only b — and takes a's lane back. The cluster has three lanes.
    const boxes = boxesOf([slot('a', '09:00', '10:30'), slot('b', '10:00', '12:00'), slot('d', '10:15', '10:45'), slot('c', '11:00', '12:30'), slot('e', '14:00', '15:00')])
    expect(boxes.a).toEqual({ inlineStart: 0, inlineSize: 60, cascade: true })
    expect(boxes.b).toEqual({ inlineStart: 20, inlineSize: 60, cascade: true })
    expect(boxes.d).toEqual({ inlineStart: 40, inlineSize: 60, cascade: true })
    expect(boxes.c).toEqual({ inlineStart: 0, inlineSize: 60, cascade: true })
    expect(boxes.e).toEqual({ inlineStart: 0, inlineSize: 100, cascade: false })
    // The cards keep their start order — the keyboard's order, and the one painted last lies on top. So c,
    // painted after b and back in lane 0, covers b's inline-start edge from 11:00: b keeps its top and, beside
    // c, the strip at its inline-end edge (60 %–80 % of the column).
    expect(layoutDay([slot('c', '11:00', '12:30'), slot('d', '10:15', '10:45'), slot('b', '10:00', '12:00'), slot('a', '09:00', '10:30')]).map(({ item }) => item.id)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('lays three lanes or more side by side in the day view, whose column is wide', () => {
    const boxes = boxesOf([slot('a', '09:00', '10:00'), slot('b', '09:00', '10:00'), slot('c', '09:00', '10:00')], false)
    expect(Object.values(boxes).map((box) => [box.inlineSize, box.cascade])).toEqual([
      [100 / 3, false],
      [100 / 3, false],
      [100 / 3, false],
    ])
    expect(boxes.c.inlineStart).toBeCloseTo(200 / 3)
  })

  it('measures from the inline-start edge only, so the same boxes serve Arabic and English and the cascade mirrors whole', () => {
    for (const lanes of [1, 2, 3, 5]) {
      const boxes = Array.from({ length: lanes }, (_, lane) => slotBox(lane, lanes, true))
      // Logical offsets and sizes only — no left/right, no direction argument.
      for (const box of boxes) expect(Object.keys(box).sort()).toEqual(['cascade', 'inlineSize', 'inlineStart'])
      // The first lane touches the column's start and the last its end, in either direction.
      expect(boxes[0]!.inlineStart).toBe(0)
      expect(boxes[lanes - 1]!.inlineStart + boxes[lanes - 1]!.inlineSize).toBeCloseTo(100)
      // Every lane starts further from the start than the one before.
      for (let lane = 1; lane < lanes; lane += 1) expect(boxes[lane]!.inlineStart).toBeGreaterThan(boxes[lane - 1]!.inlineStart)
      // From three lanes each card reaches over the next one's start (the cascade), so the next lane's card
      // leaves a strip at its inline-start edge uncovered — the right edge in Arabic, the left in English,
      // with the text's start.
      for (let lane = 1; lane < lanes; lane += 1) {
        const previous = boxes[lane - 1]!
        if (lanes >= 3) expect(previous.inlineStart + previous.inlineSize).toBeGreaterThan(boxes[lane]!.inlineStart)
        else expect(previous.inlineStart + previous.inlineSize).toBe(boxes[lane]!.inlineStart)
      }
    }
  })
})

describe('visible days', () => {
  const fromSaturday = [6, 0, 1, 2, 3, 4, 5]

  it('shows the working days in the academy order, plus any day that holds a slot or is selected', () => {
    expect(visibleWeekdays(fromSaturday, { workingDays: null, showAll: false, busy: new Set(), selected: 0 })).toEqual(fromSaturday)
    expect(visibleWeekdays(fromSaturday, { workingDays: [0, 1, 2, 3, 4], showAll: false, busy: new Set(), selected: 1 })).toEqual([0, 1, 2, 3, 4])
    // Friday holds a slot and Saturday is selected: neither is hidden although both are days off.
    expect(visibleWeekdays(fromSaturday, { workingDays: [0, 1, 2, 3, 4], showAll: false, busy: new Set([5]), selected: 6 })).toEqual([6, 0, 1, 2, 3, 4, 5])
    expect(visibleWeekdays(fromSaturday, { workingDays: [0, 1, 2, 3, 4], showAll: true, busy: new Set(), selected: 1 })).toEqual(fromSaturday)
  })

  it('shows the filtered weekday alone', () => {
    expect(visibleWeekdays(fromSaturday, { workingDays: [0, 1, 2, 3, 4], showAll: true, busy: new Set([1]), selected: 1, onlyWeekday: 3 })).toEqual([3])
  })
})

describe('the now marker of the phone timeline (J-F17)', () => {
  const day = [slot('a', '09:00', '10:00'), slot('b', '11:00', '12:30'), slot('c', '14:00', '15:30')]

  it('sits before the first slot that has not started yet', () => {
    expect(nowMarkerIndex(day, clockMinutes('08:00'))).toBe(0)
    // During a slot: right after it (it has started), before the next one.
    expect(nowMarkerIndex(day, clockMinutes('09:30'))).toBe(1)
    expect(nowMarkerIndex(day, clockMinutes('10:30'))).toBe(1)
    // A slot that starts now has started.
    expect(nowMarkerIndex(day, clockMinutes('11:00'))).toBe(2)
  })

  it('stays after the last slot while it runs and once the day is over; no marker on another day', () => {
    expect(nowMarkerIndex(day, clockMinutes('14:45'))).toBe(3)
    expect(nowMarkerIndex(day, clockMinutes('20:00'))).toBe(3)
    expect(nowMarkerIndex(day, null)).toBeNull()
    expect(nowMarkerIndex([], clockMinutes('10:00'))).toBe(0)
  })
})
