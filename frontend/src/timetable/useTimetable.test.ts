import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { jsonResponse, mockFetch } from '../test/http'
import { SLOT_ID, makeAcademySchedule, makeMyItem, makeMySchedule, makeSlot } from '../test/timetable'
import { requestKey, useTimetable } from './useTimetable'

function record(handler: (url: URL) => Response | Promise<Response>) {
  const calls: string[] = []
  mockFetch((raw) => {
    const url = new URL(raw, 'http://localhost')
    calls.push(`${url.pathname}${url.search}`)
    return handler(url)
  })
  return calls
}

/** A response the test sends when it chooses (the TS lib is ES2023: no `Promise.withResolvers`). */
function deferred() {
  let resolve: (response: Response) => void = () => {}
  const promise = new Promise<Response>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const SUNDAY = '2026-11-08'
const MONDAY = '2026-11-09'
const TUESDAY = '2026-11-10'
const minePath = (on: string) => `/api/me/schedule?on=${on}`

describe('useTimetable', () => {
  it('reads the academy schedule once per shown date with that date, its weekday and the filters', async () => {
    const calls = record((url) =>
      jsonResponse(200, makeAcademySchedule(url.searchParams.get('weekday') === '0' ? [makeSlot(), makeSlot({ id: 'early', startTime: '08:00', endTime: '09:00' })] : [], url.searchParams.get('on')!)),
    )
    const dates = [SUNDAY, MONDAY]
    const { result } = renderHook(() => useTimetable('academy', { roomId: 'r-1', branchId: 'none' }, dates, true))
    await waitFor(() => expect(result.current.pending.size).toBe(0))
    expect(calls).toEqual([`/api/schedule?on=${SUNDAY}&branchId=none&roomId=r-1&weekday=0`, `/api/schedule?on=${MONDAY}&branchId=none&roomId=r-1&weekday=1`])
    expect(result.current.byDate.get(SUNDAY)!.map((entry) => entry.id)).toEqual(['early', SLOT_ID])
    expect(result.current.byDate.get(MONDAY)).toEqual([])
    expect(result.current.failed).toBe(false)
  })

  it('asks nothing for a date that the weekday filter excludes', async () => {
    const calls = record((url) => jsonResponse(200, makeAcademySchedule([], url.searchParams.get('on')!)))
    const dates = [SUNDAY, MONDAY]
    const { result } = renderHook(() => useTimetable('academy', { weekday: 1 }, dates, true))
    await waitFor(() => expect(result.current.pending.size).toBe(0))
    expect(calls).toEqual([`/api/schedule?on=${MONDAY}&weekday=1`])
    expect(result.current.byDate.get(SUNDAY)).toEqual([])
  })

  it('reads «my schedule» once per date, keeps that weekday’s slots and folds the relations of one slot into one entry', async () => {
    const calls = record((url) =>
      jsonResponse(
        200,
        makeMySchedule(
          [
            makeMyItem({ relation: 'self' }),
            makeMyItem({ relation: 'child', student: { id: 'k-1', fullName: 'أحمد', displayName: null } }),
            makeMyItem({ id: 'tuesday', weekday: 2, relation: 'teacher', student: null }),
          ],
          url.searchParams.get('on')!,
        ),
      ),
    )
    const dates = [SUNDAY, MONDAY]
    const { result } = renderHook(() => useTimetable('mine', { roomId: 'ignored' }, dates, true))
    await waitFor(() => expect(result.current.pending.size).toBe(0))
    expect(calls).toEqual([`/api/me/schedule?on=${SUNDAY}`, `/api/me/schedule?on=${MONDAY}`])
    const sunday = result.current.byDate.get(SUNDAY)!
    expect(sunday).toHaveLength(1)
    expect(sunday[0]!.relations.map((relation) => relation.relation)).toEqual(['self', 'child'])
    expect(result.current.byDate.get(MONDAY)).toEqual([])
  })

  it('never calls the server while disabled, keeps answers, reports a failure and reads again on reload', async () => {
    let failing = true
    const calls = record((url) =>
      failing
        ? jsonResponse(403, { statusCode: 403, code: 'permission_denied', message: 'Missing permission', missing: ['schedule.manage', 'classes.manage'] })
        : jsonResponse(200, makeAcademySchedule([makeSlot()], url.searchParams.get('on')!)),
    )
    const dates = [SUNDAY]
    const { result, rerender } = renderHook(({ enabled }) => useTimetable('academy', {}, dates, enabled), { initialProps: { enabled: false } })
    expect(result.current.pending.size).toBe(0)
    expect(calls).toHaveLength(0)

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect((result.current.error as ApiError).status).toBe(403)
    rerender({ enabled: true })
    expect(calls).toHaveLength(1)

    failing = false
    act(() => result.current.reload())
    // The failure is forgotten at once; the date is pending until the new answer lands.
    expect(result.current.failed).toBe(false)
    expect(result.current.pending.has(SUNDAY)).toBe(true)
    await waitFor(() => expect(result.current.byDate.get(SUNDAY)).toHaveLength(1))
    expect(result.current.pending.size).toBe(0)
    expect(calls).toHaveLength(2)
  })

  it('keys every request by the path it asks for, so the same request is never sent twice', () => {
    expect(requestKey('mine', { roomId: 'r' }, SUNDAY)).toBe(`mine|/api/me/schedule?on=${SUNDAY}`)
    expect(requestKey('academy', { roomId: 'r' }, SUNDAY)).toBe(`academy|/api/schedule?on=${SUNDAY}&roomId=r&weekday=0`)
    expect(requestKey('academy', {}, SUNDAY)).not.toBe(requestKey('academy', {}, MONDAY))
    expect(requestKey('academy', { roomId: 'r' }, SUNDAY)).not.toBe(requestKey('academy', { classId: 'r' }, SUNDAY))
    // A weekday filter naming the date's own weekday asks exactly the unfiltered request; another weekday asks nothing.
    expect(requestKey('academy', { weekday: 0 }, SUNDAY)).toBe(requestKey('academy', {}, SUNDAY))
    expect(requestKey('academy', { weekday: 1, roomId: 'r' }, SUNDAY)).toBe(`academy|skip|${SUNDAY}`)
  })

  it('does not ask again when a weekday filter names a date already read', async () => {
    const calls = record((url) => jsonResponse(200, makeAcademySchedule([], url.searchParams.get('on')!)))
    const dates = [SUNDAY, MONDAY]
    const { result, rerender } = renderHook(({ weekday }) => useTimetable('academy', { weekday }, dates, true), { initialProps: { weekday: undefined as number | undefined } })
    await waitFor(() => expect(result.current.pending.size).toBe(0))
    rerender({ weekday: 0 })
    expect(result.current.pending.size).toBe(0)
    expect(calls).toEqual([`/api/schedule?on=${SUNDAY}&weekday=0`, `/api/schedule?on=${MONDAY}&weekday=1`])
  })

  // ---- J-F18: the owner's notes 3 and 6 on PR #46 ----------------------------

  it('pins each date the moment its answer arrives — a slow date never holds the others back — and asks every date once', async () => {
    const slowSunday = deferred()
    const calls = record((url) => (url.searchParams.get('on') === SUNDAY ? slowSunday.promise : jsonResponse(200, makeAcademySchedule([], url.searchParams.get('on')!))))
    const dates = [SUNDAY, MONDAY, TUESDAY]
    const { result } = renderHook(() => useTimetable('academy', {}, dates, true))

    // Monday and Tuesday are shown while Sunday is still on its way.
    await waitFor(() => expect([...result.current.pending]).toEqual([SUNDAY]))
    expect(result.current.byDate.get(MONDAY)).toEqual([])
    expect(result.current.byDate.get(TUESDAY)).toEqual([])
    expect(result.current.byDate.has(SUNDAY)).toBe(false)

    slowSunday.resolve(jsonResponse(200, makeAcademySchedule([makeSlot()], SUNDAY)))
    await waitFor(() => expect(result.current.pending.size).toBe(0))
    expect(result.current.byDate.get(SUNDAY)!.map((entry) => entry.id)).toEqual([SLOT_ID])
    // The answers landing one by one never aborted or repeated a running request.
    expect(calls).toEqual([SUNDAY, MONDAY, TUESDAY].map((on, weekday) => `/api/schedule?on=${on}&weekday=${weekday}`))
  })

  it('aborts the requests new inputs no longer ask and keeps running the ones they still ask, so nothing is sent twice', async () => {
    const calls: string[] = []
    const answers = new Map<string, ReturnType<typeof deferred>>()
    const signals = new Map<string, AbortSignal | null | undefined>()
    mockFetch((raw, init) => {
      const on = new URL(raw, 'http://localhost').searchParams.get('on')!
      calls.push(on)
      signals.set(on, init?.signal)
      const answer = deferred()
      answers.set(on, answer)
      return answer.promise
    })
    const { result, rerender } = renderHook(({ dates }) => useTimetable('mine', {}, dates, true), { initialProps: { dates: [SUNDAY, MONDAY] } })
    await waitFor(() => expect(calls).toEqual([SUNDAY, MONDAY]))

    // Another set of dates that still shows Sunday (like the upcoming days when the week moves).
    rerender({ dates: [SUNDAY, TUESDAY] })
    await waitFor(() => expect(calls).toEqual([SUNDAY, MONDAY, TUESDAY]))
    expect(signals.get(MONDAY)?.aborted).toBe(true)
    expect(signals.get(SUNDAY)?.aborted).toBe(false)

    answers.get(SUNDAY)!.resolve(jsonResponse(200, makeMySchedule([makeMyItem()], SUNDAY)))
    answers.get(TUESDAY)!.resolve(jsonResponse(200, makeMySchedule([], TUESDAY)))
    await waitFor(() => expect(result.current.pending.size).toBe(0))
    expect(result.current.byDate.get(SUNDAY)).toHaveLength(1)
    expect(result.current.byDate.get(TUESDAY)).toEqual([])
    expect(calls).toEqual([SUNDAY, MONDAY, TUESDAY])
  })

  it('asks a failed date again once the inputs change — and only then, never in a loop', async () => {
    let failing = true
    const calls = record((url) =>
      failing && url.searchParams.get('on') === SUNDAY
        ? jsonResponse(503, { statusCode: 503, message: 'Service Unavailable' })
        : jsonResponse(200, makeMySchedule([makeMyItem()], url.searchParams.get('on')!)),
    )
    const { result, rerender } = renderHook(({ dates }) => useTimetable('mine', {}, dates, true), { initialProps: { dates: [SUNDAY] } })
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect((result.current.error as ApiError).status).toBe(503)
    // Same inputs: the failure stays, nothing is asked again.
    rerender({ dates: [SUNDAY] })
    expect(result.current.failed).toBe(true)
    expect(calls).toEqual([minePath(SUNDAY)])

    // New inputs that still show Sunday: the failure is forgotten in the same render and Sunday is asked again.
    failing = false
    rerender({ dates: [SUNDAY, MONDAY] })
    expect(result.current.failed).toBe(false)
    expect(result.current.pending.has(SUNDAY)).toBe(true)
    await waitFor(() => expect(result.current.pending.size).toBe(0))
    expect(result.current.byDate.get(SUNDAY)).toHaveLength(1)
    expect(calls).toEqual([minePath(SUNDAY), minePath(SUNDAY), minePath(MONDAY)])
  })
})
