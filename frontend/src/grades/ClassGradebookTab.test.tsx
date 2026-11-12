// The «grades» tab of the class drawer (J-F49 — MOD-09-T08 part c, API-126..API-128),
// rendered on its own; the drawer's gating by permission is in ClassDrawer.gradebook.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Gradebook } from '../api/gradebook'
import type { GradeScheme } from '../api/gradeSchemes'
import { ar } from '../i18n/ar'
import { CLASS_ID, makeClass } from '../test/classes'
import { GRADE_SCHEME_IDS, THREE_GRADE_SCHEMES, makeGradeScheme } from '../test/gradeSchemes'
import { GRADEBOOK_READER_PERMISSIONS, GRADEBOOK_TEACHER_PERMISSIONS, finalizedGradebook, fullGradebook, readyGradebook } from '../test/gradebook'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { formatDateTime } from '../users/users.format'
import { ClassGradebookTab } from './ClassGradebookTab'

const GRADEBOOK_PATH = `/api/classes/${CLASS_ID}/gradebook`
const FINAL_GRADES_PATH = `/api/classes/${CLASS_ID}/final-grades`
const CLASS_NAME = 'بايثون — الفصل أ'

interface Call {
  method: string
  path: string
  body: unknown
}

type Answer = Response | Promise<Response>

interface GradebookApi {
  /** Each read of API-126 in turn (the last one repeats). */
  reads: Array<Gradebook | (() => Answer)>
  /** Each read of API-122 in turn (the last one repeats). */
  schemes?: Array<GradeScheme[] | (() => Answer)>
  /** POST / DELETE of API-127/API-128. */
  write?: (method: string, body: unknown) => Answer
}

function mockGradebookApi({ reads, schemes = [THREE_GRADE_SCHEMES()], write }: GradebookApi) {
  const calls: Call[] = []
  let read = 0
  let schemeRead = 0
  const answer = (entry: unknown): Answer => (typeof entry === 'function' ? (entry as () => Answer)() : jsonResponse(200, entry))
  mockFetch((url, init) => {
    const path = new URL(url, 'http://localhost').pathname
    const method = init?.method ?? 'GET'
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET' && path === GRADEBOOK_PATH) return answer(reads[Math.min(read++, reads.length - 1)])
    if (method === 'GET' && path === '/api/grade-schemes') {
      const entry = schemes[Math.min(schemeRead++, schemes.length - 1)]
      return Array.isArray(entry) ? jsonResponse(200, { items: entry }) : answer(entry)
    }
    if (path === FINAL_GRADES_PATH && write) return write(method, init?.body ? JSON.parse(String(init.body)) : undefined)
    return jsonResponse(500, { statusCode: 500, message: `unexpected ${method} ${path}` })
  })
  return {
    calls,
    gradebookReads: () => calls.filter((call) => call.method === 'GET' && call.path === GRADEBOOK_PATH).length,
    schemeReads: () => calls.filter((call) => call.method === 'GET' && call.path === '/api/grade-schemes').length,
    writes: () => calls.filter((call) => call.method !== 'GET'),
  }
}

function renderTab(permissions: string[] = GRADEBOOK_TEACHER_PERMISSIONS, status: 'running' | 'completed' | 'open' = 'running') {
  return renderWithProviders(<ClassGradebookTab cls={makeClass({ status })} />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/classes' })
}

const refusal = (status: number, body: Record<string, unknown>) => jsonResponse(status, { statusCode: status, message: 'refused', ...body })
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
/** A component's column header — in the table head: the table's hidden measure row renders the titles a second time. */
const headerOf = (index: number) => within(document.querySelector('.ant-table-thead') as HTMLElement).getByTestId(`gradebook-component-${fullGradebook().components[index]!.id}`)
const buttonIn = (container: HTMLElement, text: string) => within(container).getByText(text).closest('button') as HTMLButtonElement
const tabButton = (text: string) => buttonIn(screen.getByTestId('class-gradebook'), text)

async function openFinalizeDialog(title = `تثبيت الدرجات النهائية — ${CLASS_NAME}`) {
  fireEvent.click(tabButton(ar.gradebook.finalize.action))
  const dialog = (await screen.findByText(title)).closest('[role="dialog"]') as HTMLElement
  // OK waits for the scheme list (API-122).
  await waitFor(() => expect(buttonIn(dialog, ar.gradebook.finalize.ok)).toBeEnabled())
  return dialog
}

describe('ClassGradebookTab (J-F49 — MOD-09-T08 part c, API-126..API-128)', () => {
  it('shows the gradebook exactly as the server sends it: every component, every cell state, the percentages, the final grades and the readiness', async () => {
    const api = mockGradebookApi({ reads: [fullGradebook()] })
    renderTab()
    expect(await screen.findByText('سارة الطالبة')).toBeInTheDocument()

    // A column per component, assignments then exams, with kind, status, weight, maximum and late penalty — an unweighted one informational.
    const homework = headerOf(0)
    expect(within(homework).getByText('واجب الدوال')).toBeInTheDocument()
    expect(within(homework).getByText('واجب')).toBeInTheDocument()
    expect(within(homework).getByText('مغلق')).toBeInTheDocument()
    expect(within(homework).getByText('الوزن 20 · من 20 · خصم التأخير 10%')).toBeInTheDocument()
    expect(within(headerOf(1)).getByText('مفتوح')).toBeInTheDocument()
    expect(within(headerOf(2)).getByText('للعلم — بلا وزن · من 10')).toBeInTheDocument()
    const exam = headerOf(3)
    expect(within(exam).getByText('اختبار')).toBeInTheDocument()
    expect(within(exam).getByText('منشور')).toBeInTheDocument()
    expect(within(exam).getByText('الوزن 50 · من 50')).toBeInTheDocument()

    // Sara: the late homework after the penalty and before it; her fixed grade.
    const sara = rowOf('سارة الطالبة')
    expect(within(sara).getByText('16.2')).toBeInTheDocument()
    expect(within(sara).getByText('18 قبل الخصم')).toBeInTheDocument()
    expect(within(sara).getByText(ar.gradebook.cell.late)).toBeInTheDocument()
    expect(within(sara).getByText('41.5')).toBeInTheDocument()
    expect(within(sara).getAllByText('84.7%')).toHaveLength(3)
    expect(within(sara).getByText('جيد جداً')).toBeInTheDocument()
    expect(within(sara).getByText('(B)')).toBeInTheDocument()
    expect(within(sara).getByText(ar.gradebook.final.pass)).toBeInTheDocument()
    expect(within(sara).getByText('ثبّتها خالد المعلم')).toBeInTheDocument()
    expect(within(sara).getByText(formatDateTime('2026-11-10T12:00:00.000Z', 'ar'))).toBeInTheDocument()

    // Yousef: waiting for review (the earlier graded 12 stays), sent back, not submitted, absent as 0; nothing fixed.
    const yousef = rowOf('يوسف الطالب')
    expect(within(yousef).getByText('يوسف')).toBeInTheDocument()
    expect(within(yousef).getByText('12')).toBeInTheDocument()
    expect(within(yousef).getByText(ar.gradebook.cell.status.awaiting_review)).toBeInTheDocument()
    expect(within(yousef).getByText(ar.gradebook.cell.status.returned)).toBeInTheDocument()
    expect(within(yousef).getByText(ar.gradebook.cell.status.missing_assignment)).toBeInTheDocument()
    expect(within(yousef).getByText(ar.gradebook.cell.status.absent)).toBeInTheDocument()
    expect(within(yousef).getByText('0')).toBeInTheDocument()
    expect(within(yousef).getByText('17.14%')).toBeInTheDocument()
    expect(within(yousef).getByText('12%')).toBeInTheDocument()
    expect(within(yousef).getByText(ar.gradebook.final.none)).toBeInTheDocument()

    // Layla: excused from the exam; a failing final grade that is stale, fixed by a since-deleted account.
    const layla = rowOf('ليلى الطالبة')
    expect(within(layla).getByText(ar.gradebook.cell.status.excused)).toBeInTheDocument()
    expect(within(layla).getByText('80%')).toBeInTheDocument()
    expect(within(layla).getByText('48%')).toBeInTheDocument()
    expect(within(layla).getByText('52%')).toBeInTheDocument()
    expect(within(layla).getByText('ضعيف')).toBeInTheDocument()
    expect(within(layla).getByText('(E)')).toBeInTheDocument()
    expect(within(layla).getByText(ar.gradebook.final.fail)).toBeInTheDocument()
    expect(within(layla).getByText(ar.gradebook.final.stale)).toBeInTheDocument()
    expect(within(layla).getByText(ar.gradebook.final.byUnknown)).toBeInTheDocument()

    // Omar: a completed enrollment of a deleted account.
    const omar = rowOf('عمر الخريج')
    expect(within(omar).getByText(ar.gradebook.student.completed)).toBeInTheDocument()
    expect(within(omar).getByText(ar.gradebook.student.deleted)).toBeInTheDocument()
    expect(within(omar).getAllByText('100%')).toHaveLength(2)

    // The readiness as the server counted it, the default scheme, the stale warning.
    const readiness = screen.getByTestId('gradebook-readiness')
    expect(screen.getByText(ar.gradebook.readiness.notReady)).toBeInTheDocument()
    expect(within(readiness).getByText('حالة الفصل «جارٍ»')).toBeInTheDocument()
    expect(within(readiness).getByText('المكوّنات الموزونة: 3')).toBeInTheDocument()
    expect(within(readiness).getByText('واجبات موزونة ما زالت مفتوحة: 1 — تُغلق قبل التثبيت')).toBeInTheDocument()
    expect(within(readiness).getByText('محاولات بانتظار المراجعة: 1 — تُصحَّح أو تُعاد قبل التثبيت')).toBeInTheDocument()
    expect(within(readiness).getByText(ar.gradebook.readiness.ok.unpublishedExams)).toBeInTheDocument()
    expect(screen.getByText('السلّم الافتراضي للتثبيت: السلّم الافتراضي')).toBeInTheDocument()
    expect(screen.getByText(ar.gradebook.staleAlert)).toBeInTheDocument()

    // Not ready: «fix again» (grades exist) is disabled; withdrawing is offered.
    expect(tabButton(ar.gradebook.finalize.actionAgain)).toBeDisabled()
    expect(tabButton(ar.gradebook.withdraw.action)).toBeEnabled()
    expect(api.gradebookReads()).toBe(1)
    expect(api.writes()).toEqual([])
  })

  it('offers the finalization once the server says ready; a class that is not running or completed blocks it with its status', async () => {
    mockGradebookApi({ reads: [readyGradebook()] })
    const { unmount } = renderTab()
    expect(await screen.findByText(ar.gradebook.readiness.ready)).toBeInTheDocument()
    expect(screen.getByText(ar.gradebook.readiness.ok.openAssignments)).toBeInTheDocument()
    expect(screen.getByText(ar.gradebook.readiness.ok.awaitingReview)).toBeInTheDocument()
    expect(tabButton(ar.gradebook.finalize.action)).toBeEnabled()
    // Nothing fixed yet: nothing to withdraw.
    expect(screen.queryByText(ar.gradebook.withdraw.action)).not.toBeInTheDocument()
    unmount()

    mockGradebookApi({ reads: [readyGradebook({ class: { ...readyGradebook().class, status: 'open' } })] })
    renderTab(GRADEBOOK_TEACHER_PERMISSIONS, 'open')
    expect(await screen.findByText('تُثبَّت الدرجات النهائية لفصل جارٍ أو مكتمل، والفصل الآن «مفتوح»')).toBeInTheDocument()
    expect(screen.getByText(ar.gradebook.readiness.notReady)).toBeInTheDocument()
    expect(tabButton(ar.gradebook.finalize.action)).toBeDisabled()
  })

  it('names a class without any weighted component and its unpublished exams', async () => {
    mockGradebookApi({ reads: [readyGradebook({ readiness: { openAssignments: 0, awaitingReview: 0, unpublishedExams: 2, weightedComponents: 0, ready: false } })] })
    renderTab()
    const readiness = await screen.findByTestId('gradebook-readiness')
    expect(within(readiness).getByText(ar.gradebook.readiness.blocked.weightedComponents)).toBeInTheDocument()
    expect(within(readiness).getByText('اختبارات موزونة لم تُنشر: 2 — تُنشر قبل التثبيت')).toBeInTheDocument()
    expect(tabButton(ar.gradebook.finalize.action)).toBeDisabled()
  })

  it('is read-only without grades.manage: no finalize, no withdraw, and the stale warning says who fixes it', async () => {
    const api = mockGradebookApi({ reads: [fullGradebook()] })
    renderTab(GRADEBOOK_READER_PERMISSIONS)
    expect(await screen.findByText('سارة الطالبة')).toBeInTheDocument()
    expect(screen.getByText(ar.gradebook.readOnly)).toBeInTheDocument()
    expect(screen.getByText(ar.gradebook.staleAlertReadOnly)).toBeInTheDocument()
    expect(screen.queryByText(ar.gradebook.finalize.actionAgain)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.gradebook.withdraw.action)).not.toBeInTheDocument()
    expect(api.writes()).toEqual([])
  })

  it('says the gradebook is not available on 404 and reads it again on request', async () => {
    const api = mockGradebookApi({ reads: [() => refusal(404, { code: 'class_not_found', classId: CLASS_ID }), readyGradebook()] })
    renderTab()
    expect(await screen.findByText(ar.gradebook.unavailable.title)).toBeInTheDocument()
    expect(screen.getByText(ar.gradebook.unavailable.body)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(tabButton(ar.gradebook.retry))
    expect(await screen.findByText('سارة الطالبة')).toBeInTheDocument()
    expect(api.gradebookReads()).toBe(2)
  })

  it('reads the gradebook again when the drawer’s class changes', async () => {
    const api = mockGradebookApi({ reads: [readyGradebook(), readyGradebook({ class: { ...readyGradebook().class, status: 'completed' } })] })
    const view = renderTab()
    expect(await screen.findByText('حالة الفصل «جارٍ»')).toBeInTheDocument()
    view.rerender(<ClassGradebookTab cls={makeClass({ status: 'completed', updatedAt: '2026-11-12T09:00:00.000Z' })} />)
    expect(await screen.findByText('حالة الفصل «مكتمل»')).toBeInTheDocument()
    expect(api.gradebookReads()).toBe(2)
  })

  describe('finalize (API-127)', () => {
    it('finalizes with the default scheme preselected among the active ones and shows the answer without another read', async () => {
      const api = mockGradebookApi({ reads: [readyGradebook()], write: () => jsonResponse(200, finalizedGradebook()) })
      renderTab()
      await screen.findByText('سارة الطالبة')
      const dialog = await openFinalizeDialog()
      expect(within(dialog).getByText(ar.gradebook.finalize.body)).toBeInTheDocument()
      expect(within(dialog).getByText(`السلّم الافتراضي — ${ar.gradebook.finalize.defaultTag}`)).toBeInTheDocument()
      // The chosen scheme's bands, from their minimum.
      const bands = within(dialog).getByTestId('finalize-scheme-bands')
      expect(within(bands).getByText('ممتاز')).toBeInTheDocument()

      fireEvent.click(buttonIn(dialog, ar.gradebook.finalize.ok))
      expect(await screen.findByText(ar.gradebook.finalize.done)).toBeInTheDocument()
      expect(api.writes()).toEqual([{ method: 'POST', path: FINAL_GRADES_PATH, body: { schemeId: GRADE_SCHEME_IDS[0] } }])
      // The server's answer, as it came: Omar's grade fixed at 100 (A).
      expect(within(rowOf('عمر الخريج')).getByText('ممتاز')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByText(`تثبيت الدرجات النهائية — ${CLASS_NAME}`)).not.toBeInTheDocument())
      expect(tabButton(ar.gradebook.finalize.actionAgain)).toBeEnabled()
      expect(tabButton(ar.gradebook.withdraw.action)).toBeEnabled()
      expect(api.gradebookReads()).toBe(1)
      expect(api.schemeReads()).toBe(1)
    })

    it('finalizes with another active scheme; an inactive one is not offered', async () => {
      const api = mockGradebookApi({ reads: [readyGradebook()], write: () => jsonResponse(200, finalizedGradebook(GRADE_SCHEME_IDS[1])) })
      renderTab()
      await screen.findByText('سارة الطالبة')
      const dialog = await openFinalizeDialog()
      fireEvent.mouseDown(within(dialog).getByLabelText(ar.gradebook.finalize.scheme))
      await screen.findByText('ناجح أو راسب', { selector: '.ant-select-item-option-content' })
      expect(screen.queryByText('السلّم القديم', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByText('ناجح أو راسب', { selector: '.ant-select-item-option-content' }))
      fireEvent.click(buttonIn(dialog, ar.gradebook.finalize.ok))
      expect(await screen.findByText(ar.gradebook.finalize.done)).toBeInTheDocument()
      expect(api.writes()).toEqual([{ method: 'POST', path: FINAL_GRADES_PATH, body: { schemeId: GRADE_SCHEME_IDS[1] } }])
    })

    it('explains an empty scheme list and offers nothing to send; the settings link only for a holder of academy.settings.manage', async () => {
      const inactive = [makeGradeScheme({ isDefault: false, isActive: false })]
      mockGradebookApi({ reads: [readyGradebook()], schemes: [inactive] })
      const { unmount } = renderTab()
      await screen.findByText('سارة الطالبة')
      fireEvent.click(tabButton(ar.gradebook.finalize.action))
      const dialog = (await screen.findByText(`تثبيت الدرجات النهائية — ${CLASS_NAME}`)).closest('[role="dialog"]') as HTMLElement
      expect(await within(dialog).findByText(ar.gradebook.finalize.noSchemes)).toBeInTheDocument()
      expect(within(dialog).getByText(ar.gradebook.finalize.askForSchemes)).toBeInTheDocument()
      expect(buttonIn(dialog, ar.gradebook.finalize.ok)).toBeDisabled()
      unmount()

      mockGradebookApi({ reads: [readyGradebook()], schemes: [[]] })
      renderTab([...GRADEBOOK_TEACHER_PERMISSIONS, 'academy.settings.manage'])
      await screen.findByText('سارة الطالبة')
      fireEvent.click(tabButton(ar.gradebook.finalize.action))
      const link = await screen.findByText(ar.gradebook.finalize.openSchemes)
      expect(link.closest('a')).toHaveAttribute('href', '/settings/grade-schemes')
    })

    const STALE_REFUSALS: Array<[string, Record<string, unknown>, string]> = [
      ['grades_not_ready', { code: 'grades_not_ready', openAssignments: 1, awaitingReview: 0, unpublishedExams: 2, weightedComponents: 3 }, 'لا يُقبل التثبيت بعد: 1 واجب موزون مفتوح، 2 اختبار موزون غير منشور.'],
      ['no_weighted_components', { code: 'grades_not_ready', openAssignments: 0, awaitingReview: 0, unpublishedExams: 0, weightedComponents: 0, reason: 'no_weighted_components' }, ar.gradebook.errors.grades_not_ready_no_weighted_components],
      ['class_not_gradable', { code: 'class_not_gradable', classId: CLASS_ID, status: 'cancelled' }, 'لا تُثبَّت الدرجات النهائية إلا لفصل جارٍ أو مكتمل، والفصل الآن «ملغى».'],
      ['grade_scheme_missing', { code: 'grade_scheme_missing' }, ar.gradebook.errors.grade_scheme_missing],
      ['grades_certified', { code: 'grades_certified', classId: CLASS_ID, certificateCount: 2 }, 'للفصل 2 شهادة سارية: لا تُثبَّت درجاته النهائية ولا تُسحب حتى تُبطَل شهاداته.'],
    ]

    it.each(STALE_REFUSALS)('closes the dialog on %s, says why above the table and reads the gradebook again', async (_name, body, text) => {
      const api = mockGradebookApi({ reads: [readyGradebook()], write: () => refusal(409, body) })
      renderTab()
      await screen.findByText('سارة الطالبة')
      const dialog = await openFinalizeDialog()
      fireEvent.click(buttonIn(dialog, ar.gradebook.finalize.ok))
      expect(await screen.findByText(text)).toBeInTheDocument()
      await waitFor(() => expect(api.gradebookReads()).toBe(2))
      expect(screen.queryByText(`تثبيت الدرجات النهائية — ${CLASS_NAME}`)).not.toBeInTheDocument()
      expect(within(screen.getByTestId('class-gradebook')).getByText(text)).toBeInTheDocument()
    })

    it('keeps the dialog open when the chosen scheme went away, re-reads the schemes and finalizes with the default', async () => {
      const api = mockGradebookApi({
        reads: [readyGradebook()],
        schemes: [THREE_GRADE_SCHEMES(), [makeGradeScheme()]],
        write: (_method, body) =>
          (body as { schemeId: string }).schemeId === GRADE_SCHEME_IDS[1] ? refusal(404, { code: 'grade_scheme_not_found', schemeId: GRADE_SCHEME_IDS[1] }) : jsonResponse(200, finalizedGradebook()),
      })
      renderTab()
      await screen.findByText('سارة الطالبة')
      const dialog = await openFinalizeDialog()
      fireEvent.mouseDown(within(dialog).getByLabelText(ar.gradebook.finalize.scheme))
      fireEvent.click(await screen.findByText('ناجح أو راسب', { selector: '.ant-select-item-option-content' }))
      fireEvent.click(buttonIn(dialog, ar.gradebook.finalize.ok))
      expect(await within(dialog).findByText(ar.gradebook.errors.grade_scheme_not_found)).toBeInTheDocument()
      await waitFor(() => expect(api.schemeReads()).toBe(2))
      // The vanished scheme is no longer chosen: the default is.
      await waitFor(() => expect(within(dialog).getByText(`السلّم الافتراضي — ${ar.gradebook.finalize.defaultTag}`)).toBeInTheDocument())
      await waitFor(() => expect(buttonIn(dialog, ar.gradebook.finalize.ok)).toBeEnabled())
      await waitFor(() => expect(dialog.querySelector('.ant-btn-loading')).toBeNull())
      fireEvent.click(buttonIn(dialog, ar.gradebook.finalize.ok))
      expect(await screen.findByText(ar.gradebook.finalize.done)).toBeInTheDocument()
      expect(api.writes().map((call) => call.body)).toEqual([{ schemeId: GRADE_SCHEME_IDS[1] }, { schemeId: GRADE_SCHEME_IDS[0] }])
      expect(api.gradebookReads()).toBe(1)
    })

    it('shows the «not available» state when the class went out of reach', async () => {
      const api = mockGradebookApi({ reads: [readyGradebook(), () => refusal(404, { code: 'class_not_found', classId: CLASS_ID })], write: () => refusal(404, { code: 'class_not_found', classId: CLASS_ID }) })
      renderTab()
      await screen.findByText('سارة الطالبة')
      const dialog = await openFinalizeDialog()
      fireEvent.click(buttonIn(dialog, ar.gradebook.finalize.ok))
      expect(await screen.findByText(ar.gradebook.unavailable.title)).toBeInTheDocument()
      expect(api.gradebookReads()).toBe(2)
      expect(screen.queryByText(`تثبيت الدرجات النهائية — ${CLASS_NAME}`)).not.toBeInTheDocument()
    })

    it('keeps the dialog open with the message when the request can be retried (network, permission)', async () => {
      let attempt = 0
      const api = mockGradebookApi({
        reads: [readyGradebook()],
        write: () => (attempt++ === 0 ? Promise.reject(new TypeError('Failed to fetch')) : refusal(403, { code: 'permission_denied', missing: ['grades.manage'] })),
      })
      renderTab()
      await screen.findByText('سارة الطالبة')
      const dialog = await openFinalizeDialog()
      fireEvent.click(buttonIn(dialog, ar.gradebook.finalize.ok))
      expect(await within(dialog).findByText(ar.login.errors.network)).toBeInTheDocument()
      await waitFor(() => expect(dialog.querySelector('.ant-btn-loading')).toBeNull())
      fireEvent.click(buttonIn(dialog, ar.gradebook.finalize.ok))
      expect(await within(dialog).findByText('ليست لديك الصلاحية اللازمة لهذا الإجراء (grades.manage)')).toBeInTheDocument()
      expect(api.gradebookReads()).toBe(1)
      expect(api.writes()).toHaveLength(2)
    })

    it('drops a read still running when the finalization answers, so the newer state stays', async () => {
      let release: (response: Response) => void = () => {}
      const slowRead = () => new Promise<Response>((resolve) => (release = resolve))
      const api = mockGradebookApi({ reads: [readyGradebook(), slowRead], write: () => jsonResponse(200, finalizedGradebook()) })
      renderTab()
      await screen.findByText('سارة الطالبة')
      fireEvent.click(tabButton(ar.gradebook.refresh))
      await waitFor(() => expect(api.gradebookReads()).toBe(2))
      const dialog = await openFinalizeDialog()
      fireEvent.click(buttonIn(dialog, ar.gradebook.finalize.ok))
      expect(await screen.findByText(ar.gradebook.finalize.done)).toBeInTheDocument()
      expect(within(rowOf('عمر الخريج')).getByText('ممتاز')).toBeInTheDocument()
      // The read started before the write now answers with the older state: it was dropped.
      release(jsonResponse(200, readyGradebook()))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(within(rowOf('عمر الخريج')).getByText('ممتاز')).toBeInTheDocument()
      expect(screen.getByTestId('class-gradebook').querySelector('.ant-spin-spinning')).toBeNull()
    })
  })

  describe('withdraw (API-128)', () => {
    it('withdraws behind its confirmation and shows the answer without another read', async () => {
      const api = mockGradebookApi({ reads: [finalizedGradebook()], write: () => jsonResponse(200, readyGradebook()) })
      renderTab()
      await screen.findByText('سارة الطالبة')
      fireEvent.click(tabButton(ar.gradebook.withdraw.action))
      const dialog = (await screen.findByText(`سحب الدرجات النهائية — ${CLASS_NAME}`)).closest('[role="dialog"]') as HTMLElement
      expect(within(dialog).getByText(ar.gradebook.withdraw.body)).toBeInTheDocument()
      fireEvent.click(buttonIn(dialog, ar.gradebook.withdraw.ok))
      expect(await screen.findByText(ar.gradebook.withdraw.done)).toBeInTheDocument()
      expect(api.writes()).toEqual([{ method: 'DELETE', path: FINAL_GRADES_PATH, body: undefined }])
      expect(within(rowOf('عمر الخريج')).getByText(ar.gradebook.final.none)).toBeInTheDocument()
      expect(screen.queryByText(ar.gradebook.withdraw.action)).not.toBeInTheDocument()
      expect(api.gradebookReads()).toBe(1)
    })

    it('says a certified class keeps its grades and reads the gradebook again', async () => {
      const api = mockGradebookApi({ reads: [finalizedGradebook()], write: () => refusal(409, { code: 'grades_certified', classId: CLASS_ID, certificateCount: 1 }) })
      renderTab()
      await screen.findByText('سارة الطالبة')
      fireEvent.click(tabButton(ar.gradebook.withdraw.action))
      const dialog = (await screen.findByText(`سحب الدرجات النهائية — ${CLASS_NAME}`)).closest('[role="dialog"]') as HTMLElement
      fireEvent.click(buttonIn(dialog, ar.gradebook.withdraw.ok))
      expect(await screen.findByText('للفصل 1 شهادة سارية: لا تُثبَّت درجاته النهائية ولا تُسحب حتى تُبطَل شهاداته.')).toBeInTheDocument()
      await waitFor(() => expect(api.gradebookReads()).toBe(2))
      expect(screen.queryByText(`سحب الدرجات النهائية — ${CLASS_NAME}`)).not.toBeInTheDocument()
    })
  })
})
