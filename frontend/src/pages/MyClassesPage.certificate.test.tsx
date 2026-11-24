// J-F68: «الشهادة» is on every card of «دوراتي»; before the certificate is issued it opens a window that says what the
// course still needs — the required lessons left (by name for the learner's own course) and how many exams are not
// passed yet. The exams themselves are listed in one place only: «اختبارات الدورة» at the end of the course's lessons
// below the cards, which the window's «عرض الاختبارات» shows.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MyClassItem } from '../api/enrollments'
import type { LearningWorkspace, MyLearningCourse } from '../api/learning'
import type { MyCertificateItem } from '../api/myCertificates'
import type { MyExamItem } from '../api/myExams'
import { ar } from '../i18n/ar'
import { makeCounts, makeWorkspace } from '../learn/learn.fixtures'
import { resetWatchedMemory } from '../learn/watched.store'
import { makeLearningCourse } from '../mySchool/mySchool.fixtures'
import { makeAcademy } from '../test/academy'
import { ENROLLMENT_IDS, STUDENT_IDS, makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeMyCertificate } from '../test/myCertificates'
import { makeMyExam, makeMyExamResult, makeOnlineMyExam, makePublishedMyExam } from '../test/myExams'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyClassesPage } from './MyClassesPage'

const gapsText = ar.myClasses.certificateGaps
const examsText = ar.myLessons.hub.courseExams

const own = makeMyClassItem()
const other = makeMyClassItem({
  enrollmentId: ENROLLMENT_IDS[1],
  class: { ...own.class, id: 'c-2', code: 'WEB-A', name: { ar: 'الويب — الفصل أ' }, course: { id: 'co-2', code: 'WEB', name: { ar: 'تصميم الويب' } } },
})
const child = makeMyClassItem({ enrollmentId: ENROLLMENT_IDS[2], relation: 'child', student: { id: STUDENT_IDS[1], fullName: 'ليلى سعيد', displayName: null } })

/** API-229's item for a card: its enrollment, class and course, with the given counts. */
function learningOf(row: MyClassItem, counts = makeCounts({ total: 4, required: 4, completed: 4, completedRequired: 4, percent: 100, isComplete: true })): MyLearningCourse {
  return makeLearningCourse({
    enrollmentId: row.enrollmentId,
    relation: row.relation,
    student: row.student,
    class: { id: row.class.id, code: row.class.code, name: row.class.name, status: 'running', startsOn: null, endsOn: null },
    course: { id: row.class.course.id, code: row.class.course.code, name: row.class.course.name, summary: null, coverImageUrl: null, level: null },
    progress: counts,
  })
}

/** An exam of the card's class for the card's student. */
function examOf(row: MyClassItem, item: MyExamItem, id: string, title: string): MyExamItem {
  return { ...item, id, title: { ar: title }, class: { ...item.class, id: row.class.id }, student: row.student, relation: row.relation }
}

interface Api {
  certificates?: MyCertificateItem[][]
  exams?: MyExamItem[]
  workspace?: LearningWorkspace
  failExams?: boolean
}

function mockApi(rows: MyClassItem[], learning: MyLearningCourse[], api: Api = {}) {
  const calls: string[] = []
  let certificateReads = 0
  mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    calls.push(`${parsed.pathname}${parsed.search}`)
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (parsed.pathname === '/api/me/classes') return jsonResponse(200, makeMyClassList(rows))
    if (parsed.pathname === '/api/me/learning') return jsonResponse(200, { items: learning })
    if (parsed.pathname === '/api/me/certificates') {
      const answers = api.certificates ?? [[]]
      const items = answers[Math.min(certificateReads, answers.length - 1)]!
      certificateReads += 1
      return jsonResponse(200, { items })
    }
    if (parsed.pathname === '/api/me/exams') {
      if (api.failExams) return jsonResponse(500, { message: 'boom' })
      return jsonResponse(200, { items: api.exams ?? [], nextCursor: null })
    }
    if (parsed.pathname.startsWith('/api/me/learning/courses/')) return jsonResponse(200, api.workspace ?? makeWorkspace())
    return jsonResponse(404, {})
  })
  return calls
}

function renderPage(roles: string[] = ['student']) {
  return renderWithProviders(<MyClassesPage />, {
    auth: makeAuth({ user: makeUser({ id: STUDENT_IDS[0], role: roles.includes('guardian') ? 'guardian' : 'student', roles, permissions: ['courses.read', 'certificates.read_own'] }) }),
    route: '/my-classes',
    path: '/my-classes',
  })
}

function card(row: MyClassItem) {
  return screen.getByTestId(`class-card-${row.enrollmentId}`)
}

async function openGaps(row: MyClassItem) {
  await waitFor(() => expect(within(card(row)).getByText(ar.myClasses.card.certificate).closest('button')).not.toBeNull())
  fireEvent.click(within(card(row)).getByText(ar.myClasses.card.certificate).closest('button')!)
  return (await screen.findByText(gapsText.title.replace('{{course}}', row.class.course.name.ar))).closest('[role="dialog"]') as HTMLElement
}

/** The three exams of the own card's class: one passed, one failed (10 of 50, 25 needed), one online and not taken. */
const THREE_EXAMS = [
  examOf(own, makePublishedMyExam(), 'x-1', 'الاختبار القصير'),
  examOf(own, makePublishedMyExam({ result: makeMyExamResult({ score: 10 }) }), 'x-2', 'اختبار منتصف الفصل'),
  examOf(own, makeOnlineMyExam(), 'x-3', 'الاختبار النهائي'),
]

beforeEach(() => {
  window.localStorage.clear()
  resetWatchedMemory()
})

describe('MyClassesPage — «الشهادة» on every card (J-F68)', () => {
  it('shows the button on every card: a link to an issued certificate, else a locked button', async () => {
    const issued = makeMyCertificate()
    mockApi([own, other], [learningOf(own), learningOf(other)], { certificates: [[issued]] })
    renderPage()

    await waitFor(() => expect(within(card(own)).getByText(ar.myClasses.card.certificate).closest('a')).toHaveAttribute('href', `/my-certificates/${issued.id}/print`))
    const locked = within(card(other)).getByText(ar.myClasses.card.certificate).closest('button')
    expect(locked).toHaveClass('is-locked')
    expect(locked).toHaveAttribute('aria-haspopup', 'dialog')
  })

  it('names the lessons left and counts the exams not passed, without listing them or leaving the page', async () => {
    const counts = makeCounts({ total: 4, required: 3, completed: 1, completedRequired: 1, percent: 33 })
    const calls = mockApi([own], [learningOf(own, counts)], { exams: THREE_EXAMS })
    renderPage()
    const dialog = await openGaps(own)

    expect(await within(dialog).findByTestId('certgaps-lessons-summary')).toHaveTextContent('بقي درسان إلزاميان من 3.')
    // The workspace names the required lessons not done (i2 of level 1, i3 of level 2); i4 is optional.
    expect(within(within(dialog).getByTestId('certgaps-lessons')).getAllByRole('listitem')).toHaveLength(2)
    expect(within(dialog).getByTestId('certgaps-exams-summary')).toHaveTextContent('تم اجتياز 1 من 3.')
    expect(within(dialog).getByText(gapsText.exams.where)).toBeInTheDocument()
    // The exams are listed only below the course's lessons: no exam row here, and no link to another page.
    expect(within(dialog).queryByText('اختبار منتصف الفصل')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
    expect(within(dialog).getByText(ar.myClasses.card.browse)).toBeInTheDocument()
    expect(within(dialog).getByText(gapsText.exams.show)).toBeInTheDocument()
    // The exams of the card's class for the card's student; the certificates again, for that student.
    expect(calls).toContain(`/api/me/exams?classId=${own.class.id}&studentId=${own.student.id}&limit=100`)
    expect(calls).toContain(`/api/me/certificates?studentId=${own.student.id}`)
  })

  it('«عرض الاختبارات» shows the course exams at the end of its lessons, each with where it stands', async () => {
    const counts = makeCounts({ total: 4, required: 3, completed: 3, completedRequired: 3, percent: 100, isComplete: true })
    mockApi([own], [learningOf(own, counts)], { exams: THREE_EXAMS })
    renderPage()
    const dialog = await openGaps(own)

    fireEvent.click(await within(dialog).findByText(gapsText.exams.show))
    const section = await screen.findByTestId('course-exams')
    expect(within(section).getByText(examsText.title)).toBeInTheDocument()
    expect(within(section).getByText(/تم اجتياز 1 من 3\./)).toBeInTheDocument()
    expect(within(section).getByTestId('course-exam-x-1')).toHaveTextContent(examsText.passed)
    expect(within(section).getByTestId('course-exam-x-2')).toHaveTextContent('لم يُجتز: الدرجة 10 من 50 والمطلوب 25.')
    const notTaken = within(section).getByTestId('course-exam-x-3')
    expect(notTaken).toHaveTextContent(gapsText.exams.state.notStarted)
    expect(within(notTaken).getByText(examsText.take)).toBeInTheDocument()
    // Only the exam the server lets the learner take now has a button.
    expect(within(within(section).getByTestId('course-exam-x-2')).queryByRole('button')).not.toBeInTheDocument()
  })

  it('says a certificate issued since the page was read is ready, and the card links to it', async () => {
    const issued = makeMyCertificate()
    mockApi([own], [learningOf(own)], { certificates: [[], [issued]] })
    renderPage()
    const dialog = await openGaps(own)

    expect(await within(dialog).findByText(gapsText.issued)).toBeInTheDocument()
    expect(within(dialog).getByText(gapsText.open).closest('a')).toHaveAttribute('href', `/my-certificates/${issued.id}/print`)
    await waitFor(() => expect(within(card(own)).getByText(ar.myClasses.card.certificate).closest('a')).toHaveAttribute('href', `/my-certificates/${issued.id}/print`))
  })

  it('says so when every requirement is met and still no certificate was issued', async () => {
    mockApi([own], [learningOf(own)], {
      exams: [examOf(own, makePublishedMyExam(), 'x-1', 'الاختبار القصير')],
      workspace: makeWorkspace({ progress: makeCounts({ total: 4, required: 3, completed: 3, completedRequired: 3, percent: 100, isComplete: true }) }),
    })
    renderPage()
    const dialog = await openGaps(own)

    expect(await within(dialog).findByText(gapsText.completeNoCertificate)).toBeInTheDocument()
  })

  it('names a revoked certificate instead of the requirements', async () => {
    mockApi([own], [learningOf(own)], { certificates: [[makeMyCertificate({ status: 'revoked', revokedAt: '2026-11-23T10:00:00.000Z' })]] })
    renderPage()
    const dialog = await openGaps(own)

    expect(await within(dialog).findByText(gapsText.revoked)).toBeInTheDocument()
  })

  it('counts a child’s lessons from the card without reading their workspace', async () => {
    const counts = makeCounts({ total: 4, required: 4, completed: 3, completedRequired: 3, percent: 75 })
    const calls = mockApi([child], [learningOf(child, counts)], { exams: [examOf(child, makeMyExam(), 'x-1', 'الاختبار الشفهي')] })
    renderPage(['guardian'])
    const dialog = await openGaps(child)

    expect(await within(dialog).findByTestId('certgaps-lessons-summary')).toHaveTextContent('بقي درس إلزامي واحد من 4.')
    expect(within(dialog).queryByTestId('certgaps-lessons')).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('certgaps-exams-summary')).toHaveTextContent('تم اجتياز 0 من 1.')
    // A child's course is not opened below the cards (API-230 serves the caller's own enrollment only).
    expect(within(dialog).queryByText(gapsText.exams.show)).not.toBeInTheDocument()
    expect(calls.some((call) => call.startsWith('/api/me/learning/courses/'))).toBe(false)
  })

  it('offers a retry when the requirements cannot be read', async () => {
    mockApi([own], [learningOf(own)], { failExams: true })
    renderPage()
    const dialog = await openGaps(own)

    expect(await within(dialog).findByText(gapsText.failed)).toBeInTheDocument()
    expect(within(dialog).getByText(gapsText.retry)).toBeInTheDocument()
  })
})
