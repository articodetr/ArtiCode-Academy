// One class's own page (CH-0374): the drawer's tabs plus the class's lessons, homework and exams, each read with the
// class's id, each «add» bound to this class, and «رجوع» back to the list. Since J-F74 (CH-0381) the lessons tab
// comes first and the page opens on it; since J-F75 (CH-0382) an exam added from a lesson card renews the exams tab.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAssignment, makeAssignmentList } from '../test/assignments'
import { CLASS_ID, makeClass } from '../test/classes'
import { makeExam, makeExamList } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLesson, makeLessonList } from '../test/lessons'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ClassPage } from './ClassPage'

const TEACHER_PERMISSIONS = ['classes.read', 'lessons.read', 'lessons.manage', 'assignments.read', 'assignments.manage', 'exams.read', 'exams.manage']

function mockPageApi(status: 'running' | 'completed' = 'running') {
  const urls: string[] = []
  mockFetch((url) => {
    urls.push(url)
    if (url === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass({ status }))
    if (url.startsWith('/api/lessons?')) return jsonResponse(200, makeLessonList([makeLesson({ id: 'l-1', title: { ar: 'الدرس الأول' } })]))
    if (url.startsWith('/api/assignments?')) return jsonResponse(200, makeAssignmentList([makeAssignment({ id: 'a-1', title: { ar: 'واجب الدرس الأول' } })]))
    if (url.startsWith('/api/exams?')) return jsonResponse(200, makeExamList([makeExam({ id: 'e-1', title: { ar: 'اختبار قصير' } })]))
    // J-F75: an exam added from a lesson card (POST — API-115).
    if (url === `/api/classes/${CLASS_ID}/exams`) return jsonResponse(201, makeExam({ id: 'e-new', title: { ar: 'اختبار الدرس الأول' } }))
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return { urls }
}

function renderPage(permissions: string[] = TEACHER_PERMISSIONS) {
  return renderWithProviders(<ClassPage />, {
    auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions }) }),
    route: `/classes/${CLASS_ID}`,
    path: '/classes/:classId',
    routes: { '/classes': <LocationProbe /> },
  })
}

const tabNames = () => [...document.querySelectorAll('.ant-tabs-tab')].map((tab) => tab.textContent ?? '')
const activeTab = () => document.querySelector('.ant-tabs-tab-active')?.textContent ?? null
const activePane = () => document.querySelector('[role="tabpanel"][aria-hidden="false"]') as HTMLElement

/** The page has read its class: the class's name heads it (the class code shows in the details tab only). */
const pageLoaded = () => screen.findByText('بايثون — الفصل أ', { selector: 'h3 bdi' })

describe('ClassPage (CH-0374)', () => {
  it('shows the class as a page opening on its lessons — the first tab, before the details (J-F74) — with the homework and exams tabs after the weekly schedule', async () => {
    mockPageApi()
    renderPage()
    await pageLoaded()
    const names = tabNames()
    expect(names.slice(0, 2)).toEqual([ar.classPage.tabs.lessons, ar.classes.drawer.tabs.details])
    expect(activeTab()).toBe(ar.classPage.tabs.lessons)
    expect(await screen.findByText('الدرس الأول')).toBeInTheDocument()
    const schedule = names.indexOf(ar.classSchedule.tab)
    expect(names.slice(schedule + 1, schedule + 3)).toEqual([ar.classPage.tabs.assignments, ar.classPage.tabs.exams])
    expect(document.querySelector('.ant-drawer')).toBeNull()
  })

  it('opens on the details, first as before, for a reader without the lessons key (J-F74)', async () => {
    mockPageApi()
    renderPage(['classes.read', 'assignments.read', 'exams.read'])
    expect(await screen.findByText('PY-101-A')).toBeInTheDocument()
    expect(tabNames()).not.toContain(ar.classPage.tabs.lessons)
    expect(tabNames()[0]).toBe(ar.classes.drawer.tabs.details)
    expect(activeTab()).toBe(ar.classes.drawer.tabs.details)
  })

  it('reads the lessons with the class id at once and each other list only when its tab opens, and offers «add» to a manager of an open class', async () => {
    const { urls } = mockPageApi()
    renderPage()
    await pageLoaded()
    expect(await screen.findByText('الدرس الأول')).toBeInTheDocument()
    expect(urls[0]).toBe(`/api/classes/${CLASS_ID}`)
    expect(urls.some((url) => url.startsWith('/api/lessons?') && url.includes(`classId=${CLASS_ID}`))).toBe(true)
    expect(urls.some((url) => url.startsWith('/api/assignments?') || url.startsWith('/api/exams?'))).toBe(false)
    expect(screen.getByText(ar.lessons.addLesson)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: ar.classPage.tabs.assignments }))
    expect(await screen.findByText('واجب الدرس الأول')).toBeInTheDocument()
    expect(urls.some((url) => url.startsWith('/api/assignments?') && url.includes(`classId=${CLASS_ID}`))).toBe(true)
    expect(screen.getByText(ar.assignments.addAssignment)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: ar.classPage.tabs.exams }))
    expect(await screen.findByText('اختبار قصير')).toBeInTheDocument()
    expect(urls.some((url) => url.startsWith('/api/exams?') && url.includes(`classId=${CLASS_ID}`))).toBe(true)
    // The lessons tab, still mounted, has the same words on each lesson card (J-F75): read the shown tab only.
    expect(within(activePane()).getByText(ar.exams.addExam)).toBeInTheDocument()
  })

  it('renews the exams tab after an exam is added from a lesson card (J-F75)', async () => {
    const { urls } = mockPageApi()
    renderPage()
    await pageLoaded()
    fireEvent.click(screen.getByRole('tab', { name: ar.classPage.tabs.exams }))
    expect(await screen.findByText('اختبار قصير')).toBeInTheDocument()
    const examReads = () => urls.filter((url) => url.startsWith('/api/exams?')).length
    expect(examReads()).toBe(1)

    fireEvent.click(screen.getByRole('tab', { name: ar.classPage.tabs.lessons }))
    const lessonCard = await screen.findByTestId('class-lesson-l-1')
    fireEvent.click(within(lessonCard).getByText(ar.classPage.lessons.addExam).closest('button')!)
    const dialog = (await screen.findByText(ar.exams.create.title)).closest('[role="dialog"]') as HTMLElement
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.exams.fields.type))
    fireEvent.click(await screen.findByText(ar.exams.types.quiz, { selector: '.ant-select-item-option-content' }))
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.titleAr), 'اختبار الدرس الأول')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.maxScore), '10')
    fireEvent.click(within(dialog).getByText(ar.exams.create.submit).closest('button')!)

    // The exams tab mounts anew and reads its list again (it was read once before the exam was added).
    await waitFor(() => expect(examReads()).toBeGreaterThanOrEqual(2))
    expect(urls.some((url) => url === `/api/classes/${CLASS_ID}/exams`)).toBe(true)
  })

  it('offers no «add» for a completed class, nor to a reader without the manage key', async () => {
    mockPageApi('completed')
    renderPage()
    await pageLoaded()
    expect(await screen.findByText('الدرس الأول')).toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.addLesson)).toBeNull()
  })

  it('hides a tab whose read key is missing', async () => {
    mockPageApi()
    renderPage(['classes.read', 'lessons.read'])
    await pageLoaded()
    const names = tabNames()
    expect(names).toContain(ar.classPage.tabs.lessons)
    expect(names).not.toContain(ar.classPage.tabs.assignments)
    expect(names).not.toContain(ar.classPage.tabs.exams)
  })

  it('opens the homework form with this class fixed and named', async () => {
    mockPageApi()
    renderPage()
    await pageLoaded()
    fireEvent.click(screen.getByRole('tab', { name: ar.classPage.tabs.assignments }))
    fireEvent.click((await screen.findByText(ar.assignments.addAssignment)).closest('button')!)
    const dialog = (await screen.findByText(ar.assignments.create.title)).closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(/سيُضاف إلى الفصل/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(ar.assignments.fields.class)).toBeNull()
  })

  it('goes back to the classes list with «رجوع»', async () => {
    mockPageApi()
    renderPage()
    await pageLoaded()
    fireEvent.click(screen.getByText(ar.classPage.back).closest('button')!)
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/classes')
  })
})
