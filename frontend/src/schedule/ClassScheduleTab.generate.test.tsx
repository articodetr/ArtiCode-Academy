// «Generate lessons» in the weekly schedule tab (J-F16 on API-092). In its own
// file so J-F07's ClassScheduleTab.test.tsx stays untouched. The fetch is a fake:
// these tests prove the screen against the contract, not the integration.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AcademyClass } from '../api/classes'
import type { ClassSchedule } from '../api/schedule'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { CLASS_ID, makeClass } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { LESSON_ID, OTHER_CLASS_ID, ROOM_IDS, SCHEDULE_ADMIN_PERMISSIONS, SCHEDULE_READER_PERMISSIONS, makeGeneratedLessons, makeRoom, makeSchedule } from '../test/schedule'
import { normalizeSpaces } from '../test/text'
import { formatDay } from '../users/users.format'
import { ClassScheduleTab } from './ClassScheduleTab'

const g = ar.classSchedule.generate

/** Class dates far ahead, so the default range never depends on the day the tests run: the class's start → its end. */
const FUTURE_CLASS = { startsOn: '2099-01-04', endsOn: '2099-02-28' } as const

type Answer = () => Response | Promise<Response>

/** GET /api/academy, /api/rooms, the class schedule and POST …/generate (successive answers; the last repeats); anything else is a 500. */
function mockGenerationApi({ schedule = makeSchedule(), answers = [() => jsonResponse(200, makeGeneratedLessons())] }: { schedule?: ClassSchedule; answers?: Answer[] } = {}) {
  const posts: unknown[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (parsed.pathname === '/api/rooms') return jsonResponse(200, { items: [makeRoom()] })
    if (parsed.pathname === `/api/classes/${CLASS_ID}/schedule` && method === 'GET') return jsonResponse(200, schedule)
    if (parsed.pathname === `/api/classes/${CLASS_ID}/schedule/generate` && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)))
      return answers[Math.min(posts.length, answers.length) - 1]!()
    }
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return { posts }
}

function renderTab(permissions: string[], cls: AcademyClass = makeClass(FUTURE_CLASS)) {
  return renderWithProviders(<ClassScheduleTab cls={cls} />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/classes' })
}

const button = (text: string) => screen.getByText(text).closest('button') as HTMLButtonElement
const openPanel = async () => {
  fireEvent.click((await screen.findByText(g.open)).closest('button')!)
  return screen.findByTestId('generate-lessons')
}
const setDate = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
/**
 * Before clicking «توليد» again after an answer: antd's Button keeps its own
 * loading state and clears it in an effect after the render, ignoring clicks
 * until then — a click in that gap sends nothing (seen as a flaky test).
 */
const submitReady = () => waitFor(() => expect(button(g.submit)).not.toHaveClass('ant-btn-loading'))
/** The value cell of a row of the result table, by its label. */
const countOf = (result: HTMLElement, label: string) => within(result).getByText(label).closest('tr')?.querySelector('td')?.textContent
const refusal = (status: number, body: Record<string, unknown>): Answer => () => jsonResponse(status, { statusCode: status, message: 'refused', ...body })

describe('ClassScheduleTab — generate lessons (J-F16)', () => {
  it('offers «توليد الدروس» only to a schedule manager of a planned, open or running class that has slots', async () => {
    mockGenerationApi()
    const reader = renderTab(SCHEDULE_READER_PERMISSIONS)
    await screen.findByText('10:00–11:00')
    expect(screen.queryByText(g.open)).not.toBeInTheDocument()
    reader.unmount()

    const frozen = renderTab(SCHEDULE_ADMIN_PERMISSIONS, makeClass({ ...FUTURE_CLASS, status: 'completed' }))
    await screen.findByText('10:00–11:00')
    expect(screen.getByText(ar.classSchedule.frozen)).toBeInTheDocument()
    expect(screen.queryByText(g.open)).not.toBeInTheDocument()
    frozen.unmount()

    mockGenerationApi({ schedule: makeSchedule([]) })
    const empty = renderTab(SCHEDULE_ADMIN_PERMISSIONS)
    await screen.findByText(ar.classSchedule.empty)
    expect(screen.queryByText(g.open)).not.toBeInTheDocument()
    expect(button(ar.classSchedule.edit)).toBeEnabled()
    empty.unmount()

    mockGenerationApi()
    renderTab(SCHEDULE_ADMIN_PERMISSIONS, makeClass({ ...FUTURE_CLASS, status: 'running' }))
    expect(await screen.findByText(g.open)).toBeInTheDocument()
  })

  it('starts from the class dates, refuses locally what the server would refuse, then sends ONE POST and shows the counts it answered', async () => {
    const api = mockGenerationApi({
      answers: [() => jsonResponse(200, makeGeneratedLessons({ from: '2099-01-04', to: '2099-02-28', slots: 2, occurrences: 16, created: 13, existing: 2, offDays: 1 }))],
    })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)
    const panel = await openPanel()

    expect(within(panel).getByLabelText(g.from)).toHaveValue('2099-01-04')
    expect(within(panel).getByLabelText(g.to)).toHaveValue('2099-02-28')
    expect(within(panel).getByText('عدد الأيام: 56 (الحد 184)')).toBeInTheDocument()
    // One action at a time: the header offers nothing else while the panel is open.
    expect(screen.queryByText(ar.classSchedule.edit)).not.toBeInTheDocument()
    expect(screen.queryByText(g.open)).not.toBeInTheDocument()

    setDate(g.to, '2099-01-03')
    expect(within(panel).getByText(g.validation.to_not_before_from)).toBeInTheDocument()
    expect(button(g.submit)).toBeDisabled()
    // 2099-01-04 … 2099-07-07 is 185 days.
    setDate(g.to, '2099-07-07')
    expect(within(panel).getByText('لا يزيد المدى على 184 يوماً')).toBeInTheDocument()
    expect(button(g.submit)).toBeDisabled()
    setDate(g.from, '')
    expect(within(panel).getByText(g.validation.from_required)).toBeInTheDocument()
    fireEvent.click(button(g.submit))
    expect(api.posts).toEqual([])

    setDate(g.from, '2099-01-04')
    setDate(g.to, '2099-02-28')
    fireEvent.click(button(g.submit))

    await waitFor(() => expect(api.posts).toEqual([{ from: '2099-01-04', to: '2099-02-28' }]))
    const result = await screen.findByTestId('generation-result')
    expect(within(result).getByText(normalizeSpaces(`نتيجة التوليد: من ${formatDay('2099-01-04', 'ar')} إلى ${formatDay('2099-02-28', 'ar')}`))).toBeInTheDocument()
    expect(countOf(result, g.result.slots)).toBe('2')
    expect(countOf(result, g.result.occurrences)).toBe('16')
    expect(countOf(result, g.result.created)).toBe('13')
    expect(countOf(result, g.result.existing)).toBe('2')
    expect(countOf(result, g.result.offDays)).toBe('1')
    expect(await screen.findByText('أُنشئ من الدروس: 13')).toBeInTheDocument()
    expect(api.posts).toHaveLength(1)
  })

  it('shows the zeros of a repeated run as the server answered them, with the reason', async () => {
    const api = mockGenerationApi({
      answers: [() => jsonResponse(200, makeGeneratedLessons()), () => jsonResponse(200, makeGeneratedLessons({ created: 0, existing: 13 }))],
    })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)
    await openPanel()

    fireEvent.click(button(g.submit))
    await screen.findByText('أُنشئ من الدروس: 13')
    await submitReady()
    fireEvent.click(button(g.submit))

    await waitFor(() => expect(api.posts).toHaveLength(2))
    expect(await screen.findByText(g.nothingCreated)).toBeInTheDocument()
    const result = await screen.findByTestId('generation-result')
    await waitFor(() => expect(countOf(result, g.result.created)).toBe('0'))
    expect(countOf(result, g.result.existing)).toBe('13')
    expect(within(result).getByText(g.allSkipped)).toBeInTheDocument()
    expect(api.posts[1]).toEqual(api.posts[0])
  })

  it('names the conflicting lesson of a lesson_conflict, writes nothing, and offers the editor without losing the range', async () => {
    const api = mockGenerationApi({ answers: [refusal(409, { code: 'lesson_conflict', resource: 'teacher', conflictingLessonId: LESSON_ID, conflictingClassId: OTHER_CLASS_ID })] })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)
    await openPanel()
    setDate(g.to, '2099-01-31')
    fireEvent.click(button(g.submit))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('المعلم محجوز بدرس في فصل آخر في وقت متداخل؛ عدّل ذلك الدرس أو الحصة ثم أعد التوليد.')).toBeInTheDocument()
    expect(within(screen.getByTestId('conflicting-lesson')).getByText(LESSON_ID)).toBeInTheDocument()
    expect(within(alert).getByText(g.refused)).toBeInTheDocument()
    expect(screen.queryByTestId('generation-result')).not.toBeInTheDocument()

    fireEvent.click(within(alert).getByText(g.editSchedule).closest('button')!)
    expect(await screen.findByTestId('schedule-editor')).toBeInTheDocument()
    fireEvent.click(button(ar.common.cancel))

    // Back from the editor: the panel again, with the range typed before and no stale alert.
    const panel = await screen.findByTestId('generate-lessons')
    expect(within(panel).getByLabelText(g.to)).toHaveValue('2099-01-31')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.posts).toEqual([{ from: '2099-01-04', to: '2099-01-31' }])
  })

  it('names the inactive room, the frozen class and the missing permission; a new range clears the alert', async () => {
    const api = mockGenerationApi({
      answers: [
        refusal(422, { code: 'room_inactive', roomId: ROOM_IDS[0] }),
        refusal(409, { code: 'class_not_schedulable', status: 'cancelled' }),
        refusal(403, { code: 'permission_denied', missing: ['schedule.manage'] }),
      ],
    })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)
    await openPanel()

    fireEvent.click(button(g.submit))
    let alert = await screen.findByRole('alert')
    expect(within(alert).getByText('القاعة «LAB-1 — مختبر 1» موقوفة؛ عدّل الحصة التي تستخدمها أو فعّل القاعة ثم أعد التوليد.')).toBeInTheDocument()
    expect(within(alert).getByText(g.editSchedule)).toBeInTheDocument()
    setDate(g.to, '2099-02-27')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await submitReady()
    fireEvent.click(button(g.submit))
    alert = await screen.findByRole('alert')
    expect(within(alert).getByText(`لا تُولَّد دروس لفصل مكتمل أو ملغى (الحالة: ${ar.labels.cancelled}).`)).toBeInTheDocument()
    // The fix is not in a slot: no editor shortcut.
    expect(within(alert).queryByText(g.editSchedule)).not.toBeInTheDocument()

    await submitReady()
    fireEvent.click(button(g.submit))
    await waitFor(() => expect(api.posts).toHaveLength(3))
    expect(await screen.findByText('ليست لديك الصلاحية اللازمة لهذا الإجراء (schedule.manage)')).toBeInTheDocument()
    expect(screen.getByText(g.refused)).toBeInTheDocument()
  })

  it('sends one request at a time, keeps the panel open meanwhile, and says a retry is safe when the answer is lost', async () => {
    let release: (response: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const api = mockGenerationApi({ answers: [() => pending, () => Promise.reject(new TypeError('Failed to fetch'))] })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)
    await openPanel()

    fireEvent.click(button(g.submit))
    fireEvent.click(button(g.submit))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(button(g.close)).toBeDisabled()
    expect(screen.getByLabelText(g.from)).toBeDisabled()

    release(jsonResponse(200, makeGeneratedLessons()))
    await screen.findByTestId('generation-result')
    expect(api.posts).toHaveLength(1)
    expect(button(g.close)).toBeEnabled()

    await submitReady()
    fireEvent.click(button(g.submit))
    expect(await screen.findByText(ar.login.errors.network)).toBeInTheDocument()
    expect(screen.getByText(g.retrySafe)).toBeInTheDocument()
    expect(api.posts).toHaveLength(2)

    fireEvent.click(button(g.close))
    expect(screen.queryByTestId('generate-lessons')).not.toBeInTheDocument()
    expect(await screen.findByText(g.open)).toBeInTheDocument()
  })
})
