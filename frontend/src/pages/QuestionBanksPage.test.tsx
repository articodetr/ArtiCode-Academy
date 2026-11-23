// The question banks page (MOD-09 phase 2 — OEX-T07, API-260..API-269): the banks the server returns, their filters
// and pages, the bank form, the questions of the bank chosen with their filters and row actions, and every refusal
// in words. Every number on screen is the server's.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Question, QuestionBank } from '../api/questionBanks'
import { ar } from '../i18n/ar'
import { COURSE_ID, makeCourse, makeCourseList } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import {
  BANK_ID,
  BANK_IDS,
  QUESTION_ADMIN_PERMISSIONS,
  QUESTION_ID,
  QUESTION_IDS,
  QUESTION_TEACHER_PERMISSIONS,
  THREE_BANKS,
  makeBank,
  makeBankList,
  makeDraftQuestion,
  makeOption,
  makeQuestion,
  makeQuestionList,
  makeTrueFalseQuestion,
} from '../test/questionBanks'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { formatDateTime } from '../users/users.format'
import { QuestionBanksPage } from './QuestionBanksPage'

const words = ar.questionBanks
const NEW_BANK_ID = '0194a000-0000-7000-8000-00000000a009'

interface Call {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
}

interface ApiState {
  banks: QuestionBank[] | Response
  banksCursor: string | null
  questions: Question[] | Response
  questionsCursor: string | null
  /** Answers a write; undefined = an unexpected write (500). */
  write: (call: Call) => Response | undefined
}

/**
 * The API as the page reads it: the banks list, one bank (from the same state — the re-read after a write), the
 * questions list, one question (from the same state — the re-read before its editor opens), the courses of the
 * picker; every request is recorded, every write answered by `state.write`.
 */
function mockApi(initial: Partial<ApiState> = {}) {
  const state: ApiState = { banks: THREE_BANKS(), banksCursor: null, questions: [], questionsCursor: null, write: () => undefined, ...initial }
  const calls: Call[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    const call: Call = { method, path: parsed.pathname, query: parsed.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    if (method !== 'GET') return state.write(call) ?? jsonResponse(500, { statusCode: 500, message: 'unexpected write' })
    if (call.path === '/api/question-banks') return state.banks instanceof Response ? state.banks.clone() : jsonResponse(200, makeBankList(state.banks, state.banksCursor))
    if (call.path.startsWith('/api/question-banks/')) {
      const bank = Array.isArray(state.banks) ? state.banks.find((item) => call.path.endsWith(item.id)) : undefined
      return bank ? jsonResponse(200, bank) : jsonResponse(404, { statusCode: 404, code: 'question_bank_not_found', message: 'gone' })
    }
    if (call.path === '/api/questions') return state.questions instanceof Response ? state.questions.clone() : jsonResponse(200, makeQuestionList(state.questions, state.questionsCursor))
    if (call.path.startsWith('/api/questions/')) {
      const question = Array.isArray(state.questions) ? state.questions.find((item) => call.path.endsWith(item.id)) : undefined
      return question ? jsonResponse(200, question) : jsonResponse(404, { statusCode: 404, code: 'question_not_found', message: 'gone' })
    }
    if (call.path === '/api/courses') return jsonResponse(200, makeCourseList([makeCourse({ status: 'published' })]))
    return jsonResponse(404, { statusCode: 404, message: 'not found' })
  })
  return { calls, state }
}

function renderPage(permissions: string[] = QUESTION_TEACHER_PERMISSIONS) {
  return renderWithProviders(<QuestionBanksPage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/question-banks' })
}

const banksCard = () => screen.getByTestId('question-banks-card')
const questionsCard = () => screen.getByTestId('questions-card')
const button = (container: HTMLElement, text: string) => within(container).getByText(text).closest('button')!
const rowOf = (card: HTMLElement, text: string) => within(card).getByText(text).closest('tr') as HTMLElement
const getsOf = (calls: Call[], path: string) => calls.filter((call) => call.method === 'GET' && call.path === path)
const writesOf = (calls: Call[]) => calls.filter((call) => call.method !== 'GET').map((call) => ({ method: call.method, path: call.path, body: call.body }))
const lastQuery = (calls: Call[], path: string) => Object.fromEntries(getsOf(calls, path).at(-1)!.query)
const pressEnter = (input: HTMLElement) => fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 })
const option = (text: string) => screen.findByText(text, { selector: '.ant-select-item-option-content' })

function bodyRows(card: HTMLElement) {
  const [, ...rows] = within(within(card).getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

async function findDialog(title: string) {
  return (await screen.findByText(title)).closest('[role="dialog"]') as HTMLElement
}

/** Confirms the latest popup with this title (an answered one lingers in jsdom). */
async function confirmPopup(title: string, okText: string) {
  const titles = await screen.findAllByText(title)
  fireEvent.click(button(titles[titles.length - 1]!.closest('.ant-popover') as HTMLElement, okText))
}

/** The editor's drawer once it is on screen (its «new question» title is also the text of the button that opens it). */
async function findEditor() {
  return waitFor(() => {
    const drawer = document.querySelector<HTMLElement>('.ant-drawer-content-wrapper')
    if (!drawer) throw new Error('the editor is not open')
    return drawer
  })
}

const editorIsClosed = () => document.querySelector('.ant-drawer-content-wrapper') === null

/** Shows the questions of «بنك بايثون» through its row button and waits for the list. */
async function openPythonBank() {
  fireEvent.click(await screen.findByLabelText(`${words.banks.actions.questions}: بنك بايثون`))
  return screen.findByText('أسئلة البنك «بنك بايثون»')
}

describe('QuestionBanksPage — the banks', () => {
  it('lists the banks the server returns — name, course, the server’s counts, author, last update — and never filters by owner', async () => {
    const { calls } = mockApi()
    renderPage()

    expect(await screen.findByText('بنك بايثون')).toBeInTheDocument()
    // One request, with the page size only: the visibility is the server's.
    expect(Object.fromEntries(getsOf(calls, '/api/question-banks')[0]!.query)).toEqual({ limit: '20' })
    const rows = bodyRows(banksCard())
    expect(rows).toHaveLength(3)
    const python = within(rows[0]!)
    expect(python.getByText('أسئلة أساسيات اللغة')).toBeInTheDocument()
    expect(python.getByText('PY-101')).toBeInTheDocument()
    expect(python.getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(python.getByText('12 سؤالاً')).toBeInTheDocument()
    expect(python.getByText('الجاهز منها: 9')).toBeInTheDocument()
    expect(python.getByText('خالد المعلم')).toBeInTheDocument()
    expect(python.getByText(formatDateTime(makeBank().updatedAt, 'ar'))).toBeInTheDocument()
    // A bank filed under no course; a bank whose author is gone and which holds no question.
    const general = within(rows[1]!)
    expect(general.getByText('أسئلة عامة')).toBeInTheDocument()
    expect(general.getByText(words.banks.noCourse)).toBeInTheDocument()
    expect(general.getByText('سؤالان')).toBeInTheDocument()
    expect(general.getByText('الجاهز منها: 0')).toBeInTheDocument()
    const old = within(rows[2]!)
    expect(old.getByText(words.banks.deletedAuthor)).toBeInTheDocument()
    expect(old.getByText('لا أسئلة')).toBeInTheDocument()
    // A teacher is told what they see; no bank is chosen yet, so no question is asked for.
    expect(screen.getByText(words.banks.visibilityHint)).toBeInTheDocument()
    expect(within(questionsCard()).getByText(words.questions.pick)).toBeInTheDocument()
    expect(getsOf(calls, '/api/questions')).toHaveLength(0)
  })

  it('tells a holder of classes.manage nothing about visibility, and words the empty states', async () => {
    const { calls } = mockApi({ banks: [] })
    const { unmount } = renderPage(QUESTION_ADMIN_PERMISSIONS)
    expect(await screen.findByText(words.banks.empty)).toBeInTheDocument()
    expect(screen.queryByText(words.banks.visibilityHint)).not.toBeInTheDocument()
    // No bank on screen: nothing to pick, so nothing asks to.
    expect(screen.queryByText(words.questions.pick)).not.toBeInTheDocument()

    const search = screen.getByLabelText(words.banks.searchPlaceholder)
    fireEvent.change(search, { target: { value: 'لا شيء' } })
    pressEnter(search)
    await waitFor(() => expect(lastQuery(calls, '/api/question-banks')).toEqual({ q: 'لا شيء', limit: '20' }))
    expect(await screen.findByText(words.banks.emptyFiltered)).toBeInTheDocument()
    unmount()

    renderPage(QUESTION_TEACHER_PERMISSIONS)
    expect(await screen.findByText(words.banks.emptyVisible)).toBeInTheDocument()
  })

  it('sends the name search and the course filter in the query string — «بلا دورة» as courseId=none — from the first page', async () => {
    const { calls } = mockApi({ banksCursor: 'bank-cursor-2' })
    renderPage()
    await screen.findByText('بنك بايثون')

    // On the second page first: every filter starts over from the first one.
    fireEvent.click(button(banksCard(), words.pagination.next))
    await waitFor(() => expect(lastQuery(calls, '/api/question-banks')).toEqual({ limit: '20', cursor: 'bank-cursor-2' }))

    const search = screen.getByLabelText(words.banks.searchPlaceholder)
    fireEvent.change(search, { target: { value: '  python ' } })
    pressEnter(search)
    await waitFor(() => expect(lastQuery(calls, '/api/question-banks')).toEqual({ q: 'python', limit: '20' }))

    fireEvent.mouseDown(screen.getByLabelText(words.banks.columns.course))
    fireEvent.click(await option(words.banks.noCourse))
    await waitFor(() => expect(lastQuery(calls, '/api/question-banks')).toEqual({ q: 'python', courseId: 'none', limit: '20' }))

    fireEvent.mouseDown(screen.getByLabelText(words.banks.columns.course))
    fireEvent.click(await option('PY-101 — أساسيات بايثون'))
    await waitFor(() => expect(lastQuery(calls, '/api/question-banks')).toEqual({ q: 'python', courseId: COURSE_ID, limit: '20' }))
  })

  it('pages with the server cursor and back', async () => {
    const { calls } = mockApi({ banksCursor: 'bank-cursor-2' })
    renderPage()
    await screen.findByText('بنك بايثون')
    expect(within(banksCard()).getByText('الصفحة 1')).toBeInTheDocument()
    expect(button(banksCard(), words.pagination.previous)).toBeDisabled()

    fireEvent.click(button(banksCard(), words.pagination.next))
    await waitFor(() => expect(getsOf(calls, '/api/question-banks').at(-1)!.query.get('cursor')).toBe('bank-cursor-2'))
    expect(await within(banksCard()).findByText('الصفحة 2')).toBeInTheDocument()

    fireEvent.click(button(banksCard(), words.pagination.previous))
    await waitFor(() => expect(getsOf(calls, '/api/question-banks').at(-1)!.query.get('cursor')).toBeNull())
    expect(await within(banksCard()).findByText('الصفحة 1')).toBeInTheDocument()
  })

  it('shows a failed list with a retry, and starts over on a cursor of another list', async () => {
    const { calls, state } = mockApi({ banks: jsonResponse(503, { statusCode: 503, message: 'down' }) })
    const { unmount } = renderPage()
    const alert = await within(banksCard()).findByRole('alert')
    expect(within(alert).getByText(ar.login.errors.server)).toBeInTheDocument()
    state.banks = THREE_BANKS()
    fireEvent.click(button(alert, words.refresh))
    expect(await screen.findByText('بنك بايثون')).toBeInTheDocument()
    expect(getsOf(calls, '/api/question-banks')).toHaveLength(2)
    unmount()

    mockApi({ banks: jsonResponse(400, { statusCode: 400, code: 'cursor_invalid', message: 'cursor' }) })
    renderPage()
    expect(await screen.findByText(words.errors.cursor_invalid)).toBeInTheDocument()
  })

  it('without courses.read the course filter only tells the banks without a course, and no course is asked for', async () => {
    const { calls } = mockApi()
    renderPage(['questions.manage'])
    await screen.findByText('بنك بايثون')

    fireEvent.mouseDown(screen.getByLabelText(words.banks.columns.course))
    fireEvent.click(await option(words.banks.noCourse))
    await waitFor(() => expect(lastQuery(calls, '/api/question-banks')).toEqual({ courseId: 'none', limit: '20' }))

    // The bank form keeps the course as it is, named, with the reason.
    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: بنك بايثون`))
    const dialog = await findDialog('تعديل البنك «بنك بايثون»')
    expect(within(dialog).getByText(words.bankForm.hints.needsCoursesRead)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(words.bankForm.fields.course)).toBeDisabled()
    expect(within(dialog).getByText('PY-101 — أساسيات بايثون')).toBeInTheDocument()
    expect(getsOf(calls, '/api/courses')).toHaveLength(0)
  })
})

describe('QuestionBanksPage — creating, editing and deleting a bank', () => {
  it('creates a bank with exactly the smallest body, re-reads the list and shows the new bank’s questions', async () => {
    const created = makeBank({ id: NEW_BANK_ID, name: { ar: 'بنك الحلقات' }, description: null, course: null, questionCount: 0, readyCount: 0 })
    const { calls, state } = mockApi({ write: (call) => (call.method === 'POST' && call.path === '/api/question-banks' ? jsonResponse(201, created) : undefined) })
    renderPage()
    await screen.findByText('بنك بايثون')

    fireEvent.click(button(document.body, words.banks.add))
    const dialog = await findDialog(words.bankForm.createTitle)
    // A teacher files a bank under a course they teach a class of: the form says so.
    expect(within(dialog).getByText(words.bankForm.hints.courseTaught)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(words.bankForm.fields.nameAr), { target: { value: '  بنك الحلقات ' } })
    state.banks = [created, ...THREE_BANKS()]
    fireEvent.click(button(dialog, words.bankForm.create))

    expect(await screen.findByText('أُنشئ البنك «بنك الحلقات»')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'POST', path: '/api/question-banks', body: { name: { ar: 'بنك الحلقات' } } }])
    // The list is read again from its first page, and the next step — the bank's questions — is on screen.
    await waitFor(() => expect(within(banksCard()).getByText('بنك الحلقات')).toBeInTheDocument())
    expect(await within(questionsCard()).findByText('أسئلة البنك «بنك الحلقات»')).toBeInTheDocument()
    await waitFor(() => expect(lastQuery(calls, '/api/questions')).toEqual({ bankId: NEW_BANK_ID, limit: '20' }))
    expect(await within(questionsCard()).findByText(words.questions.empty)).toBeInTheDocument()
    expect(screen.queryByText(words.bankForm.createTitle)).not.toBeInTheDocument()
  })

  it('refuses a bank without an Arabic name before any request, and an English text without its Arabic one', async () => {
    const { calls } = mockApi()
    renderPage()
    await screen.findByText('بنك بايثون')

    fireEvent.click(button(document.body, words.banks.add))
    const dialog = await findDialog(words.bankForm.createTitle)
    fireEvent.change(within(dialog).getByLabelText(words.bankForm.fields.nameEn), { target: { value: 'Loops' } })
    fireEvent.change(within(dialog).getByLabelText(words.bankForm.fields.descriptionEn), { target: { value: 'About loops' } })
    fireEvent.click(button(dialog, words.bankForm.create))

    expect(await within(dialog).findByText(words.bankForm.validation.nameArRequired)).toBeInTheDocument()
    expect(within(dialog).getAllByText(words.bankForm.validation.arabicFirst)).toHaveLength(2)
    expect(writesOf(calls)).toEqual([])
  })

  it('files a new bank under a course of the picker, and shows course_not_found on the course field', async () => {
    const { calls } = mockApi({ write: () => jsonResponse(404, { statusCode: 404, code: 'course_not_found', message: 'No course with this id', courseId: COURSE_ID }) })
    renderPage(QUESTION_ADMIN_PERMISSIONS)
    await screen.findByText('بنك بايثون')

    fireEvent.click(button(document.body, words.banks.add))
    const dialog = await findDialog(words.bankForm.createTitle)
    expect(within(dialog).getByText(words.bankForm.hints.course)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(words.bankForm.fields.nameAr), { target: { value: 'بنك الدورة' } })
    fireEvent.change(within(dialog).getByLabelText(words.bankForm.fields.descriptionAr), { target: { value: 'وصف' } })
    fireEvent.change(within(dialog).getByLabelText(words.bankForm.fields.descriptionEn), { target: { value: 'Description' } })
    fireEvent.mouseDown(within(dialog).getByLabelText(words.bankForm.fields.course))
    fireEvent.click(await option('PY-101 — أساسيات بايثون'))
    fireEvent.click(button(dialog, words.bankForm.create))

    expect(await within(dialog).findByText(words.errors.course_not_found)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([
      { method: 'POST', path: '/api/question-banks', body: { name: { ar: 'بنك الدورة' }, description: { ar: 'وصف', en: 'Description' }, courseId: COURSE_ID } },
    ])
    // The message sits on the course field, and the dialog keeps what was typed.
    expect(within(dialog).getByText(words.errors.course_not_found).closest('.ant-form-item')).toContainElement(within(dialog).getByLabelText(words.bankForm.fields.course))
    expect(within(dialog).getByLabelText(words.bankForm.fields.nameAr)).toHaveValue('بنك الدورة')
  })

  it('edits a bank with the smallest PATCH — a name whole with its Turkish text, a course cleared with null — and sends nothing when nothing changed', async () => {
    const banks = THREE_BANKS()
    const { calls } = mockApi({
      banks,
      write: (call) => {
        const bank = banks.find((item) => call.path.endsWith(item.id))!
        const body = call.body as { name?: QuestionBank['name']; courseId?: string | null }
        return jsonResponse(200, { ...bank, ...(body.name ? { name: body.name } : {}), ...(body.courseId === null ? { course: null } : {}), updatedAt: '2026-11-22T10:00:00.000Z' })
      },
    })
    renderPage()
    await screen.findByText('بنك بايثون')

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: أسئلة عامة`))
    let dialog = await findDialog('تعديل البنك «أسئلة عامة»')
    fireEvent.change(within(dialog).getByLabelText(words.bankForm.fields.nameEn), { target: { value: 'General questions' } })
    fireEvent.click(button(dialog, ar.common.save))
    expect(await screen.findByText(words.banks.saved)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', path: `/api/question-banks/${BANK_IDS[1]}`, body: { name: { ar: 'أسئلة عامة', en: 'General questions', tr: 'Genel sorular' } } }])
    // The row shows the server's answer.
    await waitFor(() => expect(within(rowOf(banksCard(), 'أسئلة عامة')).getByText(formatDateTime('2026-11-22T10:00:00.000Z', 'ar'))).toBeInTheDocument())

    // The course of «بنك بايثون» cleared.
    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: بنك بايثون`))
    dialog = await findDialog('تعديل البنك «بنك بايثون»')
    await within(dialog).findByText('PY-101 — أساسيات بايثون')
    fireEvent.click(dialog.querySelector('.ant-select-clear')!)
    fireEvent.click(button(dialog, ar.common.save))
    await waitFor(() => expect(writesOf(calls)).toHaveLength(2))
    expect(writesOf(calls)[1]).toEqual({ method: 'PATCH', path: `/api/question-banks/${BANK_ID}`, body: { courseId: null } })
    await waitFor(() => expect(within(rowOf(banksCard(), 'بنك بايثون')).getByText(words.banks.noCourse)).toBeInTheDocument())

    // Nothing changed: no request, and the page says so.
    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: بنك قديم`))
    dialog = await findDialog('تعديل البنك «بنك قديم»')
    fireEvent.click(button(dialog, ar.common.save))
    expect(await screen.findByText(words.banks.nothingChanged)).toBeInTheDocument()
    expect(writesOf(calls)).toHaveLength(2)
    // Editing a bank is not choosing it: no question was asked for.
    expect(getsOf(calls, '/api/questions')).toHaveLength(0)
  })

  it('keeps a typed bank on Escape and asks before «cancel» drops it', async () => {
    const { calls } = mockApi()
    renderPage()
    await screen.findByText('بنك بايثون')

    fireEvent.click(button(document.body, words.banks.add))
    let dialog = await findDialog(words.bankForm.createTitle)
    // Nothing typed: Escape closes at once.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText(words.bankForm.createTitle)).not.toBeInTheDocument())

    fireEvent.click(button(document.body, words.banks.add))
    dialog = await findDialog(words.bankForm.createTitle)
    const name = within(dialog).getByLabelText(words.bankForm.fields.nameAr)
    fireEvent.change(name, { target: { value: 'بنك لم يُحفظ' } })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByText(words.bankForm.createTitle)).toBeInTheDocument()
    expect(name).toHaveValue('بنك لم يُحفظ')

    // «cancel» asks in the dialog's own words; «keep editing» stays, «discard» closes.
    fireEvent.click(button(dialog, ar.common.cancel))
    let question = (await screen.findAllByText(words.bankForm.unsaved.title)).at(-1)!.closest('[role="dialog"]') as HTMLElement
    expect(within(question).getByText(words.bankForm.unsaved.content)).toBeInTheDocument()
    fireEvent.click(button(question, words.bankForm.unsaved.cancel))
    expect(name).toHaveValue('بنك لم يُحفظ')
    fireEvent.click(button(dialog, ar.common.cancel))
    await waitFor(() => expect(new Set(screen.getAllByText(words.bankForm.unsaved.title).map((title) => title.closest('[role="dialog"]'))).size).toBe(2))
    question = screen.getAllByText(words.bankForm.unsaved.title).at(-1)!.closest('[role="dialog"]') as HTMLElement
    fireEvent.click(button(question, words.bankForm.unsaved.ok))
    await waitFor(() => expect(screen.queryByText(words.bankForm.createTitle)).not.toBeInTheDocument())
    expect(writesOf(calls)).toEqual([])
  })

  it('deletes a bank after a confirmation; question_bank_in_use is explained with the advice to archive', async () => {
    let deletes = 0
    const { calls } = mockApi({
      write: () => {
        deletes += 1
        return deletes === 1 ? jsonResponse(409, { statusCode: 409, code: 'question_bank_in_use', message: 'in use', linkedQuestionCount: 2 }) : jsonResponse(204)
      },
    })
    renderPage()
    await screen.findByText('بنك بايثون')

    // A click on a row's button, or inside the confirmation it opens, is not a click on the row: no bank is chosen.
    fireEvent.click(screen.getByLabelText(`${words.banks.actions.delete}: بنك قديم`))
    const cancelled = (await screen.findByText('حذف البنك «بنك قديم» وكل أسئلته نهائياً؟ لا يمكن التراجع عن الحذف.')).closest('.ant-popover') as HTMLElement
    fireEvent.click(button(cancelled, ar.common.cancel))
    expect(within(questionsCard()).getByText(words.questions.pick)).toBeInTheDocument()
    expect(getsOf(calls, '/api/questions')).toHaveLength(0)
    expect(writesOf(calls)).toEqual([])

    // Its questions are on screen while it is deleted.
    await openPythonBank()

    const confirmText = 'حذف البنك «بنك بايثون» وكل أسئلته نهائياً؟ لا يمكن التراجع عن الحذف.'
    fireEvent.click(screen.getByLabelText(`${words.banks.actions.delete}: بنك بايثون`))
    await confirmPopup(confirmText, words.banks.actions.delete)
    expect(await within(await screen.findByTestId('bank-notice')).findByText('لا يُحذف هذا البنك: فيه سؤالان مربوطان باختبارات. أرشف أسئلته بدل حذفه.')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'DELETE', path: `/api/question-banks/${BANK_ID}`, body: undefined }])
    // Refused: the bank and its questions stay.
    expect(within(banksCard()).getByText('بنك بايثون')).toBeInTheDocument()
    expect(within(questionsCard()).getByText('أسئلة البنك «بنك بايثون»')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByLabelText(`${words.banks.actions.delete}: بنك بايثون`)).toBeEnabled())
    fireEvent.click(screen.getByLabelText(`${words.banks.actions.delete}: بنك بايثون`))
    await confirmPopup(confirmText, words.banks.actions.delete)
    expect(await screen.findByText('حُذف البنك «بنك بايثون»')).toBeInTheDocument()
    await waitFor(() => expect(within(banksCard()).queryByText('بنك بايثون')).not.toBeInTheDocument())
    // Its questions leave the screen with it, and the earlier refusal is no longer shown.
    expect(within(questionsCard()).getByText(words.questions.pick)).toBeInTheDocument()
    expect(screen.queryByTestId('bank-notice')).not.toBeInTheDocument()
  })
})

describe('QuestionBanksPage — the questions of a bank', () => {
  const inUse = makeQuestion({ examCount: 2 })
  const trueFalse = makeTrueFalseQuestion()
  const draft = makeDraftQuestion()

  it('shows the questions of the bank chosen: prompt, type, status, points, difficulty, tags, usage, and what a draft lacks in words', async () => {
    const { calls } = mockApi({ questions: [inUse, trueFalse, draft] })
    renderPage()
    await screen.findByText('بنك بايثون')

    const heading = await openPythonBank()
    // The questions sit below the banks: their heading takes the focus — again when the same bank is asked for again.
    await waitFor(() => expect(heading).toHaveFocus())
    const again = screen.getByLabelText(`${words.banks.actions.questions}: بنك بايثون`)
    again.focus()
    fireEvent.click(again)
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByLabelText(`${words.banks.actions.questions}: بنك بايثون`)).toHaveAttribute('aria-pressed', 'true')
    expect(await within(questionsCard()).findByText('ما ناتج print(2 + 3) في بايثون؟')).toBeInTheDocument()
    expect(lastQuery(calls, '/api/questions')).toEqual({ bankId: BANK_ID, limit: '20' })
    expect(within(questionsCard()).getByText(words.keyNotice)).toBeInTheDocument()

    const rows = bodyRows(questionsCard())
    expect(rows).toHaveLength(3)
    const first = within(rows[0]!)
    expect(first.getByText(words.typesShort.single_choice)).toBeInTheDocument()
    expect(first.getByText(words.statuses.ready)).toBeInTheDocument()
    expect(first.getByText('2')).toBeInTheDocument()
    expect(first.getByText(words.difficulties.easy)).toBeInTheDocument()
    expect(first.getByText('python')).toBeInTheDocument()
    expect(first.getByText('حساب')).toBeInTheDocument()
    expect(first.getByText('مستعمل في اختبارين')).toBeInTheDocument()
    expect(first.queryByTestId('question-missing')).not.toBeInTheDocument()
    // An exam links it: it is archived, never deleted — the button says so before the click.
    expect(first.getByLabelText(/^حذف: /)).toBeDisabled()
    expect(first.getByLabelText(/^إعادته مسودة: /)).toBeEnabled()

    const second = within(rows[1]!)
    expect(second.getByText('بايثون لغة مفسَّرة.')).toBeInTheDocument()
    expect(second.getByText(words.typesShort.true_false)).toBeInTheDocument()
    expect(second.getByText('—')).toBeInTheDocument()
    expect(second.getByText(words.questions.notUsed)).toBeInTheDocument()
    expect(second.getByLabelText(/^حذف: /)).toBeEnabled()

    const third = within(rows[2]!)
    expect(third.getByText(words.statuses.draft)).toBeInTheDocument()
    expect(third.getByTestId('question-missing')).toHaveTextContent('غير مكتمل: أقل من خيارين، لم يُحدَّد الخيار الصحيح')
    // The server would refuse «ready» for it: the button is off.
    expect(third.getByLabelText(/^جعله جاهزاً: /)).toBeDisabled()
    expect(third.getByLabelText(/^أرشفة: /)).toBeEnabled()
  })

  it('shows the questions of another bank when its row is clicked, from that bank’s first page', async () => {
    const { calls } = mockApi({ questions: [trueFalse] })
    renderPage()
    await screen.findByText('بنك بايثون')
    await openPythonBank()

    fireEvent.click(rowOf(banksCard(), 'أسئلة عامة'))
    expect(await within(questionsCard()).findByText('أسئلة البنك «أسئلة عامة»')).toBeInTheDocument()
    await waitFor(() => expect(lastQuery(calls, '/api/questions')).toEqual({ bankId: BANK_IDS[1], limit: '20' }))
    expect(rowOf(banksCard(), 'أسئلة عامة')).toHaveClass('ant-table-row-selected')
    expect(rowOf(banksCard(), 'بنك بايثون')).not.toHaveClass('ant-table-row-selected')
  })

  it('sends every question filter in the query string — text, type, status, difficulty, tag — and pages with the cursor', async () => {
    const { calls } = mockApi({ questions: [inUse], questionsCursor: 'question-cursor-2' })
    renderPage()
    await screen.findByText('بنك بايثون')
    await openPythonBank()
    await within(questionsCard()).findByText('ما ناتج print(2 + 3) في بايثون؟')

    fireEvent.click(button(questionsCard(), words.pagination.next))
    await waitFor(() => expect(lastQuery(calls, '/api/questions')).toEqual({ bankId: BANK_ID, limit: '20', cursor: 'question-cursor-2' }))
    expect(await within(questionsCard()).findByText('الصفحة 2')).toBeInTheDocument()

    // A filter starts over from the first page.
    const search = within(questionsCard()).getByLabelText(words.questions.searchPlaceholder)
    fireEvent.change(search, { target: { value: ' print ' } })
    pressEnter(search)
    await waitFor(() => expect(lastQuery(calls, '/api/questions')).toEqual({ bankId: BANK_ID, q: 'print', limit: '20' }))

    fireEvent.mouseDown(within(questionsCard()).getByLabelText(words.questions.columns.type))
    fireEvent.click(await option(words.typesShort.true_false))
    await waitFor(() => expect(lastQuery(calls, '/api/questions').type).toBe('true_false'))

    fireEvent.mouseDown(within(questionsCard()).getByLabelText(words.questions.columns.status))
    fireEvent.click(await option(words.statuses.archived))
    await waitFor(() => expect(lastQuery(calls, '/api/questions').status).toBe('archived'))

    fireEvent.mouseDown(within(questionsCard()).getByLabelText(words.questions.columns.difficulty))
    fireEvent.click(await option(words.difficulties.hard))
    await waitFor(() => expect(lastQuery(calls, '/api/questions').difficulty).toBe('hard'))

    const tag = within(questionsCard()).getByLabelText(words.questions.filters.tag)
    fireEvent.change(tag, { target: { value: 'Loops' } })
    pressEnter(tag)
    await waitFor(() => expect(lastQuery(calls, '/api/questions')).toEqual({ bankId: BANK_ID, q: 'print', type: 'true_false', status: 'archived', difficulty: 'hard', tag: 'Loops', limit: '20' }))
  })

  it('asks for the archived questions only on request, and words each empty list', async () => {
    const { calls } = mockApi({ questions: [] })
    renderPage()
    await screen.findByText('بنك بايثون')
    await openPythonBank()

    // By default the status is not sent: the server lists the drafts and the ready questions.
    expect(await within(questionsCard()).findByText(words.questions.empty)).toBeInTheDocument()
    expect(lastQuery(calls, '/api/questions').status).toBeUndefined()
    expect(within(questionsCard()).getByText(words.questions.filters.defaultStatus)).toBeInTheDocument()

    fireEvent.mouseDown(within(questionsCard()).getByLabelText(words.questions.columns.status))
    fireEvent.click(await option(words.statuses.archived))
    expect(await within(questionsCard()).findByText(words.questions.emptyArchived)).toBeInTheDocument()

    fireEvent.mouseDown(within(questionsCard()).getByLabelText(words.questions.columns.type))
    fireEvent.click(await option(words.typesShort.single_choice))
    expect(await within(questionsCard()).findByText(words.questions.emptyFiltered)).toBeInTheDocument()
  })

  it('makes a complete draft ready with a PATCH of the status, shows the server’s answer, and re-reads the bank’s counts', async () => {
    const complete = makeDraftQuestion({ options: [makeOption('for', true), makeOption('if')], missing: [] })
    const { calls, state } = mockApi({
      questions: [complete],
      write: (call) => (call.method === 'PATCH' ? jsonResponse(200, { ...complete, status: (call.body as { status: string }).status, updatedAt: '2026-11-22T10:00:00.000Z' }) : undefined),
    })
    renderPage()
    await screen.findByText('بنك بايثون')
    await openPythonBank()
    const row = () => rowOf(questionsCard(), 'أيّ هذه حلقة تكرار؟')
    await waitFor(() => expect(within(row()).getByText(words.statuses.draft)).toBeInTheDocument())

    // The server counts: after the write the bank comes back with ten ready questions.
    state.banks = [makeBank({ readyCount: 10 }), ...THREE_BANKS().slice(1)]
    fireEvent.click(within(row()).getByLabelText(/^جعله جاهزاً: /))

    expect(await screen.findByText(words.questions.done.markReady)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', path: `/api/questions/${QUESTION_IDS[2]}`, body: { status: 'ready' } }])
    await waitFor(() => expect(within(row()).getByText(words.statuses.ready)).toBeInTheDocument())
    expect(getsOf(calls, `/api/question-banks/${BANK_ID}`)).toHaveLength(1)
    await waitFor(() => expect(within(rowOf(banksCard(), 'بنك بايثون')).getByText('الجاهز منها: 10')).toBeInTheDocument())

    // And back to a draft.
    fireEvent.click(within(row()).getByLabelText(/^إعادته مسودة: /))
    expect(await screen.findByText(words.questions.done.backToDraft)).toBeInTheDocument()
    expect(writesOf(calls)[1]).toEqual({ method: 'PATCH', path: `/api/questions/${QUESTION_IDS[2]}`, body: { status: 'draft' } })
    await waitFor(() => expect(getsOf(calls, `/api/question-banks/${BANK_ID}`)).toHaveLength(2))
  })

  it('archives after a confirmation — the row leaves with a re-read — and restores as ready or as a draft by what the server says is missing', async () => {
    const complete = makeQuestion({ status: 'archived' })
    const incomplete = makeDraftQuestion({ status: 'archived' })
    const { calls, state } = mockApi({
      questions: [makeQuestion()],
      write: (call) => {
        const source = call.path.endsWith(QUESTION_ID) ? complete : incomplete
        return jsonResponse(200, { ...source, status: (call.body as { status: string }).status })
      },
    })
    renderPage()
    await screen.findByText('بنك بايثون')
    await openPythonBank()
    await within(questionsCard()).findByText('ما ناتج print(2 + 3) في بايثون؟')
    const reads = getsOf(calls, '/api/questions').length

    fireEvent.click(within(questionsCard()).getByLabelText(/^أرشفة: /))
    await confirmPopup(words.questions.actions.archiveConfirm, words.questions.actions.archive)
    expect(await screen.findByText(words.questions.done.archive)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', path: `/api/questions/${QUESTION_ID}`, body: { status: 'archived' } }])
    // An archived question is not in the default list: it is read again.
    await waitFor(() => expect(getsOf(calls, '/api/questions').length).toBe(reads + 1))

    // In the archive: a complete question goes back ready, an incomplete one as a draft.
    state.questions = [complete, incomplete]
    fireEvent.mouseDown(within(questionsCard()).getByLabelText(words.questions.columns.status))
    fireEvent.click(await option(words.statuses.archived))
    await within(questionsCard()).findByText('أيّ هذه حلقة تكرار؟')
    const restoreButtons = within(questionsCard()).getAllByLabelText(/^استعادة من الأرشيف: /)
    expect(restoreButtons).toHaveLength(2)
    // An archived question offers neither «ready» nor «archive».
    expect(within(questionsCard()).queryByLabelText(/^أرشفة: /)).not.toBeInTheDocument()

    fireEvent.click(restoreButtons[0]!)
    expect(await screen.findByText(words.questions.done.restored.ready)).toBeInTheDocument()
    expect(writesOf(calls)[1]).toEqual({ method: 'PATCH', path: `/api/questions/${QUESTION_ID}`, body: { status: 'ready' } })

    await waitFor(() => expect(within(questionsCard()).getAllByLabelText(/^استعادة من الأرشيف: /)[1]).toBeEnabled())
    fireEvent.click(within(questionsCard()).getAllByLabelText(/^استعادة من الأرشيف: /)[1]!)
    expect(await screen.findByText(words.questions.done.restored.draft)).toBeInTheDocument()
    expect(writesOf(calls)[2]).toEqual({ method: 'PATCH', path: `/api/questions/${QUESTION_IDS[2]}`, body: { status: 'draft' } })
  })

  it('deletes a question after a confirmation; question_in_use is explained with the advice to archive, and the list is read again', async () => {
    let deletes = 0
    const { calls } = mockApi({
      // The row says no exam uses it: an exam linked it meanwhile.
      questions: [makeQuestion(), trueFalse],
      write: () => {
        deletes += 1
        return deletes === 1 ? jsonResponse(409, { statusCode: 409, code: 'question_in_use', message: 'in use', examCount: 1 }) : jsonResponse(204)
      },
    })
    renderPage()
    await screen.findByText('بنك بايثون')
    await openPythonBank()
    await within(questionsCard()).findByText('ما ناتج print(2 + 3) في بايثون؟')
    const reads = getsOf(calls, '/api/questions').length
    const deleteButton = () => within(rowOf(questionsCard(), 'ما ناتج print(2 + 3) في بايثون؟')).getByLabelText(/^حذف: /)

    fireEvent.click(deleteButton())
    await confirmPopup(words.questions.actions.deleteConfirm, words.questions.actions.delete)
    expect(await within(await screen.findByTestId('question-notice')).findByText('لا يُحذف هذا السؤال: يستعمله اختبار واحد. أرشفه بدل حذفه.')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'DELETE', path: `/api/questions/${QUESTION_ID}`, body: undefined }])
    await waitFor(() => expect(getsOf(calls, '/api/questions').length).toBe(reads + 1))

    await waitFor(() => expect(deleteButton()).toBeEnabled())
    fireEvent.click(deleteButton())
    await confirmPopup(words.questions.actions.deleteConfirm, words.questions.actions.delete)
    expect(await screen.findByText(words.questions.done.deleted)).toBeInTheDocument()
    await waitFor(() => expect(within(questionsCard()).queryByText('ما ناتج print(2 + 3) في بايثون؟')).not.toBeInTheDocument())
    // The other question stays, the refusal is gone, and the bank's counts are read again.
    expect(within(questionsCard()).getByText('بايثون لغة مفسَّرة.')).toBeInTheDocument()
    expect(screen.queryByTestId('question-notice')).not.toBeInTheDocument()
    await waitFor(() => expect(getsOf(calls, `/api/question-banks/${BANK_ID}`)).toHaveLength(1))
  })

  it('writes a new question in the bank on screen, then reads the list from its first page and the bank’s counts again', async () => {
    const created = makeDraftQuestion({ id: QUESTION_IDS[3], prompt: { ar: 'سؤال جديد تماماً' }, options: [], missing: ['options_too_few', 'correct_option_required'] })
    const { calls, state } = mockApi({ questions: [trueFalse], write: (call) => (call.method === 'POST' ? jsonResponse(201, created) : undefined) })
    renderPage()
    await screen.findByText('بنك بايثون')
    await openPythonBank()
    await within(questionsCard()).findByText('بايثون لغة مفسَّرة.')

    fireEvent.click(button(questionsCard(), words.questions.add))
    const drawer = await findEditor()
    expect(within(drawer).getByText(words.editor.createTitle)).toBeInTheDocument()
    expect(within(drawer).getByText('البنك: بنك بايثون')).toBeInTheDocument()
    fireEvent.change(within(drawer).getByLabelText(words.editor.fields.promptAr), { target: { value: 'سؤال جديد تماماً' } })
    state.questions = [created, trueFalse]
    state.banks = [makeBank({ questionCount: 13 }), ...THREE_BANKS().slice(1)]
    fireEvent.click(button(drawer, words.editor.saveDraft))

    expect(await screen.findByText(words.editor.created.draft)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([
      { method: 'POST', path: `/api/question-banks/${BANK_ID}/questions`, body: { type: 'single_choice', prompt: { ar: 'سؤال جديد تماماً' }, points: 1, status: 'draft' } },
    ])
    expect(await within(questionsCard()).findByText('سؤال جديد تماماً')).toBeInTheDocument()
    await waitFor(() => expect(within(rowOf(banksCard(), 'بنك بايثون')).getByText('13 سؤالاً')).toBeInTheDocument())
    expect(editorIsClosed()).toBe(true)
  })

  it('edits a question from its row: the editor starts from the question as the server holds it now, and the row shows the server’s answer', async () => {
    // The row on screen is an hour old: since then the prompt was reworded elsewhere and an exam linked the question.
    const fresh = makeTrueFalseQuestion({ prompt: { ar: 'بايثون لغة مفسَّرة لا مترجَمة.' }, examCount: 1, updatedAt: '2026-11-22T09:00:00.000Z' })
    const updated = { ...fresh, points: 3, updatedAt: '2026-11-22T10:00:00.000Z' }
    const { calls, state } = mockApi({ questions: [inUse, trueFalse], write: (call) => (call.method === 'PATCH' ? jsonResponse(200, updated) : undefined) })
    renderPage()
    await screen.findByText('بنك بايثون')
    await openPythonBank()
    await within(questionsCard()).findByText('بايثون لغة مفسَّرة.')
    state.questions = [inUse, fresh]

    fireEvent.click(within(rowOf(questionsCard(), 'بايثون لغة مفسَّرة.')).getByLabelText(/^تعديل: /))
    const drawer = await findEditor()
    // Read again before the editor opened (API-267): the form, its note and the row follow the server.
    expect(getsOf(calls, `/api/questions/${QUESTION_IDS[1]}`)).toHaveLength(1)
    expect(within(drawer).getByText(words.editor.editTitle)).toBeInTheDocument()
    expect(within(drawer).getByLabelText(words.editor.fields.promptAr)).toHaveValue('بايثون لغة مفسَّرة لا مترجَمة.')
    expect(within(drawer).getByTestId('question-in-use')).toHaveTextContent('مستعمل في اختبار واحد')
    const row = () => rowOf(questionsCard(), 'بايثون لغة مفسَّرة لا مترجَمة.')
    expect(within(row()).getByText('مستعمل في اختبار واحد')).toBeInTheDocument()

    fireEvent.change(within(drawer).getByLabelText(words.editor.fields.points), { target: { value: '3' } })
    fireEvent.click(button(drawer, words.editor.saveReady))

    expect(await screen.findByText(words.editor.saved.ready)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', path: `/api/questions/${QUESTION_IDS[1]}`, body: { points: 3 } }])
    await waitFor(() => expect(within(row()).getByText('3')).toBeInTheDocument())
    expect(editorIsClosed()).toBe(true)
  })

  it('says that a question deleted elsewhere is gone instead of opening its editor, and reads the list again', async () => {
    const { calls, state } = mockApi({ questions: [inUse, trueFalse] })
    renderPage()
    await screen.findByText('بنك بايثون')
    await openPythonBank()
    await within(questionsCard()).findByText('بايثون لغة مفسَّرة.')
    const reads = getsOf(calls, '/api/questions').length
    state.questions = [inUse]

    fireEvent.click(within(rowOf(questionsCard(), 'بايثون لغة مفسَّرة.')).getByLabelText(/^تعديل: /))
    expect(await within(await screen.findByTestId('question-notice')).findByText(words.errors.question_not_found)).toBeInTheDocument()
    await waitFor(() => expect(within(questionsCard()).queryByText('بايثون لغة مفسَّرة.')).not.toBeInTheDocument())
    expect(getsOf(calls, '/api/questions').length).toBe(reads + 1)
    expect(editorIsClosed()).toBe(true)
    expect(writesOf(calls)).toEqual([])
  })

  it('gives the focus back to the button that opened a dialog once the dialog has left the page', async () => {
    mockApi({ questions: [trueFalse] })
    renderPage()
    await screen.findByText('بنك بايثون')

    // The bank form, closed untouched: back to «new bank».
    const add = button(document.body, words.banks.add)
    add.focus()
    fireEvent.click(add)
    const dialog = await findDialog(words.bankForm.createTitle)
    // The focus is inside the dialog, as it is for whoever works in it.
    const name = within(dialog).getByLabelText(words.bankForm.fields.nameAr)
    name.focus()
    expect(name).toHaveFocus()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText(words.bankForm.createTitle)).not.toBeInTheDocument())
    await waitFor(() => expect(add).toHaveFocus())

    // The editor, closed untouched: back to the row's «edit».
    await openPythonBank()
    const edit = await within(questionsCard()).findByLabelText(/^تعديل: /)
    edit.focus()
    fireEvent.click(edit)
    const prompt = within(await findEditor()).getByLabelText(words.editor.fields.promptAr)
    prompt.focus()
    expect(prompt).toHaveFocus()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(editorIsClosed()).toBe(true))
    await waitFor(() => expect(edit).toHaveFocus())
  })

  it('shows a failed questions list with a retry, and leaves the screen of a bank that is gone', async () => {
    const { calls, state } = mockApi({ questions: jsonResponse(500, { statusCode: 500, message: 'boom' }) })
    renderPage()
    await screen.findByText('بنك بايثون')
    await openPythonBank()
    const alert = await within(questionsCard()).findByRole('alert')
    expect(within(alert).getByText(ar.login.errors.server)).toBeInTheDocument()
    const complete = makeDraftQuestion({ options: [makeOption('for', true), makeOption('if')], missing: [] })
    state.questions = [complete]
    fireEvent.click(button(alert, words.refresh))
    expect(await within(questionsCard()).findByText('أيّ هذه حلقة تكرار؟')).toBeInTheDocument()

    // The bank was deleted elsewhere: a write on one of its questions answers 404 for the bank.
    state.write = () => jsonResponse(404, { statusCode: 404, code: 'question_bank_not_found', message: 'gone' })
    state.banks = THREE_BANKS().slice(1)
    const reads = getsOf(calls, '/api/question-banks').length
    fireEvent.click(within(questionsCard()).getByLabelText(/^جعله جاهزاً: /))
    expect(await within(await screen.findByTestId('bank-notice')).findByText(words.errors.question_bank_not_found)).toBeInTheDocument()
    await waitFor(() => expect(within(banksCard()).queryByText('بنك بايثون')).not.toBeInTheDocument())
    expect(getsOf(calls, '/api/question-banks').length).toBe(reads + 1)
    expect(within(questionsCard()).getByText(words.questions.pick)).toBeInTheDocument()
  })
})
