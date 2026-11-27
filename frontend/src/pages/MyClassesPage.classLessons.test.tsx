// J-F81 (TEST-344, Jallal's request «اي درس ينشره الاستاذ يوصل مباشرة للطلاب»): the lessons a teacher adds to a class
// (MOD-06, API-101) reach the student on «دوراتي» — counted on the card and listed first in the course's panel, under
// «دروس الفصل», with the join link, the video and the attachments — even when the course has no curriculum lesson.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LearningWorkspace, MyLearningCourse } from '../api/learning'
import type { MyExamItem } from '../api/myExams'
import type { MyLessonItem } from '../api/myLessons'
import { ar } from '../i18n/ar'
import { makeWorkspace } from '../learn/learn.fixtures'
import { resetWatchedMemory } from '../learn/watched.store'
import { CLASS_LESSONS_SHOWN } from '../learn/hub/HubLessons'
import { makeLearningCourse, makeProgress } from '../mySchool/mySchool.fixtures'
import { makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeMyExam, makeMyExamResult, makeOnlineMyExam } from '../test/myExams'
import { makeMyLesson, makeMyLessonList } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyClassesPage } from './MyClassesPage'

const hub = ar.myLessons.hub
const COURSE = makeLearningCourse({ course: { ...makeLearningCourse().course, id: 'c1', name: { ar: 'أساسيات البرمجة' } }, progress: makeProgress({ total: 4, completed: 1, percent: 25 }) })
// The card (API-060) and the course (API-229) name the same class and student, as the server does.
const ROW = makeMyClassItem({
  enrollmentId: COURSE.enrollmentId,
  student: COURSE.student,
  class: { ...makeMyClassItem().class, id: COURSE.class.id, name: { ar: 'أكاديمية التطوير المحلية' } },
})
const EMPTY_WORKSPACE: LearningWorkspace = { ...makeWorkspace(), sections: [], progress: { ...makeWorkspace().progress, total: 0, required: 0, completed: 0, completedRequired: 0, percent: null } }

const base = makeMyLesson()
function classLesson(id: string, overrides: Partial<MyLessonItem> = {}): MyLessonItem {
  return makeMyLesson({ id, title: { ar: `درس ${id}` }, class: { ...base.class, id: COURSE.class.id }, student: { ...base.student, id: COURSE.student.id }, ...overrides })
}

interface Options {
  course?: MyLearningCourse
  workspace?: LearningWorkspace
  /** API-101's pages in order; a Response fails the read. */
  pages?: (MyLessonItem[] | Response)[]
  /** API-121 for the class (the class lessons' «الاختبار» and «اختبارات الدورة»). */
  exams?: MyExamItem[]
}

function serve({ course = COURSE, workspace = makeWorkspace(), pages = [[]], exams = [] }: Options = {}) {
  const lessonQueries: URLSearchParams[] = []
  mockFetch((url) => {
    const { pathname, searchParams } = new URL(url, 'http://localhost')
    if (pathname === '/api/me/classes') return jsonResponse(200, makeMyClassList([ROW]))
    if (pathname === '/api/me/learning') return jsonResponse(200, { items: [course] })
    if (pathname === '/api/me/learning/courses/c1') return jsonResponse(200, workspace)
    if (pathname === '/api/me/lessons') {
      lessonQueries.push(searchParams)
      // A read starts at its first page; the cursor names the next one.
      const index = searchParams.get('cursor') ? Number(searchParams.get('cursor')) : 0
      const answer = pages[Math.min(index, pages.length - 1)]!
      if (answer instanceof Response) return answer
      return jsonResponse(200, makeMyLessonList(answer, index + 1 < pages.length ? String(index + 1) : null))
    }
    if (pathname === '/api/me/exams') return jsonResponse(200, { items: exams, nextCursor: null })
    if (pathname === '/api/me/certificates') return jsonResponse(200, { items: [] })
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return { lessonQueries }
}

function renderClasses(route = '/my-classes') {
  return renderWithProviders(<MyClassesPage />, {
    auth: makeAuth({ user: makeUser({ id: COURSE.student.id, role: 'student', roles: ['student'], permissions: [] }) }),
    route,
    path: '/my-classes',
  })
}

const card = () => screen.getByTestId(`class-card-${ROW.enrollmentId}`)
const lessonsBadge = () => screen.getByTestId(`class-card-lessons-${ROW.enrollmentId}`)
const classPanel = () => screen.findByTestId('hub-class-lessons')

beforeEach(() => {
  window.localStorage.clear()
  resetWatchedMemory()
})

describe('«دوراتي» — the lessons a teacher adds reach the student (J-F81)', () => {
  it('counts the class lessons that are not cancelled with the curriculum on the card, newest first from API-101', async () => {
    const { lessonQueries } = serve({ pages: [[classLesson('a'), classLesson('b'), classLesson('c', { status: 'cancelled' })]] })
    renderClasses()

    await screen.findByTestId(`class-card-${ROW.enrollmentId}`)
    await waitFor(() => expect(lessonsBadge()).toHaveTextContent(ar.myClasses.card.lessons.replace('{{total}}', '6')))
    expect(lessonQueries[0]!.get('order')).toBe('desc')
    expect(lessonQueries[0]!.get('limit')).toBe('100')
    expect(lessonQueries[0]!.get('classId')).toBeNull()
  })

  it('lists the class lessons first in the course’s panel, with the join link, the video and the attachments, then «منهج الدورة»', async () => {
    const live = classLesson('live', { title: { ar: 'درس الحلقات المباشر' }, deliveryMode: 'live_online', status: 'scheduled', meetingUrl: 'https://meet.example.com/loops', attachments: [{ kind: 'book', title: { ar: 'كتاب الحلقات' }, url: 'https://cdn.example.org/loops.pdf' }] })
    const recorded = classLesson('rec', { title: { ar: 'مراجعة مسجّلة' }, deliveryMode: 'recorded', status: 'completed', recordingUrl: 'https://videos.example.com/review' })
    const { lessonQueries } = serve({ pages: [[live, recorded]] })
    renderClasses()

    await screen.findByTestId(`class-card-${ROW.enrollmentId}`)
    await waitFor(() => expect(lessonQueries.length).toBe(1))
    fireEvent.click(within(card()).getByText(ar.myClasses.card.browse).closest('button')!)

    const panel = await classPanel()
    // Choosing a card reads the lessons again: a lesson added since the page opened shows.
    await waitFor(() => expect(lessonQueries.length).toBe(2))
    expect(within(panel).getByRole('heading', { name: hub.classLessons.title })).toBeInTheDocument()
    const liveRow = within(panel).getByText('درس الحلقات المباشر').closest('li')!
    expect(within(liveRow).getByText(ar.myLessons.feed.join).closest('a')).toHaveAttribute('href', 'https://meet.example.com/loops')
    expect(within(liveRow).getByText(hub.row.file).closest('a')).toHaveAttribute('href', 'https://cdn.example.org/loops.pdf')
    // The panel's heading names the course: the rows do not repeat the class line.
    expect(within(liveRow).queryByText(/بايثون — الفصل أ/)).not.toBeInTheDocument()
    const recordedRow = within(panel).getByText('مراجعة مسجّلة').closest('li')!
    expect(within(recordedRow).getByText(ar.lessons.attachments.watchVideo).closest('a')).toHaveAttribute('href', 'https://videos.example.com/review')

    // The curriculum follows under its own heading.
    const curriculum = await screen.findByRole('heading', { name: hub.classLessons.curriculum })
    expect(panel.compareDocumentPosition(curriculum) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('المستوى الأول — أساسيات')).toBeInTheDocument()
  })

  it('shows a course without a curriculum lesson by its class lessons — no «لم تُنشر دروس» and no «لا توجد دروس»', async () => {
    const course = { ...COURSE, progress: makeProgress({ total: 0, required: 0, completed: 0, completedRequired: 0, percent: null }) }
    serve({ course, workspace: EMPTY_WORKSPACE, pages: [[classLesson('a', { deliveryMode: 'live_online' }), classLesson('b', { deliveryMode: 'live_online' })]] })
    renderClasses()

    await screen.findByTestId(`class-card-${ROW.enrollmentId}`)
    await waitFor(() => expect(within(card()).getByText(ar.myClasses.card.classLessons.replace('{{n}}', '2'))).toBeInTheDocument())
    expect(within(card()).queryByText(ar.mySchool.card.noLessons)).not.toBeInTheDocument()
    expect(lessonsBadge()).toHaveTextContent(ar.myClasses.card.lessons.replace('{{total}}', '2'))

    fireEvent.click(within(card()).getByText(ar.myClasses.card.browse).closest('button')!)
    const panel = await classPanel()
    expect(within(panel).getByText('درس a')).toBeInTheDocument()
    expect(screen.queryByText(hub.emptyCourse)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: hub.classLessons.curriculum })).not.toBeInTheDocument()

    // «المسجلة» has none of them: the filter says so, not «no lessons in this course».
    fireEvent.click(screen.getByRole('button', { name: hub.filters.recorded }))
    expect(await screen.findByText(hub.emptyFilter)).toBeInTheDocument()
    expect(screen.queryByTestId('hub-class-lessons')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: hub.filters.live }))
    expect(await classPanel()).toBeInTheDocument()
  })

  it('narrows the class lessons with the same pills: «المباشرة» and «المسجلة»', async () => {
    serve({ pages: [[classLesson('live', { title: { ar: 'عنوان مباشر' }, deliveryMode: 'live_online' }), classLesson('rec', { title: { ar: 'عنوان مسجّل' }, deliveryMode: 'recorded' })]] })
    renderClasses('/my-classes?course=c1')

    const panel = await classPanel()
    expect(within(panel).getByText('عنوان مباشر')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: hub.filters.recorded }))
    await waitFor(() => expect(within(panel).queryByText('عنوان مباشر')).not.toBeInTheDocument())
    expect(within(panel).getByText('عنوان مسجّل')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: hub.filters.live }))
    await waitFor(() => expect(within(panel).queryByText('عنوان مسجّل')).not.toBeInTheDocument())
    expect(within(panel).getByText('عنوان مباشر')).toBeInTheDocument()
  })

  it('puts the lesson’s exam and its attachments beside «الانضمام»: «الاختبار» opens the exam popup, «تم الاختبار» once taken', async () => {
    const live = classLesson('live', { title: { ar: 'مقدمة في البرمجة' }, deliveryMode: 'live_online', status: 'scheduled', meetingUrl: 'https://meet.example.com/intro', attachments: [{ kind: 'book', title: { ar: 'الكتاب' }, url: 'https://cdn.example.org/book.pdf' }, { kind: 'link', title: { ar: 'تمارين' }, url: 'https://example.org/drills' }] })
    const done = classLesson('done', { title: { ar: 'درس سابق' }, status: 'completed' })
    const plain = classLesson('plain', { title: { ar: 'درس بلا اختبار' } })
    const onClass = { ...makeMyExam().class, id: COURSE.class.id }
    const owner = { ...makeMyExam().student, id: COURSE.student.id }
    const exams = [
      makeOnlineMyExam({ id: 'ex-live', title: { ar: 'اختبار المقدمة' }, class: onClass, student: owner, lesson: { id: 'live', title: { ar: 'مقدمة في البرمجة' }, startsAt: live.startsAt } }),
      makeMyExam({ id: 'ex-done', title: { ar: 'اختبار سابق' }, status: 'published', class: onClass, student: owner, lesson: { id: 'done', title: { ar: 'درس سابق' }, startsAt: done.startsAt }, result: makeMyExamResult({ score: 9 }) }),
    ]
    serve({ pages: [[live, done, plain]], exams })
    renderClasses('/my-classes?course=c1')

    const panel = await classPanel()
    const liveRow = (await within(panel).findByText('مقدمة في البرمجة', { selector: '.hub-row__title, .hub-row__title *' })).closest('li')!
    const actions = liveRow.querySelector('.hub-row__actions') as HTMLElement
    expect(within(actions).getByText(ar.myLessons.feed.join)).toBeInTheDocument()
    const exam = await within(actions).findByText(hub.row.exam)
    expect(within(actions).getByText(hub.row.files.replace('{{n}}', '2'))).toBeInTheDocument()
    // «تم الاختبار» for the exam already taken; nothing on a lesson without an exam or an attachment.
    const doneRow = within(panel).getByText('درس سابق', { selector: '.hub-row__title, .hub-row__title *' }).closest('li')!
    expect(within(doneRow).getByText(hub.row.examDone)).toBeInTheDocument()
    const plainRow = within(panel).getByText('درس بلا اختبار', { selector: '.hub-row__title, .hub-row__title *' }).closest('li')!
    expect(within(plainRow).queryByText(hub.row.exam)).not.toBeInTheDocument()
    expect(within(plainRow).queryByText(hub.row.file)).not.toBeInTheDocument()

    fireEvent.click(exam.closest('button')!)
    // The exam's own popup (LessonExamModal), titled by the exam.
    await waitFor(() => expect(document.querySelector('.ant-modal-title')?.textContent).toContain('اختبار المقدمة'))
  })

  it('shows the newest few and the rest on demand', async () => {
    const many = Array.from({ length: CLASS_LESSONS_SHOWN + 2 }, (_, index) => classLesson(`n${index}`))
    serve({ pages: [many] })
    renderClasses('/my-classes?course=c1')

    const panel = await classPanel()
    expect(within(panel).getAllByRole('listitem')).toHaveLength(CLASS_LESSONS_SHOWN)
    fireEvent.click(within(panel).getByRole('button', { name: hub.classLessons.all.replace('{{n}}', String(many.length)) }))
    expect(within(panel).getAllByRole('listitem')).toHaveLength(many.length)
    fireEvent.click(within(panel).getByRole('button', { name: hub.classLessons.less }))
    expect(within(panel).getAllByRole('listitem')).toHaveLength(CLASS_LESSONS_SHOWN)
  })

  it('never counts or lists the lessons of another class or another student', async () => {
    const other = makeMyLesson({ id: 'x', title: { ar: 'درس فصل آخر' }, class: { ...base.class, id: 'another-class' }, student: { ...base.student, id: COURSE.student.id } })
    const child = makeMyLesson({ id: 'y', title: { ar: 'درس طالب آخر' }, class: { ...base.class, id: COURSE.class.id }, student: { ...base.student, id: 'another-student' } })
    serve({ pages: [[classLesson('mine'), other, child]] })
    renderClasses('/my-classes?course=c1')

    const panel = await classPanel()
    expect(within(panel).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('درس فصل آخر')).not.toBeInTheDocument()
    expect(screen.queryByText('درس طالب آخر')).not.toBeInTheDocument()
    expect(lessonsBadge()).toHaveTextContent(ar.myClasses.card.lessons.replace('{{total}}', '5'))
  })

  it('reads every page of API-101 with the server’s cursor', async () => {
    const { lessonQueries } = serve({ pages: [[classLesson('p1')], [classLesson('p2')]] })
    renderClasses()

    await waitFor(() => expect(lessonsBadge()).toHaveTextContent(ar.myClasses.card.lessons.replace('{{total}}', '6')))
    expect(lessonQueries.map((query) => query.get('cursor'))).toEqual([null, '1'])
  })

  it('says when the class lessons cannot be read, keeps the curriculum, and reads them again on retry', async () => {
    let fail = true
    const lessons = [classLesson('back')]
    mockFetch((url) => {
      const { pathname } = new URL(url, 'http://localhost')
      if (pathname === '/api/me/classes') return jsonResponse(200, makeMyClassList([ROW]))
      if (pathname === '/api/me/learning') return jsonResponse(200, { items: [COURSE] })
      if (pathname === '/api/me/learning/courses/c1') return jsonResponse(200, makeWorkspace())
      if (pathname === '/api/me/lessons') return fail ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makeMyLessonList(lessons))
      if (pathname === '/api/me/exams') return jsonResponse(200, { items: [], nextCursor: null })
      if (pathname === '/api/me/certificates') return jsonResponse(200, { items: [] })
      return jsonResponse(404, {})
    })
    renderClasses('/my-classes?course=c1')

    expect(await screen.findByText(hub.classLessons.failed)).toBeInTheDocument()
    expect(await screen.findByText('المستوى الأول — أساسيات')).toBeInTheDocument()
    fail = false
    const alert = screen.getByText(hub.classLessons.failed).closest('.ant-alert')! as HTMLElement
    fireEvent.click(within(alert).getByRole('button'))
    expect(await screen.findByText('درس back')).toBeInTheDocument()
    expect(screen.queryByText(hub.classLessons.failed)).not.toBeInTheDocument()
  })
})
