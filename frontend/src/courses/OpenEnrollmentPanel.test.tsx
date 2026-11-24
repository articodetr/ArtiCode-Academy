import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AcademyClass } from '../api/classes'
import type { Course } from '../api/courses'
import { ar } from '../i18n/ar'
import { todayIn } from '../lessons/lessons.format'
import { makeAcademy } from '../test/academy'
import { CLASS_ADMIN_PERMISSIONS, makeClass, makeClassList } from '../test/classes'
import { COURSE_ID, makeCourse } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { GENERAL_CLASS_NAME, GENERAL_CLASS_NOTE, generalClassCodes } from './courses.openEnrollment'
import { OpenEnrollmentPanel } from './OpenEnrollmentPanel'

const text = ar.courseEnrollmentPanel
const ACADEMY_ZONE = 'Asia/Riyadh'

interface Call {
  method: string
  url: string
  body: unknown
}

interface ServerOptions {
  /** Codes held by classes of other courses: POST answers `409 class_code_taken`. */
  takenCodes?: string[]
  /** How many `open` status actions fail with a 500 before they succeed. */
  failOpens?: number
  /** GET /api/academy answers 500. */
  academyFails?: boolean
}

/** A small in-memory API-035/050/052/053/054: reads always return what the writes left. */
function mockClassesServer(initial: AcademyClass[], options: ServerOptions = {}) {
  const state = { classes: [...initial], failOpens: options.failOpens ?? 0 }
  const writes: Call[] = []
  const fetchMock = mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    if (url === '/api/academy') {
      return options.academyFails ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makeAcademy({ timezone: ACADEMY_ZONE }))
    }
    if (method === 'GET') return jsonResponse(200, makeClassList(state.classes))
    writes.push({ method, url, body })
    if (method === 'POST' && url === '/api/classes') {
      const code = String(body?.code)
      if (options.takenCodes?.includes(code) || state.classes.some((klass) => klass.code === code)) {
        return jsonResponse(409, { statusCode: 409, code: 'class_code_taken', classCode: code, message: 'taken' })
      }
      const created = makeClass({
        id: `created-${state.classes.length}`,
        code,
        name: body?.name as AcademyClass['name'],
        capacity: Number(body?.capacity),
        selfEnrollment: body?.selfEnrollment === true,
        status: 'planned',
        startsOn: (body?.startsOn as string | undefined) ?? null,
        endsOn: null,
        notes: (body?.notes as string | undefined) ?? null,
        teachers: [],
      })
      state.classes = [...state.classes, created]
      return jsonResponse(201, created)
    }
    const id = url.split('/')[3]!
    const target = state.classes.find((klass) => klass.id === id)
    if (!target) return jsonResponse(404, { statusCode: 404, code: 'class_not_found', message: 'no' })
    if (method === 'POST') {
      if (state.failOpens > 0) {
        state.failOpens -= 1
        return jsonResponse(500, { statusCode: 500, message: 'boom' })
      }
      const opened = { ...target, status: 'open' as const }
      state.classes = state.classes.map((klass) => (klass.id === id ? opened : klass))
      return jsonResponse(200, opened)
    }
    const patched = { ...target, ...body }
    state.classes = state.classes.map((klass) => (klass.id === id ? patched : klass))
    return jsonResponse(200, patched)
  })
  return { state, writes, fetchMock }
}

function renderPanel(course: Course, permissions: string[] = CLASS_ADMIN_PERMISSIONS) {
  return renderWithProviders(<OpenEnrollmentPanel course={course} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/courses',
  })
}

const published = (overrides: Partial<Course> = {}) => makeCourse({ status: 'published', ...overrides })
const general = (overrides: Partial<AcademyClass> = {}) =>
  makeClass({ id: 'general', code: 'PY-101-GEN', name: { ...GENERAL_CLASS_NAME }, notes: GENERAL_CLASS_NOTE, ...overrides })

const panelOf = () => screen.getByTestId('open-enrollment-panel')
const openButton = async () => (await within(await screen.findByTestId('open-enrollment-panel')).findByText(text.actions.open)).closest('button') as HTMLButtonElement

async function capacityDialog() {
  return (await screen.findByText(text.create.intro)).closest('[role="dialog"]') as HTMLElement
}

async function confirmCapacity() {
  const dialog = await capacityDialog()
  fireEvent.click(within(dialog).getByText(text.actions.open).closest('button')!)
}

describe('OpenEnrollmentPanel', () => {
  it('renders nothing and reads nothing without classes.manage and classes.read', () => {
    const { fetchMock } = mockClassesServer([])
    const first = renderPanel(published(), ['classes.read', 'courses.manage'])
    expect(screen.queryByText(text.title)).not.toBeInTheDocument()
    first.unmount()
    renderPanel(published(), ['classes.manage', 'courses.manage'])
    expect(screen.queryByText(text.title)).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tells the admin to publish a course that is not published, with the button disabled', async () => {
    mockClassesServer([])
    renderPanel(makeCourse({ status: 'draft' }))
    expect(await screen.findByText(text.unpublished)).toBeInTheDocument()
    expect(await openButton()).toBeDisabled()
  })

  it('tells the admin when a new general class would sit beside a class of theirs, and leaves that class alone', async () => {
    const own = makeClass({ id: 'own', code: 'PY-OWN', capacity: 15, status: 'open', selfEnrollment: false, notes: null })
    const { writes } = mockClassesServer([own])
    renderPanel(published())

    fireEvent.click(await openButton())
    const note = text.create.otherClasses.replace('{{option}}', ar.classes.fields.selfEnrollment)
    expect(await screen.findByText(note)).toBeInTheDocument()
    await confirmCapacity()

    await screen.findByText(text.openState)
    expect(writes.some((write) => write.url.includes('/own'))).toBe(false)
  })

  it('does not mention other classes when the course has none', async () => {
    mockClassesServer([])
    renderPanel(published())
    fireEvent.click(await openButton())
    await screen.findByText(text.create.capacityHint)
    expect(screen.queryByText(/فصول أخرى/)).not.toBeInTheDocument()
  })

  it('creates the general class with its marker and the academy’s today, opens it and shows the server’s answer', async () => {
    const { writes } = mockClassesServer([])
    renderPanel(published())

    fireEvent.click(await openButton())
    expect(await screen.findByText(text.create.capacityHint)).toBeInTheDocument()
    expect(screen.getByText(text.create.startsOnHint)).toBeInTheDocument()
    expect(writes).toEqual([])
    await confirmCapacity()

    expect(await screen.findByText(text.openState)).toBeInTheDocument()
    expect(screen.getByText('PY-101-GEN')).toBeInTheDocument()
    expect(screen.getByText('0 / 1000')).toBeInTheDocument()
    expect(writes).toEqual([
      {
        method: 'POST',
        url: '/api/classes',
        body: {
          courseId: COURSE_ID,
          code: 'PY-101-GEN',
          name: GENERAL_CLASS_NAME,
          capacity: 1000,
          startsOn: todayIn(ACADEMY_ZONE),
          notes: GENERAL_CLASS_NOTE,
          selfEnrollment: true,
        },
      },
      { method: 'POST', url: '/api/classes/created-0/status', body: { action: 'open' } },
    ])
  })

  it('sends the start date the admin typed', async () => {
    const { writes } = mockClassesServer([])
    renderPanel(published())

    fireEvent.click(await openButton())
    const dialog = await capacityDialog()
    fireEvent.change(within(dialog).getByLabelText(text.create.startsOn), { target: { value: '2026-12-01' } })
    await confirmCapacity()

    expect(await screen.findByText(text.openState)).toBeInTheDocument()
    expect((writes[0]!.body as { startsOn: string }).startsOn).toBe('2026-12-01')
  })

  it('falls back to this device’s day when the academy cannot be read', async () => {
    const { writes } = mockClassesServer([], { academyFails: true })
    renderPanel(published())

    fireEvent.click(await openButton())
    await confirmCapacity()

    expect(await screen.findByText(text.openState)).toBeInTheDocument()
    expect((writes[0]!.body as { startsOn: string }).startsOn).toBe(todayIn(deviceTimeZone()))
  })

  it('refuses an invalid start date and sends nothing', async () => {
    const { writes } = mockClassesServer([])
    renderPanel(published())

    fireEvent.click(await openButton())
    const dialog = await capacityDialog()
    // A date input holds '' for a day that does not exist.
    fireEvent.change(within(dialog).getByLabelText(text.create.startsOn), { target: { value: '2026-02-30' } })
    fireEvent.click(within(dialog).getByText(text.actions.open).closest('button')!)

    expect(await within(dialog).findByText(text.create.startsOnInvalid)).toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('moves to the next code when the server answers class_code_taken', async () => {
    const { writes } = mockClassesServer([], { takenCodes: ['PY-101-GEN', 'PY-101-GEN2'] })
    renderPanel(published())

    fireEvent.click(await openButton())
    await confirmCapacity()

    expect(await screen.findByText('PY-101-GEN3')).toBeInTheDocument()
    expect(writes.filter((call) => call.url === '/api/classes').map((call) => (call.body as { code: string }).code)).toEqual(['PY-101-GEN', 'PY-101-GEN2', 'PY-101-GEN3'])
  })

  it('says so when every general code is taken, and opens nothing', async () => {
    const codes = generalClassCodes('PY-101')
    const { writes, state } = mockClassesServer([], { takenCodes: codes })
    renderPanel(published())

    fireEvent.click(await openButton())
    await confirmCapacity()

    expect(await screen.findByText(text.errors.codesExhausted)).toBeInTheDocument()
    expect(writes.map((call) => (call.body as { code: string }).code)).toEqual(codes)
    expect(state.classes).toEqual([])
    expect(within(panelOf()).getByText(text.closedState)).toBeInTheDocument()
  })

  it('resumes after a failed open instead of creating a second class, keeping the class’s own date', async () => {
    const { writes, state } = mockClassesServer([], { failOpens: 1 })
    renderPanel(published())

    fireEvent.click(await openButton())
    const dialog = await capacityDialog()
    fireEvent.change(within(dialog).getByLabelText(text.create.startsOn), { target: { value: '2026-12-01' } })
    await confirmCapacity()
    expect(await screen.findByText(ar.login.errors.server)).toBeInTheDocument()
    await waitFor(() => expect(state.classes[0]?.status).toBe('planned'))

    // The closed dialog stays in the DOM in jsdom: read the button inside the panel, once its loading state is gone.
    const panel = panelOf()
    await waitFor(() => expect(within(panel).getByText(text.actions.open).closest('button')).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(within(panel).getByText(text.actions.open).closest('button')!)

    expect(await screen.findByText(text.openState)).toBeInTheDocument()
    expect(state.classes).toHaveLength(1)
    expect(state.classes[0]?.startsOn).toBe('2026-12-01')
    expect(writes.filter((call) => call.url === '/api/classes')).toHaveLength(1)
    expect(writes.filter((call) => call.url.endsWith('/status'))).toHaveLength(2)
    expect(writes.some((call) => call.method === 'PATCH')).toBe(false)
  })

  it('turns our open general class back on without a dialog', async () => {
    const { writes } = mockClassesServer([general({ status: 'open' })])
    renderPanel(published())

    fireEvent.click(await openButton())

    expect(await screen.findByText(text.openState)).toBeInTheDocument()
    expect(writes).toEqual([{ method: 'PATCH', url: '/api/classes/general', body: { selfEnrollment: true } }])
  })

  it('still treats a renamed general class as ours: no -GEN2', async () => {
    const { writes, state } = mockClassesServer([general({ code: 'RENAMED-1', name: { ar: 'فصل الخريف' }, status: 'open' })])
    renderPanel(published())

    fireEvent.click(await openButton())

    expect(await screen.findByText(text.openState)).toBeInTheDocument()
    expect(writes).toEqual([{ method: 'PATCH', url: '/api/classes/general', body: { selfEnrollment: true } }])
    expect(state.classes).toHaveLength(1)
    expect(screen.queryByText(text.privateClass)).not.toBeInTheDocument()
  })

  it('sends one write for a double click', async () => {
    const { writes } = mockClassesServer([general({ status: 'open' })])
    renderPanel(published())

    const button = await openButton()
    fireEvent.click(button)
    fireEvent.click(button)

    expect(await screen.findByText(text.openState)).toBeInTheDocument()
    expect(writes).toHaveLength(1)
  })

  it('never touches an admin’s class coded X-GEN and named «الفصل العام»: it creates the general class beside it', async () => {
    const cohort = makeClass({ id: 'cohort', code: 'PY-101-GEN', name: { ...GENERAL_CLASS_NAME }, status: 'open' })
    const { writes, state } = mockClassesServer([cohort])
    renderPanel(published())

    fireEvent.click(await openButton())
    await confirmCapacity()

    expect(await screen.findByText('PY-101-GEN2')).toBeInTheDocument()
    expect(writes.some((call) => call.url.includes('/cohort'))).toBe(false)
    expect(state.classes.find((klass) => klass.id === 'cohort')).toEqual(cohort)
  })

  it('stops the general class behind a confirmation when nothing else is open', async () => {
    const ours = general({ status: 'open', selfEnrollment: true, enrolledCount: 3, capacity: 50 })
    const cohort = makeClass({ id: 'cohort', code: 'PY-101-A', status: 'open' })
    const { writes } = mockClassesServer([cohort, ours])
    renderPanel(published())

    expect(await screen.findByText('3 / 50')).toBeInTheDocument()
    fireEvent.click(screen.getByText(text.actions.stop).closest('button')!)
    const dialog = (await screen.findByText(text.stop.content)).closest('[role="dialog"]') as HTMLElement
    expect(writes).toEqual([])
    fireEvent.click(within(dialog).getByText(text.actions.stop).closest('button')!)

    expect(await screen.findByText(text.closedState)).toBeInTheDocument()
    expect(await screen.findByText(text.done.stopped)).toBeInTheDocument()
    expect(writes).toEqual([{ method: 'PATCH', url: '/api/classes/general', body: { selfEnrollment: false } }])
  })

  it('stop includes a planned general class, leaves an admin’s self-service class alone and says subscription stays open', async () => {
    const ours = general({ status: 'open', selfEnrollment: true })
    const planned = general({ id: 'planned', code: 'PY-101-GEN2', status: 'planned', selfEnrollment: true })
    const theirs = makeClass({ id: 'theirs', code: 'PY-101-B', status: 'running', selfEnrollment: true })
    const { writes, state } = mockClassesServer([ours, planned, theirs])
    renderPanel(published())

    await within(await screen.findByTestId('open-enrollment-panel')).findByText(text.privateClass)
    expect(within(panelOf()).getAllByText(text.privateClass)).toHaveLength(1)
    expect(within(panelOf()).getByText(text.privateHint)).toBeInTheDocument()

    fireEvent.click(within(panelOf()).getByText(text.actions.stop).closest('button')!)
    const dialog = (await screen.findByText(text.stop.contentPartial)).closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(text.stop.titlePartial)).toBeInTheDocument()
    expect(within(dialog).queryByText(text.stop.content)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByText(text.actions.stop).closest('button')!)

    expect(await screen.findByText(text.done.stoppedPartial)).toBeInTheDocument()
    expect(writes).toEqual([
      { method: 'PATCH', url: '/api/classes/general', body: { selfEnrollment: false } },
      { method: 'PATCH', url: '/api/classes/planned', body: { selfEnrollment: false } },
    ])
    expect(state.classes.find((klass) => klass.id === 'theirs')).toEqual(theirs)
    // Subscription is still open through the admin's class, and nothing is left for the button to stop.
    await waitFor(() => expect(within(panelOf()).queryByText(text.actions.stop)).not.toBeInTheDocument())
    expect(within(panelOf()).getByText(text.openState)).toBeInTheDocument()
  })

  it('offers no stop when only an admin’s own class keeps subscription open', async () => {
    mockClassesServer([makeClass({ id: 'theirs', code: 'PY-101-B', status: 'open', selfEnrollment: true })])
    renderPanel(published())

    expect(await screen.findByText(text.openState)).toBeInTheDocument()
    expect(within(panelOf()).getByText(text.privateClass)).toBeInTheDocument()
    expect(within(panelOf()).getByText(text.privateHint)).toBeInTheDocument()
    expect(within(panelOf()).queryByText(text.actions.stop)).not.toBeInTheDocument()
  })

  it('warns about a paid course whose fee plan is deactivated, and still lets it open', async () => {
    mockClassesServer([])
    renderPanel(
      published({
        pricing: 'paid',
        enrollmentFeePlan: { id: 'plan-1', name: { ar: 'رسوم' }, isActive: false, total: 100, currency: 'USD', installments: 1 },
      }),
    )
    expect(await screen.findByText(text.priceWarning)).toBeInTheDocument()
    expect(await openButton()).toBeEnabled()
  })

  it('offers a retry when the classes cannot be read', async () => {
    let fail = true
    mockFetch(() => (fail ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makeClassList([]))))
    renderPanel(published())

    const retry = await screen.findByText(text.retry)
    expect(screen.queryByText(text.actions.open)).not.toBeInTheDocument()
    fail = false
    fireEvent.click(retry.closest('button')!)
    expect(await screen.findByText(text.closedState)).toBeInTheDocument()
  })
})
