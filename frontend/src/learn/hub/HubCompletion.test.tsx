import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EnrollmentCompletion } from '../../api/myCertificates'
import type { MyExamItem } from '../../api/myExams'
import { ar } from '../../i18n/ar'
import { makeLearningCourse } from '../../mySchool/mySchool.fixtures'
import { jsonResponse, mockFetch } from '../../test/http'
import { makeMyExamList, makeMyExamResult, makeOnlineMyExam } from '../../test/myExams'
import { makeAuth, makeUser, renderWithProviders } from '../../test/render'
import { HubCompletion } from './HubCompletion'

const finish = ar.myLessons.hub.finish
const COURSE = makeLearningCourse()
const CERTIFICATE_ID = '0195a000-0000-7000-8000-00000000f901'

function makeCompletion(overrides: Partial<EnrollmentCompletion> = {}): EnrollmentCompletion {
  return {
    enrollmentId: COURSE.enrollmentId,
    classId: COURSE.class.id,
    courseId: COURSE.course.id,
    state: 'assessments_pending',
    lessons: { required: 4, completed: 4 },
    work: [{ kind: 'exam', id: 'exam-1', title: { ar: 'الاختبار النهائي' }, maxScore: 10, done: false, score: null }],
    grade: null,
    certificate: null,
    ...overrides,
  }
}

const READY = makeCompletion({
  state: 'ready',
  work: [{ kind: 'exam', id: 'exam-1', title: { ar: 'الاختبار النهائي' }, maxScore: 10, done: true, score: 9 }],
  grade: { percent: 90, label: { ar: 'ممتاز' }, letter: 'A', isPass: true },
})
const ISSUED = makeCompletion({ ...READY, state: 'issued', certificate: { id: CERTIFICATE_ID, serial: 'CERT-2026-00031', status: 'issued' } })

interface Served {
  completion: EnrollmentCompletion | (() => EnrollmentCompletion) | Response
  exams?: MyExamItem[]
  claim?: () => Response
}

function serve({ completion, exams = [], claim }: Served) {
  const calls: string[] = []
  mockFetch((url, init) => {
    const { pathname, searchParams } = new URL(url, 'http://localhost')
    calls.push(`${init?.method ?? 'GET'} ${pathname}`)
    if (pathname === `/api/me/enrollments/${COURSE.enrollmentId}/completion`) {
      if (completion instanceof Response) return completion.clone()
      return jsonResponse(200, typeof completion === 'function' ? completion() : completion)
    }
    if (pathname === `/api/me/enrollments/${COURSE.enrollmentId}/certificate`) return claim ? claim() : jsonResponse(500, {})
    if (pathname === '/api/me/exams') {
      expect(searchParams.get('classId')).toBe(COURSE.class.id)
      return jsonResponse(200, makeMyExamList(exams))
    }
    return jsonResponse(404, { statusCode: 404 })
  })
  return calls
}

const renderSection = () =>
  renderWithProviders(<HubCompletion course={COURSE} version={4} />, {
    auth: makeAuth({ user: makeUser({ id: COURSE.student.id, role: 'student', roles: ['student'], permissions: ['certificates.read_own', 'exams.take'] }) }),
    route: '/my-lessons',
  })

describe('HubCompletion — exams and the certificate of a course (J-F67)', () => {
  it('shows the three steps and each exam with its action, and no certificate button before the server says ready', async () => {
    serve({ completion: makeCompletion(), exams: [makeOnlineMyExam({ id: 'exam-1' })] })
    renderSection()

    expect(await screen.findByRole('heading', { name: finish.title })).toBeInTheDocument()
    expect(screen.getByText('4 / 4')).toBeInTheDocument()
    expect(screen.getByText('0 / 1')).toBeInTheDocument()
    expect(screen.getByText(ar.takeExam.list.start)).toBeInTheDocument()
    expect(screen.getByText('الاختبارات المتبقية: 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: finish.claim })).not.toBeInTheDocument()
  })

  it('shows the student’s released score and marks the exam done', async () => {
    serve({ completion: READY, exams: [makeOnlineMyExam({ id: 'exam-1', maxScore: 10, result: makeMyExamResult({ score: 9 }) })] })
    renderSection()
    const row = (await screen.findByText(finish.examDone)).closest('li')!
    expect(within(row).getByText('9 / 10')).toBeInTheDocument()
  })

  it('takes the certificate through the server and then offers to print it', async () => {
    let current: EnrollmentCompletion = READY
    const calls = serve({
      completion: () => current,
      claim: () => {
        current = ISSUED
        return jsonResponse(200, { created: true, certificate: { id: CERTIFICATE_ID, serial: 'CERT-2026-00031' } })
      },
    })
    renderSection()

    expect(await screen.findByText('أتممت الدورة بنتيجة 90٪، وشهادتك جاهزة.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: finish.claim }))

    const open = await screen.findByRole('link', { name: new RegExp(finish.open) })
    expect(open).toHaveAttribute('href', `/my-certificates/${CERTIFICATE_ID}/print`)
    expect(open).toHaveAttribute('target', '_blank')
    expect(screen.getByText('CERT-2026-00031')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: finish.claim })).not.toBeInTheDocument()
    expect(calls.filter((call) => call.startsWith('POST'))).toEqual([`POST /api/me/enrollments/${COURSE.enrollmentId}/certificate`])
  })

  it('says so and reads the state again when the server refuses the claim', async () => {
    let current: EnrollmentCompletion = READY
    serve({
      completion: () => current,
      claim: () => {
        current = makeCompletion({ state: 'lessons_pending', lessons: { required: 4, completed: 3 } })
        return jsonResponse(409, { statusCode: 409, code: 'certificate_not_ready', state: 'lessons_pending' })
      },
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: finish.claim }))
    expect(await screen.findByText(finish.notReady)).toBeInTheDocument()
    expect(await screen.findByText('الدروس المتبقية: 1')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: finish.claim })).not.toBeInTheDocument())
  })

  it('words a failing grade and a revoked certificate, without a button', async () => {
    serve({ completion: makeCompletion({ ...READY, state: 'not_passed', grade: { percent: 40, label: { ar: 'راسب' }, letter: 'F', isPass: false } }) })
    const failed = renderSection()
    expect(await screen.findByText('نتيجتك 40٪ أقل من درجة النجاح. أعد الاختبار إن بقيت لك محاولات.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: finish.claim })).not.toBeInTheDocument()
    failed.unmount()

    serve({ completion: makeCompletion({ ...READY, state: 'revoked', certificate: { id: CERTIFICATE_ID, serial: 'CERT-2026-00031', status: 'revoked' } }) })
    renderSection()
    expect(await screen.findByText(finish.states.revoked)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: new RegExp(finish.open) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: finish.claim })).not.toBeInTheDocument()
  })

  it('shows nothing for an academy that issues through its office, on a course without exams', async () => {
    const calls = serve({ completion: makeCompletion({ state: 'not_offered', work: [] }) })
    const { container } = renderSection()
    await waitFor(() => expect(calls).toContain('GET /api/me/exams'))
    await waitFor(() => expect(container.querySelector('.ant-skeleton')).toBeNull())
    expect(container.querySelector('.hub-finish')).toBeNull()
  })

  it('still shows the exams where the office issues the certificate, and says who issues it', async () => {
    serve({ completion: makeCompletion({ state: 'not_offered' }), exams: [makeOnlineMyExam({ id: 'exam-1' })] })
    renderSection()
    expect(await screen.findByText(finish.states.not_offered)).toBeInTheDocument()
    expect(screen.getByText(ar.takeExam.list.start)).toBeInTheDocument()
  })

  it('offers to try again after a failed read, and hides the section for a caller the server refuses', async () => {
    serve({ completion: jsonResponse(500, { statusCode: 500 }) })
    const failed = renderSection()
    expect(await screen.findByText(finish.loadFailed)).toBeInTheDocument()
    failed.unmount()

    serve({ completion: jsonResponse(403, { statusCode: 403, code: 'permission_denied' }) })
    const { container } = renderSection()
    await waitFor(() => expect(container.querySelector('.ant-skeleton')).toBeNull())
    expect(container.querySelector('.hub-finish')).toBeNull()
  })
})
