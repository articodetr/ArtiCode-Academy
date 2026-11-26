// The course drawer's class tabs: the teachers, the students and the other tabs
// of the class drawer move into the course drawer and work on the course's class
// (the general class of «فتح الاشتراك», else another live or planned one), and a
// published course without one is prepared from here (courseClasses.ts).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AcademyClass } from '../api/classes'
import type { Course } from '../api/courses'
import { ar } from '../i18n/ar'
import { todayIn } from '../lessons/lessons.format'
import { makeAcademy } from '../test/academy'
import { makeClass, makeClassList, makeClassTeacher, makeTeacherCandidate, TEACHER_IDS } from '../test/classes'
import { COURSE_ID, makeCourse } from '../test/courses'
import { makeCurriculum } from '../test/curriculum'
import { clickWhenSettled, waitForDrawersToSettle } from '../test/drawer'
import { makeEnrollment, makeEnrollmentList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeSubject } from '../test/subjects'
import { makeUserList } from '../test/users'
import { CourseDrawer } from './CourseDrawer'
import { GENERAL_CLASS_NAME, GENERAL_CLASS_NOTE } from './courses.openEnrollment'

const text = ar.courseClass

/** An academy admin as far as these tabs are concerned (the seed gives the admin every key). */
const ADMIN_PERMISSIONS = ['courses.read', 'courses.manage', 'classes.read', 'classes.manage', 'classes.teachers.assign', 'users.read', 'enrollments.read', 'enrollments.manage']

const mona = makeTeacherCandidate()
const general = (overrides: Partial<AcademyClass> = {}) =>
  makeClass({ id: 'general', code: 'PY-101-GEN', name: { ...GENERAL_CLASS_NAME }, notes: GENERAL_CLASS_NOTE, status: 'open', ...overrides })

interface Call {
  method: string
  url: string
  body: unknown
}

interface ServerOptions {
  course?: Course
  classes?: AcademyClass[]
  /** How many reads of the course's classes (API-050) answer 500 first. */
  failClassReads?: number
}

/** The course, its curriculum, the academy, the course's classes (in memory), a roster, the teacher search; class writes as API-052/054. */
function mockDrawerServer(options: ServerOptions = {}) {
  const course = options.course ?? makeCourse({ status: 'published' })
  const state = { classes: [...(options.classes ?? [])], failReads: options.failClassReads ?? 0, classReads: 0 }
  const writes: Call[] = []
  const urls: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname } = new URL(url, 'http://localhost')
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    if (method === 'GET') {
      urls.push(url)
      if (pathname === `/api/courses/${COURSE_ID}`) return jsonResponse(200, course)
      if (pathname.endsWith('/curriculum')) return jsonResponse(200, makeCurriculum())
      if (pathname === '/api/academy') return jsonResponse(200, makeAcademy({ timezone: 'Asia/Riyadh' }))
      if (pathname === '/api/classes') {
        state.classReads += 1
        if (state.failReads > 0) {
          state.failReads -= 1
          return jsonResponse(500, { statusCode: 500, message: 'boom' })
        }
        return jsonResponse(200, makeClassList(state.classes))
      }
      if (pathname.endsWith('/enrollments')) return jsonResponse(200, makeEnrollmentList([makeEnrollment({ classId: pathname.split('/')[3]! })]))
      if (pathname === '/api/users') return jsonResponse(200, makeUserList([mona]))
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    }
    writes.push({ method, url, body })
    if (method === 'POST' && pathname === '/api/classes') {
      const created = makeClass({
        id: 'created',
        code: String(body?.code),
        name: body?.name as AcademyClass['name'],
        capacity: Number(body?.capacity),
        status: 'planned',
        startsOn: (body?.startsOn as string | undefined) ?? null,
        endsOn: null,
        notes: (body?.notes as string | undefined) ?? null,
        selfEnrollment: body?.selfEnrollment === true,
        teachers: [],
      })
      state.classes = [...state.classes, created]
      return jsonResponse(201, created)
    }
    if (method === 'POST' && pathname.endsWith('/status')) {
      const id = pathname.split('/')[3]!
      const opened = { ...state.classes.find((klass) => klass.id === id)!, status: 'open' as const }
      state.classes = state.classes.map((klass) => (klass.id === id ? opened : klass))
      return jsonResponse(200, opened)
    }
    if (method === 'PATCH') {
      const id = pathname.split('/')[3]!
      const patched = { ...state.classes.find((klass) => klass.id === id)!, ...body }
      state.classes = state.classes.map((klass) => (klass.id === id ? patched : klass))
      return jsonResponse(200, patched)
    }
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return { state, writes, urls }
}

function renderDrawer(permissions: string[] = ADMIN_PERMISSIONS) {
  const onClose = vi.fn()
  renderWithProviders(<CourseDrawer courseId={COURSE_ID} subjects={[makeSubject()]} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/courses',
  })
  return { onClose }
}

/**
 * The drawer is open on the details tab, and settled: until its opening motion ends a re-render does not
 * reach its panel, so a tab clicked meanwhile would show late (KI-060).
 */
async function ready() {
  await screen.findByRole('tab', { name: ar.courses.drawer.tabs.details })
  await waitForDrawersToSettle()
}
const tabNamed = (name: string) => screen.queryByRole('tab', { name })
async function openTab(name: string) {
  const tab = screen.getByRole('tab', { name })
  fireEvent.click(tab)
  await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'))
}
/** A select option by a part of its text (its label spans several nodes: the name, the code, the status). */
const optionWith = (part: string) =>
  waitFor(() => {
    const found = [...document.querySelectorAll('.ant-select-item-option')].find((option) => option.textContent?.includes(part))
    if (!found) throw new Error(`no option with ${part}`)
    return found
  })
/**
 * The pane of the selected tab, found through the tab's aria-controls: the tab nav updates at once, while a
 * pane's own attributes can lag for a frame or two behind rc-motion (KI-060).
 */
const activePane = () =>
  waitFor(() => {
    const selected = document.querySelector('.ant-drawer [role="tab"][aria-selected="true"]')
    const pane = selected ? document.getElementById(selected.getAttribute('aria-controls') ?? '') : null
    if (!pane) throw new Error('no shown tab pane')
    return pane
  })

describe('CourseDrawer — the class tabs', () => {
  it('shows an admin the class tabs after «المنهج» and reads no class before one of them opens', async () => {
    const { state } = mockDrawerServer({ classes: [general()] })
    renderDrawer(['courses.read', 'classes.read', 'enrollments.read', 'grades.read_all', 'certificates.read_all'])
    await ready()

    const labels = [...document.querySelectorAll('.ant-tabs-nav .ant-tabs-tab')].map((tab) => tab.textContent)
    expect(labels).toEqual([ar.courses.drawer.tabs.details, ar.curriculum.tab, text.tabs.teachers, text.tabs.students, ar.classSchedule.tab, ar.learningProgress.tab, ar.gradebook.tab, ar.certificates.classTab.tab])
    // The «فتح الاشتراك» panel needs classes.manage: nobody read the classes yet.
    expect(state.classReads).toBe(0)
  })

  it('shows no class tab and reads no class without classes.read', async () => {
    const { urls } = mockDrawerServer({ classes: [general()] })
    renderDrawer(['courses.read', 'courses.manage', 'enrollments.read', 'enrollments.manage', 'grades.read_all'])
    await ready()
    expect(tabNamed(text.tabs.teachers)).toBeNull()
    expect(tabNamed(text.tabs.students)).toBeNull()
    expect(urls.some((url) => url.startsWith('/api/classes'))).toBe(false)
  })

  it('mounts the teachers and the roster of the course’s general class', async () => {
    const { urls } = mockDrawerServer({ classes: [general()] })
    renderDrawer()
    await ready()

    await openTab(text.tabs.teachers)
    expect(await within(await activePane()).findByText('خالد المعلم')).toBeInTheDocument()
    expect(urls).toContain(`/api/classes?courseId=${COURSE_ID}&sort=code&limit=100`)
    expect(screen.queryByTestId('course-class-selector')).not.toBeInTheDocument()

    await openTab(text.tabs.students)
    expect(await within(await activePane()).findByText('عمر خالد')).toBeInTheDocument()
    expect(urls.some((url) => url.startsWith('/api/classes/general/enrollments'))).toBe(true)
  })

  it('lets the admin switch between several classes of a legacy course, the general one first', async () => {
    const own = makeClass({ id: 'own', code: 'PY-101-A', status: 'open', teachers: [makeClassTeacher({ userId: TEACHER_IDS[1], fullName: 'منى المساعدة' })] })
    mockDrawerServer({ classes: [own, general()] })
    renderDrawer()
    await ready()

    await openTab(text.tabs.teachers)
    const pane = await activePane()
    expect(await within(pane).findByText('خالد المعلم')).toBeInTheDocument()
    const selector = within(pane).getByTestId('course-class-selector')
    expect(within(selector).getByText(text.selector.label)).toBeInTheDocument()

    fireEvent.mouseDown(within(selector).getByRole('combobox'))
    fireEvent.click(await optionWith('PY-101-A'))
    expect(await within(pane).findByText('منى المساعدة')).toBeInTheDocument()
    expect(within(pane).queryByText('خالد المعلم')).not.toBeInTheDocument()
  })

  it('reads the classes again when a class tab opens after the details tab', async () => {
    const { state } = mockDrawerServer({ classes: [general()] })
    renderDrawer()
    await ready()
    // The «فتح الاشتراك» panel of the details tab reads them once by itself.
    await waitFor(() => expect(state.classReads).toBe(1))

    await openTab(text.tabs.teachers)
    await within(await activePane()).findByText('خالد المعلم')
    expect(state.classReads).toBe(2)
    await openTab(text.tabs.students)
    await within(await activePane()).findByText('عمر خالد')
    expect(state.classReads).toBe(2)

    // Back on the details tab the panel reads them afresh (it may show a class prepared or a student enrolled here) …
    await openTab(ar.courses.drawer.tabs.details)
    await waitFor(() => expect(state.classReads).toBe(3))
    // … and a class tab opened after it reads them again.
    await openTab(text.tabs.teachers)
    await waitFor(() => expect(state.classReads).toBe(4))
  })

  it('offers a retry when the classes cannot be read', async () => {
    mockDrawerServer({ classes: [general()], failClassReads: 1 })
    renderDrawer(['courses.read', 'classes.read', 'users.read'])
    await ready()

    await openTab(text.tabs.teachers)
    const retry = await within(await activePane()).findByText(text.retry)
    fireEvent.click(retry.closest('button')!)
    expect(await within(await activePane()).findByText('خالد المعلم')).toBeInTheDocument()
    expect(within(await activePane()).queryByText(text.loadFailed)).not.toBeInTheDocument()
  })
})

describe('CourseDrawer — a course without a class', () => {
  it('prepares a published course: creates the general class with self-service off, opens it and shows its tabs', async () => {
    const { writes } = mockDrawerServer({ classes: [] })
    renderDrawer()
    await ready()

    await openTab(text.tabs.teachers)
    expect(await within(await activePane()).findByText(text.empty.prepare)).toBeInTheDocument()
    const button = within(await activePane()).getByText(text.prepare.action).closest('button')!
    await waitFor(() => expect(button).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(button)

    expect(await within(await activePane()).findByText(ar.classes.teachers.empty)).toBeInTheDocument()
    expect(await screen.findByText(text.prepare.done)).toBeInTheDocument()
    expect(writes).toEqual([
      {
        method: 'POST',
        url: '/api/classes',
        body: { courseId: COURSE_ID, code: 'PY-101-GEN', name: GENERAL_CLASS_NAME, capacity: 1000, startsOn: todayIn('Asia/Riyadh'), notes: GENERAL_CLASS_NOTE, selfEnrollment: false },
      },
      { method: 'POST', url: '/api/classes/created/status', body: { action: 'open' } },
    ])

    // The office enrolls at once in the class it prepared.
    await openTab(text.tabs.students)
    expect(await within(await activePane()).findByText('عمر خالد')).toBeInTheDocument()
  })

  it('then «فتح الاشتراك» finds the prepared class and only switches its self-enrollment on', async () => {
    const { writes } = mockDrawerServer({ classes: [] })
    renderDrawer()
    await ready()

    await openTab(text.tabs.teachers)
    const button = (await within(await activePane()).findByText(text.prepare.action)).closest('button')!
    await waitFor(() => expect(button).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(button)
    await within(await activePane()).findByText(ar.classes.teachers.empty)

    await openTab(ar.courses.drawer.tabs.details)
    const panel = await screen.findByTestId('open-enrollment-panel')
    expect(await within(panel).findByText(ar.courseEnrollmentPanel.closedState)).toBeInTheDocument()
    fireEvent.click(within(panel).getByText(ar.courseEnrollmentPanel.actions.open).closest('button')!)

    expect(await within(panel).findByText(ar.courseEnrollmentPanel.openState)).toBeInTheDocument()
    // No capacity dialog and no second class: the prepared one opens for subscription.
    expect(screen.queryByText(ar.courseEnrollmentPanel.create.intro)).not.toBeInTheDocument()
    expect(writes.slice(2)).toEqual([{ method: 'PATCH', url: '/api/classes/created', body: { selfEnrollment: true } }])
  })

  it('finishes a half-done preparation: our planned general class is only opened', async () => {
    const { writes } = mockDrawerServer({ classes: [general({ status: 'planned', teachers: [] })] })
    renderDrawer()
    await ready()

    await openTab(text.tabs.teachers)
    const notice = (await within(await activePane()).findByText(text.prepare.resume)).closest('.ant-alert') as HTMLElement
    const button = within(notice).getByText(text.prepare.action).closest('button')!
    await waitFor(() => expect(button).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(button)

    const pane = await activePane()
    await waitFor(() => expect(within(pane).queryByText(text.prepare.resume)).not.toBeInTheDocument())
    expect(writes).toEqual([{ method: 'POST', url: '/api/classes/general/status', body: { action: 'open' } }])
  })

  it('explains a draft course needs publishing first, with no button', async () => {
    const { writes } = mockDrawerServer({ course: makeCourse({ status: 'draft' }), classes: [] })
    renderDrawer()
    await ready()

    await openTab(text.tabs.teachers)
    expect(await within(await activePane()).findByText(text.empty.unpublished)).toBeInTheDocument()
    expect(within(await activePane()).queryByText(text.prepare.action)).not.toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('explains it to a reader without classes.manage, with no button', async () => {
    mockDrawerServer({ classes: [] })
    renderDrawer(['courses.read', 'classes.read', 'users.read'])
    await ready()

    await openTab(text.tabs.teachers)
    expect(await within(await activePane()).findByText(text.empty.noPermission)).toBeInTheDocument()
    expect(within(await activePane()).queryByText(text.prepare.action)).not.toBeInTheDocument()
  })
})

describe('CourseDrawer — unsaved work in a class tab', () => {
  it('asks before closing while a teacher picked in the teachers editor is not saved', async () => {
    mockDrawerServer({ classes: [general()] })
    const { onClose } = renderDrawer()
    await ready()

    await openTab(text.tabs.teachers)
    fireEvent.click((await within(await activePane()).findByText(ar.classes.teachers.edit)).closest('button')!)
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: ar.classes.teachers.add }))
    fireEvent.click(await screen.findByText('منى المساعدة', { selector: '.ant-select-item-option-content' }))
    expect(await screen.findByRole('combobox', { name: `${ar.classes.teachers.role}: منى المساعدة` })).toBeInTheDocument()

    await clickWhenSettled(() => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!)
    const titles = await screen.findAllByText(ar.common.unsaved.title)
    const dialog = titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByText(ar.common.unsaved.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
