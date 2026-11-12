import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ClassCertificates } from '../api/certificates'
import { ar } from '../i18n/ar'
import { CERTIFICATE_ADMIN_PERMISSIONS, CERTIFICATE_ID, CERTIFICATE_READER_PERMISSIONS, CERTIFICATE_STAFF_PERMISSIONS, makeCertificate, makeClassCertificates, makePreviewItem } from '../test/certificates'
import { CLASS_ID, makeClass } from '../test/classes'
import { ENROLLMENT_IDS, STUDENT_IDS, makeEnrollmentStudent } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ClassCertificatesTab } from './ClassCertificatesTab'

const [FIRST, SECOND, THIRD, FOURTH] = [...ENROLLMENT_IDS, '0193c000-0000-7000-8000-00000000a004']

/** Omar eligible, Sara not passed, Huda with a certificate already, Ali stale. */
const preview = makeClassCertificates({
  issuable: 1,
  items: [
    makePreviewItem({ enrollmentId: FIRST }),
    makePreviewItem({
      enrollmentId: SECOND,
      student: makeEnrollmentStudent({ id: STUDENT_IDS[1], fullName: 'سارة علي', fullNameLatin: null }),
      final: { percent: 42, label: { ar: 'راسب' }, letter: 'F', isPass: false, stale: false },
      reason: 'not_passed',
    }),
    makePreviewItem({
      enrollmentId: THIRD,
      student: makeEnrollmentStudent({ id: STUDENT_IDS[2], fullName: 'هدى سالم', fullNameLatin: null }),
      certificate: { id: CERTIFICATE_ID, serial: 'CERT-2026-00007', issuedAt: '2026-12-21T09:30:00.000Z' },
      reason: 'already_issued',
    }),
    makePreviewItem({
      enrollmentId: FOURTH,
      student: makeEnrollmentStudent({ id: 'student-4', fullName: 'علي حسن', fullNameLatin: null }),
      final: { percent: 75, label: { ar: 'جيد' }, letter: 'C', isPass: true, stale: true },
      reason: 'stale',
    }),
  ],
})

interface Options {
  previews?: Array<ClassCertificates | Response>
  issue?: Response
}

/** Serves the preview (one answer per read, the last one repeated) and records the issuing requests. */
function mockCertificatesApi({ previews = [preview], issue }: Options = {}) {
  const posts: unknown[] = []
  let reads = 0
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (url === `/api/classes/${CLASS_ID}/certificates` && method === 'GET') {
      const answer = previews[Math.min(reads, previews.length - 1)]!
      reads += 1
      return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
    }
    if (url === `/api/classes/${CLASS_ID}/certificates` && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)))
      return issue ?? jsonResponse(200, { issued: [makeCertificate()], skipped: [] })
    }
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${method} ${url}` })
  })
  return { posts, reads: () => reads }
}

function renderTab(permissions: string[], status: 'completed' | 'running' = 'completed') {
  return renderWithProviders(<ClassCertificatesTab cls={makeClass({ status, enrolledCount: 4 })} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/classes',
  })
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement
}

function dialog(): HTMLElement {
  return screen.getByText(ar.certificates.classTab.confirmNote).closest('[role="dialog"]') as HTMLElement
}

const issueAllLabel = (count: number) => ar.certificates.classTab.issueAll.replace('{{count}}', String(count))
const issueSelectedLabel = (count: number) => ar.certificates.classTab.issueSelected.replace('{{count}}', String(count))

describe('ClassCertificatesTab', () => {
  it('shows each enrollment with its final grade, its certificate and, in the server’s words, why it is not eligible', async () => {
    mockCertificatesApi()
    renderTab(CERTIFICATE_STAFF_PERMISSIONS)

    expect(await screen.findByText('عمر خالد')).toBeInTheDocument()
    expect(screen.getByTestId('class-certificates-issuable')).toHaveTextContent('قابلة للإصدار الآن: 1')
    expect(within(rowOf('عمر خالد')).getByText(ar.certificates.classTab.eligible)).toBeInTheDocument()
    expect(within(rowOf('عمر خالد')).getByText('86.4%')).toBeInTheDocument()
    expect(within(rowOf('عمر خالد')).getByText('جيد جداً (B)')).toBeInTheDocument()
    expect(within(rowOf('سارة علي')).getByText(ar.certificates.classTab.reasons.not_passed)).toBeInTheDocument()
    expect(within(rowOf('سارة علي')).getByText(ar.certificates.classTab.failed)).toBeInTheDocument()
    expect(within(rowOf('هدى سالم')).getByText(ar.certificates.classTab.reasons.already_issued)).toBeInTheDocument()
    expect(within(rowOf('هدى سالم')).getByText('CERT-2026-00007')).toBeInTheDocument()
    // The issued certificate opens its print page in a new tab.
    const print = within(rowOf('هدى سالم')).getByRole('link', { name: /CERT-2026-00007/ })
    expect(print).toHaveAttribute('href', `/certificates/${CERTIFICATE_ID}/print`)
    expect(print).toHaveAttribute('target', '_blank')
    expect(within(rowOf('علي حسن')).getByText(ar.certificates.classTab.stale)).toBeInTheDocument()
    expect(within(rowOf('علي حسن')).getByText(ar.certificates.classTab.reasons.stale)).toBeInTheDocument()
    // Only the eligible row can be ticked.
    expect(screen.getByLabelText('اختيار عمر خالد')).toBeEnabled()
    expect(screen.getByLabelText('اختيار سارة علي')).toBeDisabled()
    expect(screen.getByText(issueAllLabel(1)).closest('button')).toBeEnabled()
  })

  it('issues for every eligible enrollment behind a confirmation — an empty body — then reports the answer and reads the preview again', async () => {
    const reread = makeClassCertificates({
      issuable: 0,
      items: [makePreviewItem({ certificate: { id: CERTIFICATE_ID, serial: 'CERT-2026-00008', issuedAt: '2026-12-22T09:00:00.000Z' }, reason: 'already_issued' })],
    })
    const api = mockCertificatesApi({ previews: [preview, reread] })
    renderTab(CERTIFICATE_STAFF_PERMISSIONS)
    await screen.findByText('عمر خالد')

    fireEvent.click(screen.getByText(issueAllLabel(1)).closest('button')!)
    expect(within(dialog()).getByText(ar.certificates.classTab.confirmAll.replace('{{count}}', '1'))).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByText(ar.certificates.classTab.confirmOk).closest('button')!)

    await waitFor(() => expect(api.posts).toEqual([{}]))
    expect(await screen.findByText('صدرت الشهادات: 1')).toBeInTheDocument()
    expect(await screen.findByText('CERT-2026-00008')).toBeInTheDocument()
    expect(api.reads()).toBe(2)
    expect(screen.queryByText(ar.certificates.classTab.confirmNote)).not.toBeInTheDocument()
  })

  it('issues only the ticked enrollments, and tells when the server skipped some', async () => {
    const two = makeClassCertificates({ issuable: 2, items: [makePreviewItem({ enrollmentId: FIRST }), makePreviewItem({ enrollmentId: SECOND, student: makeEnrollmentStudent({ id: STUDENT_IDS[1], fullName: 'سارة علي' }) })] })
    const api = mockCertificatesApi({
      previews: [two],
      issue: jsonResponse(200, { issued: [makeCertificate()], skipped: [{ enrollmentId: SECOND, studentId: STUDENT_IDS[1], reason: 'already_issued' }] }),
    })
    renderTab(CERTIFICATE_ADMIN_PERMISSIONS)
    await screen.findByText('سارة علي')
    expect(screen.getByText(issueAllLabel(2))).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('اختيار سارة علي'))
    fireEvent.click(screen.getByText(issueSelectedLabel(1)).closest('button')!)
    expect(within(dialog()).getByText(ar.certificates.classTab.confirmSelected.replace('{{count}}', '1'))).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByText(ar.certificates.classTab.confirmOk).closest('button')!)

    await waitFor(() => expect(api.posts).toEqual([{ enrollmentIds: [SECOND] }]))
    expect(await screen.findByText('صدرت الشهادات: 1، وتُخطّي 1 (الأسباب في الجدول)')).toBeInTheDocument()
  })

  it('explains that a class issues once completed: the eligible wait, and nothing can be issued', async () => {
    const running = makeClassCertificates({ class: { ...preview.class, status: 'running' }, issuable: 0, items: [makePreviewItem({ enrollmentStatus: 'active', reason: 'not_completed' }), makePreviewItem({ enrollmentId: SECOND, student: makeEnrollmentStudent({ id: STUDENT_IDS[1], fullName: 'سارة علي' }) })] })
    mockCertificatesApi({ previews: [running] })
    renderTab(CERTIFICATE_STAFF_PERMISSIONS, 'running')

    expect(await screen.findByText('تُصدر الشهادات لفصل مكتمل فقط، وهذا الفصل «جارٍ» الآن؛ تعرض المعاينة الأهلية دون إصدار.')).toBeInTheDocument()
    expect(within(rowOf('عمر خالد')).getByText(ar.certificates.classTab.reasons.not_completed)).toBeInTheDocument()
    expect(within(rowOf('سارة علي')).getByText(ar.certificates.classTab.eligibleLater)).toBeInTheDocument()
    expect(screen.getByText(issueAllLabel(0)).closest('button')).toBeDisabled()
    expect(screen.queryByLabelText('اختيار عمر خالد')).not.toBeInTheDocument()
  })

  it('shows a reader without certificates.issue the preview only', async () => {
    mockCertificatesApi()
    renderTab(CERTIFICATE_READER_PERMISSIONS)

    expect(await screen.findByText('عمر خالد')).toBeInTheDocument()
    expect(screen.getByText(ar.certificates.classTab.readOnlyHint)).toBeInTheDocument()
    expect(screen.queryByText(issueAllLabel(1))).not.toBeInTheDocument()
    expect(screen.queryByLabelText('اختيار عمر خالد')).not.toBeInTheDocument()
  })

  it('closes the dialog and reads the preview again when the class is no longer completed (stale), and keeps it with the message on a server error', async () => {
    const api = mockCertificatesApi({
      issue: jsonResponse(409, { statusCode: 409, code: 'class_not_completed', classId: CLASS_ID, status: 'running', message: 'no' }),
    })
    renderTab(CERTIFICATE_STAFF_PERMISSIONS)
    await screen.findByText('عمر خالد')

    fireEvent.click(screen.getByText(issueAllLabel(1)).closest('button')!)
    fireEvent.click(within(dialog()).getByText(ar.certificates.classTab.confirmOk).closest('button')!)
    expect(await screen.findByText(ar.certificates.errors.class_not_completed)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(ar.certificates.classTab.confirmNote)).not.toBeInTheDocument())
    await waitFor(() => expect(api.reads()).toBe(2))
  })

  it('keeps the dialog open with the message when the issue fails for a retryable reason', async () => {
    mockCertificatesApi({ issue: jsonResponse(500, { statusCode: 500, message: 'boom' }) })
    renderTab(CERTIFICATE_STAFF_PERMISSIONS)
    await screen.findByText('عمر خالد')

    fireEvent.click(screen.getByText(issueAllLabel(1)).closest('button')!)
    fireEvent.click(within(dialog()).getByText(ar.certificates.classTab.confirmOk).closest('button')!)
    expect(await within(dialog()).findByText(ar.login.errors.server)).toBeInTheDocument()
  })

  it('says why the preview could not be read, with a retry', async () => {
    const api = mockCertificatesApi({ previews: [jsonResponse(403, { statusCode: 403, code: 'permission_denied', missing: ['certificates.read_all', 'certificates.issue'], message: 'no' }), preview] })
    renderTab(CERTIFICATE_STAFF_PERMISSIONS)

    expect(await screen.findByText(ar.certificates.classTab.loadFailed)).toBeInTheDocument()
    expect(screen.getByText('ليست لديك الصلاحية اللازمة لهذا الإجراء (certificates.read_all, certificates.issue)')).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.certificates.refresh).closest('button')!)
    expect(await screen.findByText('عمر خالد')).toBeInTheDocument()
    expect(api.reads()).toBe(2)
  })
})
