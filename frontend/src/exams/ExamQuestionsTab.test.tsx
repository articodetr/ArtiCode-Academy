// The «الأسئلة» tab of the exam drawer (MOD-09 phase 2) against a mocked API-270..API-272 (and API-260/API-265 for
// the picker): the editor of an online draft's question set, the same list read-only, the frozen copies with their
// key and its correction, and the preview a learner would see — without the key.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExamQuestions } from '../api/examQuestions'
import type { Exam } from '../api/exams'
import type { QuestionBank } from '../api/questionBanks'
import { ar } from '../i18n/ar'
import {
  BANK_QUESTION_IDS,
  EXAM_QUESTION_IDS,
  POWER_OPTION_IDS,
  frozenItems,
  makeBankQuestion,
  makeExamQuestions,
  makeFrozenQuestions,
  makeKeyCorrectionResult,
  makeLenQuestion,
  makeLinkedItem,
  makeQuestionBank,
  makeQuestionList,
  threeExamQuestions,
} from '../test/examQuestions'
import { EXAM_ID, EXAM_READER_PERMISSIONS, EXAM_TEACHER_PERMISSIONS, ONLINE_EXAM_ADMIN_PERMISSIONS, makeOnlineExam } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ExamQuestionsTab } from './ExamQuestionsTab'

const words = ar.examOnline
const [first, second, third, fourth] = BANK_QUESTION_IDS
const QUESTIONS_URL = `/api/exams/${EXAM_ID}/questions`

interface Call {
  method: string
  url: string
  query: URLSearchParams
  body: unknown
}

interface TabApiOptions {
  /** GET /api/exams/:id/questions — re-read on every call. */
  questions: () => ExamQuestions | Response
  /** The answer of a write; any other write fails. */
  respond?: (method: string, url: string, body: unknown) => Response | undefined
  /** GET /api/question-banks — one bank by default (CH-0376: the course's bank of «كتابة سؤال جديد»). */
  banks?: () => QuestionBank[]
}

/** The exam's questions (API-270), one bank (API-260) and its ready questions for the picker (API-265); `calls` records every request. */
function mockTabApi({ questions, respond = () => undefined, banks = () => [makeQuestionBank()] }: TabApiOptions) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const parsed = new URL(url, 'http://localhost')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url: parsed.pathname, query: parsed.searchParams, body })
    if (method === 'GET' && parsed.pathname === QUESTIONS_URL) {
      const answer = questions()
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    if (method === 'GET' && parsed.pathname === '/api/question-banks') return jsonResponse(200, { items: banks(), nextCursor: null })
    // The bank's ready questions: the power question (already linked), then the two that wait.
    if (method === 'GET' && parsed.pathname === '/api/questions') return jsonResponse(200, makeQuestionList([makeBankQuestion({ id: first, prompt: threeExamQuestions()[0]!.question.prompt, points: 4 }), makeBankQuestion(), makeLenQuestion()]))
    return respond(method, parsed.pathname, body) ?? jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

function renderTab(exam: Exam = makeOnlineExam(), permissions: string[] = ONLINE_EXAM_ADMIN_PERMISSIONS) {
  const onChanged = vi.fn()
  const onUnsavedChange = vi.fn()
  renderWithProviders(<ExamQuestionsTab exam={exam} onChanged={onChanged} onUnsavedChange={onUnsavedChange} />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/exams' })
  return { onChanged, onUnsavedChange }
}

/** A translated text with its placeholders filled. */
const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), template)

const rows = () => screen.getAllByTestId('exam-question-row')
const pointsOf = (number: number) => screen.getByLabelText(fill(words.editor.pointsOf, { number }))
const total = () => screen.getByTestId('exam-questions-total')
const totalText = (sum: string | number, max: number = 10) => fill(words.editor.total, { total: sum, max })
/** «اختيار من بنك الأسئلة» — the toolbar's button (an empty set shows a card with the same words too). */
const pickButton = () => screen.getAllByText(words.editor.pickFromBank).map((element) => element.closest('button')).find((button) => button !== null)!
const saveButton = () => screen.getByText(words.editor.save).closest('button')!
const writes = (calls: Call[], method: string) => calls.filter((call) => call.method === method)
const reads = (calls: Call[]) => calls.filter((call) => call.method === 'GET' && call.url === QUESTIONS_URL)

async function typePoints(number: number, value: string) {
  const input = pointsOf(number)
  await userEvent.clear(input)
  if (value) await userEvent.type(input, value)
}

/** Opens «اختيار من بنك الأسئلة», chooses the bank and waits for its questions. */
async function openPicker() {
  fireEvent.click(pickButton())
  const dialog = (await screen.findByText(words.picker.title)).closest('[role="dialog"]') as HTMLElement
  fireEvent.mouseDown(within(dialog).getByLabelText(words.picker.bank))
  fireEvent.click(await screen.findByText(fill(words.picker.bankOption, { name: makeQuestionBank().name.ar, ready: 5 }), { selector: '.ant-select-item-option-content' }))
  await within(dialog).findByLabelText(makeBankQuestion().prompt.ar)
  return dialog
}

describe('ExamQuestionsTab — the editor of an online draft', () => {
  it('reads the set once and shows each question with its position, type, bank, prompt and points; the points add up to the maximum score', async () => {
    const calls = mockTabApi({ questions: () => makeExamQuestions() })
    const { onUnsavedChange, onChanged } = renderTab()

    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(reads(calls)).toHaveLength(1)
    const [power, lists, text] = rows()
    expect(within(power!).getByText(fill(words.questions.question, { number: 1 }))).toBeInTheDocument()
    expect(within(power!).getByText('ما ناتج print(2 ** 3) في بايثون؟')).toBeInTheDocument()
    expect(within(power!).getByText(words.types.single_choice)).toBeInTheDocument()
    expect(within(power!).getByText(fill(words.questions.bank, { name: 'أسئلة أساسيات بايثون' }))).toBeInTheDocument()
    expect(within(lists!).getByText(words.types.true_false)).toBeInTheDocument()
    expect(within(text!).getByText(fill(words.questions.question, { number: 3 }))).toBeInTheDocument()
    expect([1, 2, 3].map((number) => (pointsOf(number) as HTMLInputElement).value)).toEqual(['4', '3', '3'])
    expect(total()).toHaveTextContent(totalText(10))
    expect(within(total()).getByText(words.editor.totalMatch)).toBeInTheDocument()
    expect(screen.getByText(fill(words.editor.count, { value: 3, max: 200 }))).toBeInTheDocument()
    // A ready question shows no status, and the key shows nowhere in the editor.
    expect(screen.queryByText(words.questionStatus.ready)).not.toBeInTheDocument()
    expect(screen.queryByTestId('exam-question-key')).not.toBeInTheDocument()
    // Nothing to save yet.
    expect(saveButton()).toBeDisabled()
    expect(onUnsavedChange).toHaveBeenLastCalledWith(false)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('adds from the picker, reorders and re-points; the total follows; ONE PUT carries the whole ordered list, and the tab shows the server’s answer', async () => {
    const [q1, q2, q3] = threeExamQuestions()
    const answer = makeExamQuestions({
      items: [{ ...q1!, points: 2 }, q2!, makeLinkedItem(makeBankQuestion(), { sortOrder: 2 }), { ...q3!, sortOrder: 3 }],
    })
    const calls = mockTabApi({ questions: () => makeExamQuestions(), respond: (method) => (method === 'PUT' ? jsonResponse(200, answer) : undefined) })
    const { onUnsavedChange, onChanged } = renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))

    // The picker: the linked question is listed as added and cannot be ticked; the ticked one arrives at the end with its own points.
    const picker = await openPicker()
    const picked = calls.find((call) => call.url === '/api/questions')!
    expect(Object.fromEntries(picked.query)).toEqual({ bankId: makeQuestionBank().id, status: 'ready', limit: '20' })
    const linkedRow = within(picker).getByLabelText(q1!.question.prompt.ar)
    expect(linkedRow).toBeDisabled()
    expect(within(linkedRow.closest('[data-testid="question-picker-row"]') as HTMLElement).getByText(words.picker.added)).toBeInTheDocument()
    fireEvent.click(within(picker).getByLabelText(makeBankQuestion().prompt.ar))
    fireEvent.click(within(picker).getByText(fill(words.picker.submit, { value: 1 })).closest('button')!)
    await waitFor(() => expect(rows()).toHaveLength(4))
    expect(within(rows()[3]!).getByText(words.editor.newRow)).toBeInTheDocument()
    expect(pointsOf(4)).toHaveValue('2')
    // 4 + 3 + 3 + 2: no longer the maximum score, and the tab says so.
    expect(total()).toHaveTextContent(totalText(12))
    expect(within(total()).getByText(words.editor.totalMismatch)).toBeInTheDocument()
    expect(onUnsavedChange).toHaveBeenLastCalledWith(true)

    // Up one place, and the first question worth 2: equal again.
    fireEvent.click(screen.getByLabelText(fill(words.editor.moveUp, { number: 4 })))
    expect(within(rows()[2]!).getByText(makeBankQuestion().prompt.ar)).toBeInTheDocument()
    await typePoints(1, '2')
    expect(total()).toHaveTextContent(totalText(10))
    expect(within(total()).getByText(words.editor.totalMatch)).toBeInTheDocument()
    expect(writes(calls, 'PUT')).toEqual([])

    fireEvent.click(saveButton())
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    const puts = writes(calls, 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0]!.url).toBe(QUESTIONS_URL)
    expect(puts[0]!.body).toEqual({
      questions: [
        { questionId: first, points: 2 },
        { questionId: second, points: 3 },
        { questionId: fourth, points: 2 },
        { questionId: third, points: 3 },
      ],
    })
    // The server's answer is on screen — nothing «not saved yet» — without another read.
    expect(await screen.findByText(words.editor.saved)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(words.editor.newRow)).not.toBeInTheDocument())
    expect(rows()).toHaveLength(4)
    expect(reads(calls)).toHaveLength(1)
    await waitFor(() => expect(onUnsavedChange).toHaveBeenLastCalledWith(false))
    expect(saveButton()).toBeDisabled()
  })

  it('sends nothing for a change changed back, and removes a row only in the draft until it is saved', async () => {
    const calls = mockTabApi({ questions: () => makeExamQuestions() })
    const { onUnsavedChange } = renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))

    await typePoints(1, '5')
    expect(onUnsavedChange).toHaveBeenLastCalledWith(true)
    expect(saveButton()).toBeEnabled()
    await typePoints(1, '4')
    await waitFor(() => expect(onUnsavedChange).toHaveBeenLastCalledWith(false))
    expect(saveButton()).toBeDisabled()

    fireEvent.click(screen.getByLabelText(fill(words.editor.moveDown, { number: 1 })))
    fireEvent.click(screen.getByLabelText(fill(words.editor.moveUp, { number: 2 })))
    await waitFor(() => expect(saveButton()).toBeDisabled())

    fireEvent.click(screen.getByLabelText(fill(words.editor.remove, { number: 2 })))
    expect(rows()).toHaveLength(2)
    expect(total()).toHaveTextContent(totalText(7))
    expect(saveButton()).toBeEnabled()
    expect(writes(calls, 'PUT')).toEqual([])
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('keeps the keyboard where the work is: after a removal the focus is on the row that took its place, then on «add» once none is left', async () => {
    mockTabApi({ questions: () => makeExamQuestions() })
    renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))
    const remove = (number: number) => screen.getByLabelText(fill(words.editor.remove, { number }))

    fireEvent.click(remove(2))
    // The third question is the second now, and holds the focus.
    await waitFor(() => expect(remove(2)).toHaveFocus())
    expect(within(rows()[1]!).getByText('أي نوع بيانات يمثّل النص؟')).toBeInTheDocument()
    // The last one removed: the focus steps back to the new last row.
    fireEvent.click(remove(2))
    await waitFor(() => expect(remove(1)).toHaveFocus())
    fireEvent.click(remove(1))
    await waitFor(() => expect(pickButton()).toHaveFocus())
    expect(screen.getByTestId('exam-questions-choose')).toHaveTextContent(words.editor.empty)
  })

  it('puts the saved set back on «discard», after asking', async () => {
    mockTabApi({ questions: () => makeExamQuestions() })
    const { onUnsavedChange } = renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))
    fireEvent.click(screen.getByLabelText(fill(words.editor.remove, { number: 1 })))
    await typePoints(1, '9')
    expect(rows()).toHaveLength(2)

    fireEvent.click(screen.getByText(words.editor.discard).closest('button')!)
    expect(await screen.findByText(words.editor.discardConfirm)).toBeInTheDocument()
    const confirm = screen.getByText(words.editor.discardConfirm).closest('.ant-popover') as HTMLElement
    fireEvent.click(within(confirm).getByText(words.editor.discard).closest('button')!)
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(pointsOf(1)).toHaveValue('4')
    expect(total()).toHaveTextContent(totalText(10))
    await waitFor(() => expect(onUnsavedChange).toHaveBeenLastCalledWith(false))
  })

  it('refuses locally points the server would refuse: the rows say what is wrong and nothing is sent', async () => {
    const calls = mockTabApi({ questions: () => makeExamQuestions() })
    renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))
    await typePoints(2, '')
    await typePoints(3, '0')
    fireEvent.click(saveButton())

    expect(await screen.findByTestId('exam-questions-error')).toHaveTextContent(words.editor.fixRows)
    expect(within(rows()[1]!).getByText(words.editor.pointsRequired)).toBeInTheDocument()
    expect(within(rows()[2]!).getByText(fill(words.editor.pointsInvalid, { min: 0.01, max: 9999.99 }))).toBeInTheDocument()
    expect(writes(calls, 'PUT')).toEqual([])
  })

  it('marks the rows the server refused (question_not_ready), keeps the draft and writes nothing', async () => {
    const calls = mockTabApi({
      questions: () => makeExamQuestions(),
      respond: (method) => (method === 'PUT' ? jsonResponse(422, { statusCode: 422, code: 'question_not_ready', questionIds: [second], message: 'not ready' }) : undefined),
    })
    const { onChanged } = renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))
    await typePoints(1, '5')
    fireEvent.click(saveButton())

    expect(await screen.findByTestId('exam-questions-error')).toHaveTextContent(fill(words.editor.errors.question_not_ready, { value: 1 }))
    expect(rows()[1]).toHaveAttribute('data-refused', 'not_ready')
    expect(within(rows()[1]!).getByText(words.editor.refused.not_ready)).toBeInTheDocument()
    expect(rows()[0]).not.toHaveAttribute('data-refused')
    // The draft is still there to put right, and the exam was not touched.
    expect(pointsOf(1)).toHaveValue('5')
    expect(saveButton()).toBeEnabled()
    expect(writes(calls, 'PUT')).toHaveLength(1)
    expect(reads(calls)).toHaveLength(1)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('marks questions that are gone or out of reach (question_not_found) with their own words', async () => {
    mockTabApi({
      questions: () => makeExamQuestions(),
      respond: (method) => (method === 'PUT' ? jsonResponse(404, { statusCode: 404, code: 'question_not_found', questionIds: [first, third], message: 'gone' }) : undefined),
    })
    renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))
    await typePoints(2, '1')
    fireEvent.click(saveButton())
    expect(await screen.findByTestId('exam-questions-error')).toHaveTextContent(fill(words.editor.errors.question_not_found, { value: 2 }))
    expect(rows().map((row) => row.getAttribute('data-refused'))).toEqual(['not_found', null, 'not_found'])
  })

  it('re-reads the tab and the exam when the exam is no longer a draft (exam_questions_locked), and shows the frozen copies', async () => {
    let current = makeExamQuestions()
    const calls = mockTabApi({
      questions: () => current,
      respond: (method) => {
        if (method !== 'PUT') return undefined
        // Made available elsewhere meanwhile.
        current = makeFrozenQuestions()
        return jsonResponse(409, { statusCode: 409, code: 'exam_questions_locked', status: 'scheduled', message: 'locked' })
      },
    })
    const { onChanged, onUnsavedChange } = renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))
    await typePoints(1, '5')
    fireEvent.click(saveButton())

    expect(await screen.findByText(words.editor.errors.exam_questions_locked)).toBeInTheDocument()
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(await screen.findByTestId('exam-questions-frozen-note')).toBeInTheDocument()
    expect(reads(calls)).toHaveLength(2)
    expect(screen.queryByText(words.editor.save)).not.toBeInTheDocument()
    await waitFor(() => expect(onUnsavedChange).toHaveBeenLastCalledWith(false))
  })

  it('shows a linked question that lost its «ready» in its bank: its status, what to do, and the server’s own word', async () => {
    const items = threeExamQuestions()
    items[1] = { ...items[1]!, question: { ...items[1]!.question, status: 'archived' } }
    mockTabApi({ questions: () => makeExamQuestions({ items, problems: ['questions_not_ready'] }) })
    renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(within(rows()[1]!).getByText(words.questionStatus.archived)).toBeInTheDocument()
    expect(within(rows()[1]!).getByText(fill(words.editor.notReady, { status: words.questionStatus.archived }))).toBeInTheDocument()
    expect(within(rows()[0]!).queryByText(words.questionStatus.archived)).not.toBeInTheDocument()
    expect(screen.getByText(words.editor.serverNotReady)).toBeInTheDocument()
  })

  it('starts an empty set with the way to add questions, and no verdict on a total of nothing', async () => {
    mockTabApi({ questions: () => makeExamQuestions({ items: [], totalPoints: 0, problems: ['no_questions'] }) })
    renderTab()
    const choose = await screen.findByTestId('exam-questions-choose')
    expect(choose).toHaveTextContent(words.editor.empty)
    expect(total()).toHaveTextContent(totalText(0))
    expect(within(total()).queryByText(words.editor.totalMismatch)).not.toBeInTheDocument()
    expect(pickButton()).toBeEnabled()
    // CH-0376: the two ways as two cards.
    expect(within(choose).getByText(words.editor.pickFromBankHint)).toBeInTheDocument()
    expect(within(choose).getByText(words.editor.writeNewHint)).toBeInTheDocument()
  })

  it('says why the questions cannot be read, with a way to try again', async () => {
    let answer: ExamQuestions | Response = jsonResponse(500, { statusCode: 500, message: 'boom' })
    const calls = mockTabApi({ questions: () => (answer instanceof Response ? answer.clone() : answer) })
    renderTab()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(words.questions.loadError)).toBeInTheDocument()
    expect(within(alert).getByText(ar.login.errors.server)).toBeInTheDocument()
    answer = makeExamQuestions()
    fireEvent.click(within(alert).getByText(words.questions.refresh).closest('button')!)
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(reads(calls)).toHaveLength(2)
  })
})

describe('ExamQuestionsTab — a draft the caller may not compose', () => {
  it('shows the same list read-only without questions.manage, with the reason: no field, no move, no add, no save', async () => {
    const calls = mockTabApi({ questions: () => makeExamQuestions() })
    const { onUnsavedChange } = renderTab(makeOnlineExam(), EXAM_TEACHER_PERMISSIONS)
    await waitFor(() => expect(rows()).toHaveLength(3))

    expect(screen.getByText(words.editor.readOnlyKeys)).toBeInTheDocument()
    expect(within(rows()[0]!).getByText('ما ناتج print(2 ** 3) في بايثون؟')).toBeInTheDocument()
    expect(within(rows()[0]!).getByText(fill(words.questions.points, { points: 4 }))).toBeInTheDocument()
    expect(total()).toHaveTextContent(totalText(10))
    expect(screen.queryByLabelText(fill(words.editor.pointsOf, { number: 1 }))).not.toBeInTheDocument()
    expect(screen.queryByLabelText(fill(words.editor.moveUp, { number: 2 }))).not.toBeInTheDocument()
    expect(screen.queryByLabelText(fill(words.editor.remove, { number: 1 }))).not.toBeInTheDocument()
    expect(screen.queryByText(words.editor.pickFromBank)).not.toBeInTheDocument()
    expect(screen.queryByText(words.editor.save)).not.toBeInTheDocument()
    expect(onUnsavedChange).toHaveBeenLastCalledWith(false)
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('needs both keys: questions.manage without exams.manage reads only too', async () => {
    mockTabApi({ questions: () => makeExamQuestions() })
    renderTab(makeOnlineExam(), [...EXAM_READER_PERMISSIONS, 'questions.manage'])
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(screen.getByText(words.editor.readOnlyKeys)).toBeInTheDocument()
    expect(screen.queryByText(words.editor.save)).not.toBeInTheDocument()
  })

  it('shows a draft of a cancelled class read-only with that reason, whatever the keys', async () => {
    mockTabApi({ questions: () => makeExamQuestions({ editable: false }) })
    renderTab(makeOnlineExam({ class: { ...makeOnlineExam().class, status: 'cancelled' } }))
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(screen.getByText(words.editor.readOnlyClass)).toBeInTheDocument()
    expect(screen.queryByText(words.editor.readOnlyKeys)).not.toBeInTheDocument()
    expect(screen.queryByText(words.editor.pickFromBank)).not.toBeInTheDocument()
  })
})

describe('ExamQuestionsTab — the frozen copies of an exam that was made available', () => {
  const scheduled = () => makeOnlineExam({ status: 'scheduled' })
  const cards = () => screen.getAllByTestId('exam-question-card')

  it('shows each question with its options and THE KEY marked, its points and its explanation — and no editor', async () => {
    mockTabApi({ questions: () => makeFrozenQuestions() })
    renderTab(scheduled())
    expect(await screen.findByTestId('exam-questions-frozen-note')).toHaveTextContent(words.frozen.note)
    expect(cards()).toHaveLength(3)
    expect(total()).toHaveTextContent(fill(words.frozen.summary, { value: 3, total: 10, max: 10 }))

    const [power, lists] = cards()
    expect(within(power!).getByText('ما ناتج print(2 ** 3) في بايثون؟')).toBeInTheDocument()
    expect(within(power!).getByText(fill(words.questions.points, { points: 4 }))).toBeInTheDocument()
    // One key per question, on the right answer.
    expect(within(power!).getAllByTestId('exam-question-key')).toHaveLength(1)
    expect(within(power!).getByText('8').closest('li')).toHaveAttribute('data-key', 'true')
    expect(within(within(power!).getByText('8').closest('li') as HTMLElement).getByText(words.frozen.correct)).toBeInTheDocument()
    expect(within(power!).getByText('6').closest('li')).not.toHaveAttribute('data-key')
    expect(within(power!).getByText('9').closest('li')).not.toHaveAttribute('data-key')
    expect(within(power!).getByTestId('exam-question-explanation')).toHaveTextContent('العامل ** هو الأس: 2 مرفوعة للقوة 3 تساوي 8.')
    // True/false: the two answers in words, the key on «صحيح».
    expect(within(lists!).getByText(words.answers.true).closest('li')).toHaveAttribute('data-key', 'true')
    expect(within(lists!).getByText(words.answers.false).closest('li')).not.toHaveAttribute('data-key')
    expect(within(lists!).queryByTestId('exam-question-explanation')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('exam-question-key')).toHaveLength(3)

    expect(screen.queryByText(words.editor.save)).not.toBeInTheDocument()
    expect(screen.queryByText(words.editor.pickFromBank)).not.toBeInTheDocument()
    expect(screen.queryByTestId('exam-question-row')).not.toBeInTheDocument()
  })

  it('lists the corrections of a key — when and why — and names nobody', async () => {
    const corrected = makeKeyCorrectionResult().question
    mockTabApi({ questions: () => makeFrozenQuestions({ items: [corrected, ...frozenItems().slice(1)] }) })
    renderTab(scheduled())
    await screen.findByTestId('exam-questions-frozen-note')
    const history = within(cards()[0]!).getByTestId('exam-question-corrections')
    expect(within(history).getByText(words.frozen.corrections)).toBeInTheDocument()
    expect(within(history).getByText(corrected.corrections[0]!.reason)).toBeInTheDocument()
    // Who is an id: it is not shown, and no name is made up for it.
    expect(document.body.textContent).not.toContain(corrected.corrections[0]!.byUserId)
    expect(within(cards()[1]!).queryByTestId('exam-question-corrections')).not.toBeInTheDocument()
    // The key follows the correction.
    expect(within(cards()[0]!).getByText('9').closest('li')).toHaveAttribute('data-key', 'true')
  })

  it('corrects a key for a holder of exams.grade: the dialog starts on the recorded key, sends the chosen option with the reason, and the tab shows the server’s counts and re-reads', async () => {
    let current = makeFrozenQuestions()
    const result = makeKeyCorrectionResult()
    const calls = mockTabApi({
      questions: () => current,
      respond: (method) => {
        if (method !== 'POST') return undefined
        current = makeFrozenQuestions({ items: [result.question, ...frozenItems().slice(1)] })
        return jsonResponse(200, result)
      },
    })
    const { onChanged, onUnsavedChange } = renderTab(scheduled())
    await screen.findByTestId('exam-questions-frozen-note')

    fireEvent.click(screen.getByLabelText(fill(words.frozen.correctKeyOf, { number: 1 })))
    const dialog = (await screen.findByText(fill(words.key.title, { number: 1 }))).closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(words.key.effect)).toBeInTheDocument()
    expect(within(dialog).getByTestId('correct-key-prompt')).toHaveTextContent('ما ناتج print(2 ** 3) في بايثون؟')
    // The recorded key is the starting choice, and says so.
    expect(within(dialog).getByRole('radio', { name: new RegExp(`8.*${words.key.current}`) })).toBeChecked()
    fireEvent.click(within(dialog).getByRole('radio', { name: '9' }))
    await userEvent.type(within(dialog).getByLabelText(words.key.reason), '  الصحيح 9 بحسب نص السؤال المعدَّل  ')
    await waitFor(() => expect(onUnsavedChange).toHaveBeenLastCalledWith(true))
    fireEvent.click(within(dialog).getByText(words.key.submit).closest('button')!)

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(writes(calls, 'POST')).toEqual([
      { method: 'POST', url: `${QUESTIONS_URL}/${EXAM_QUESTION_IDS[0]}/key`, query: expect.anything(), body: { correctOptionId: POWER_OPTION_IDS[2], reason: 'الصحيح 9 بحسب نص السؤال المعدَّل' } },
    ])
    // The server's counts, in words.
    const outcome = await screen.findByTestId('key-correction-outcome')
    expect(outcome).toHaveTextContent(
      fill(words.key.done, { number: 1, attempts: fill(words.key.regraded_many, { count: 14 }), changed: fill(words.key.changedAttempts_few, { count: 3 }), results: words.key.changedResults_two }),
    )
    // The tab re-read: the key and the history are the server's.
    await waitFor(() => expect(reads(calls)).toHaveLength(2))
    await waitFor(() => expect(within(cards()[0]!).getByText('9').closest('li')).toHaveAttribute('data-key', 'true'))
    expect(within(cards()[0]!).getByTestId('exam-question-corrections')).toBeInTheDocument()
    expect(screen.queryByText(fill(words.key.title, { number: 1 }))).not.toBeInTheDocument()
    await waitFor(() => expect(onUnsavedChange).toHaveBeenLastCalledWith(false))
  })

  it('says «the key did not change» when the server answers changed: false', async () => {
    const unchanged = makeKeyCorrectionResult({ changed: false, question: frozenItems()[0]!, regrade: { attempts: 0, changedAttempts: 0, changedResults: 0 } })
    const calls = mockTabApi({ questions: () => makeFrozenQuestions(), respond: (method) => (method === 'POST' ? jsonResponse(200, unchanged) : undefined) })
    const { onChanged } = renderTab(scheduled())
    await screen.findByTestId('exam-questions-frozen-note')
    fireEvent.click(screen.getByLabelText(fill(words.frozen.correctKeyOf, { number: 1 })))
    const dialog = (await screen.findByText(fill(words.key.title, { number: 1 }))).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(words.key.reason), 'تأكيد المفتاح')
    fireEvent.click(within(dialog).getByText(words.key.submit).closest('button')!)

    expect(await screen.findByTestId('key-correction-outcome')).toHaveTextContent(fill(words.key.unchanged, { number: 1 }))
    expect(writes(calls, 'POST')[0]!.body).toEqual({ correctOptionId: POWER_OPTION_IDS[1], reason: 'تأكيد المفتاح' })
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  })

  it('words grades_certified in the dialog and keeps it open: results under a certificate are not rewritten', async () => {
    const calls = mockTabApi({
      questions: () => makeFrozenQuestions(),
      respond: (method) => (method === 'POST' ? jsonResponse(409, { statusCode: 409, code: 'grades_certified', classId: 'c-1', certificateCount: 3, message: 'certified' }) : undefined),
    })
    const { onChanged } = renderTab(scheduled())
    await screen.findByTestId('exam-questions-frozen-note')
    fireEvent.click(screen.getByLabelText(fill(words.frozen.correctKeyOf, { number: 2 })))
    const dialog = (await screen.findByText(fill(words.key.title, { number: 2 }))).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByRole('radio', { name: words.answers.false }))
    await userEvent.type(within(dialog).getByLabelText(words.key.reason), 'العبارة خاطئة')
    fireEvent.click(within(dialog).getByText(words.key.submit).closest('button')!)

    expect(await within(dialog).findByTestId('correct-key-error')).toHaveTextContent(fill(words.key.errors.grades_certified, { value: 3 }))
    // A true/false question names a JSON boolean, never an option.
    expect(writes(calls, 'POST')[0]).toMatchObject({ url: `${QUESTIONS_URL}/${EXAM_QUESTION_IDS[1]}/key`, body: { correctAnswer: false, reason: 'العبارة خاطئة' } })
    expect(writes(calls, 'POST')[0]!.body).not.toHaveProperty('correctOptionId')
    // Nothing changed: no outcome, no re-read, and the typed reason is still there.
    expect(within(dialog).getByLabelText(words.key.reason)).toHaveValue('العبارة خاطئة')
    expect(screen.queryByTestId('key-correction-outcome')).not.toBeInTheDocument()
    expect(reads(calls)).toHaveLength(1)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('closes the dialog and re-reads when the exam went back to a draft meanwhile (exam_not_frozen)', async () => {
    let current = makeFrozenQuestions()
    const calls = mockTabApi({
      questions: () => current,
      respond: (method) => {
        if (method !== 'POST') return undefined
        current = makeExamQuestions()
        return jsonResponse(409, { statusCode: 409, code: 'exam_not_frozen', status: 'draft', message: 'draft' })
      },
    })
    const { onChanged } = renderTab(scheduled())
    await screen.findByTestId('exam-questions-frozen-note')
    fireEvent.click(screen.getByLabelText(fill(words.frozen.correctKeyOf, { number: 1 })))
    const dialog = (await screen.findByText(fill(words.key.title, { number: 1 }))).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByRole('radio', { name: '6' }))
    await userEvent.type(within(dialog).getByLabelText(words.key.reason), 'سبب')
    fireEvent.click(within(dialog).getByText(words.key.submit).closest('button')!)

    expect(await screen.findByText(words.key.errors.exam_not_frozen)).toBeInTheDocument()
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(reads(calls)).toHaveLength(2))
    await waitFor(() => expect(screen.queryByTestId('correct-key-prompt')).not.toBeInTheDocument())
    expect(screen.queryByTestId('key-correction-outcome')).not.toBeInTheDocument()
  })

  it('offers no key correction without exams.grade, nor for a cancelled class — which says why', async () => {
    mockTabApi({ questions: () => makeFrozenQuestions() })
    const { unmount } = renderWithProviders(<ExamQuestionsTab exam={scheduled()} onChanged={vi.fn()} onUnsavedChange={vi.fn()} />, { auth: makeAuth({ user: makeUser({ permissions: EXAM_READER_PERMISSIONS }) }), route: '/exams' })
    await screen.findByTestId('exam-questions-frozen-note')
    expect(screen.queryByText(words.frozen.correctKey)).not.toBeInTheDocument()
    expect(screen.queryByText(words.frozen.classCancelled)).not.toBeInTheDocument()
    // The key itself is still shown to whoever reads the exam's questions.
    expect(screen.getAllByTestId('exam-question-key')).toHaveLength(3)
    unmount()

    renderTab(makeOnlineExam({ status: 'scheduled', class: { ...makeOnlineExam().class, status: 'cancelled' } }))
    await screen.findByTestId('exam-questions-frozen-note')
    expect(screen.queryByText(words.frozen.correctKey)).not.toBeInTheDocument()
    expect(screen.getByText(words.frozen.classCancelled)).toBeInTheDocument()
  })
})

describe('ExamQuestionsTab — «معاينة كطالب»', () => {
  const previewDialog = async () => (await screen.findByText(fill(words.preview.title, { title: 'اختبار قصير إلكتروني' }))).closest('[role="dialog"]') as HTMLElement

  it('shows the frozen questions as a student sees them — order, prompt, choices nobody can press — with NO key and no explanation, and asks the server nothing', async () => {
    const calls = mockTabApi({ questions: () => makeFrozenQuestions() })
    renderTab(makeOnlineExam({ status: 'scheduled' }))
    await screen.findByTestId('exam-questions-frozen-note')
    // The teacher's view marks the key…
    expect(screen.getAllByTestId('exam-question-key')).toHaveLength(3)
    const before = calls.length

    fireEvent.click(screen.getByText(words.preview.open).closest('button')!)
    const dialog = await previewDialog()
    expect(within(dialog).getByText(words.preview.note)).toBeInTheDocument()
    const questions = within(dialog).getAllByTestId('exam-preview-question')
    expect(questions).toHaveLength(3)
    expect(within(questions[0]!).getByText(fill(words.preview.question, { number: 1, total: 3 }))).toBeInTheDocument()
    expect(within(questions[0]!).getByText('ما ناتج print(2 ** 3) في بايثون؟')).toBeInTheDocument()
    expect(within(questions[0]!).getAllByRole('radio').map((radio) => radio.closest('label')!.textContent)).toEqual(['6', '8', '9'])
    expect(within(questions[1]!).getAllByRole('radio').map((radio) => radio.closest('label')!.textContent)).toEqual([words.answers.true, words.answers.false])
    // …the preview does not: no mark, no chosen answer, no explanation, nothing to press.
    expect(within(dialog).queryByTestId('exam-question-key')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(words.frozen.correct)).not.toBeInTheDocument()
    expect(dialog.querySelector('[data-key]')).toBeNull()
    expect(within(dialog).queryByText(words.frozen.explanation)).not.toBeInTheDocument()
    expect(dialog.textContent).not.toContain('العامل ** هو الأس')
    const radios = within(dialog).getAllByRole('radio')
    expect(radios).toHaveLength(8)
    expect(radios.every((radio) => (radio as HTMLInputElement).disabled && !(radio as HTMLInputElement).checked)).toBe(true)
    expect(calls).toHaveLength(before)

    fireEvent.click(within(dialog).getByText(words.preview.close).closest('button')!)
    await waitFor(() => expect(screen.queryByText(words.preview.note)).not.toBeInTheDocument())
  })

  it('previews a draft’s saved set too, and waits for a save while the editor differs from it', async () => {
    mockTabApi({ questions: () => makeExamQuestions() })
    renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))
    const open = () => screen.getByText(words.preview.open).closest('button')!
    expect(open()).toBeEnabled()

    await typePoints(1, '5')
    await waitFor(() => expect(open()).toBeDisabled())
    expect(screen.getByTestId('exam-questions-unsaved')).toHaveTextContent(words.preview.saveFirst)
    await typePoints(1, '4')
    await waitFor(() => expect(open()).toBeEnabled())

    fireEvent.click(open())
    const dialog = await previewDialog()
    expect(within(dialog).getAllByTestId('exam-preview-question')).toHaveLength(3)
    expect(within(dialog).queryByText(words.frozen.correct)).not.toBeInTheDocument()
  })
})

describe('ExamQuestionsTab — «كتابة سؤال جديد» (CH-0376)', () => {
  const editorOf = async () => (await screen.findByText(words.editor.write.saveAndAdd)).closest('.ant-drawer') as HTMLElement

  async function writeQuestion(drawer: HTMLElement) {
    fireEvent.change(within(drawer).getByLabelText(ar.questionBanks.editor.fields.promptAr), { target: { value: 'ما ناتج 2 + 3؟' } })
    const options = within(drawer).getAllByLabelText(ar.questionBanks.editor.fields.optionAr)
    fireEvent.change(options[0]!, { target: { value: '5' } })
    fireEvent.change(options[1]!, { target: { value: '6' } })
    fireEvent.click(within(drawer).getByLabelText('الخيار 1 هو الإجابة الصحيحة'))
  }

  it('opens the question form on the course bank with one «save and add» button; the saved question joins the list as ready, unsaved until «حفظ الأسئلة»', async () => {
    const created = makeBankQuestion({ id: fourth, prompt: { ar: 'ما ناتج 2 + 3؟' }, points: 1 })
    const calls = mockTabApi({
      questions: () => makeExamQuestions({ items: [], totalPoints: 0, problems: ['no_questions'] }),
      respond: (method, url) => (method === 'POST' && url === `/api/question-banks/${makeQuestionBank().id}/questions` ? jsonResponse(201, created) : undefined),
    })
    const { onUnsavedChange } = renderTab()
    const choose = await screen.findByTestId('exam-questions-choose')
    fireEvent.click(within(choose).getByText(words.editor.writeNew))

    const drawer = await editorOf()
    expect(within(drawer).getByText(fill(words.editor.write.bankNote, { name: makeQuestionBank().name.ar }))).toBeInTheDocument()
    expect(within(drawer).queryByText(ar.questionBanks.editor.saveDraft)).not.toBeInTheDocument()
    // The banks are read for the exam's course.
    expect(calls.find((call) => call.url === '/api/question-banks')!.query.get('courseId')).toBe(makeOnlineExam().class.course.id)

    await writeQuestion(drawer)
    fireEvent.click(within(drawer).getByText(words.editor.write.saveAndAdd).closest('button')!)

    await waitFor(() => expect(rows()).toHaveLength(1))
    const post = writes(calls, 'POST')
    expect(post).toHaveLength(1)
    expect((post[0]!.body as { status: string }).status).toBe('ready')
    expect(within(rows()[0]!).getByText('ما ناتج 2 + 3؟')).toBeInTheDocument()
    expect(await screen.findByText(words.editor.write.added)).toBeInTheDocument()
    expect(onUnsavedChange).toHaveBeenLastCalledWith(true)
    expect(writes(calls, 'PUT')).toHaveLength(0)
  })

  it('makes the bank «أسئلة <الدورة>» under the course when the course has none', async () => {
    const madeBank = makeQuestionBank({ id: '0193f000-0000-7000-8000-0000000b0009', name: { ar: 'أسئلة أساسيات بايثون' }, questionCount: 0, readyCount: 0 })
    const calls = mockTabApi({
      questions: () => makeExamQuestions(),
      banks: () => [],
      respond: (method, url) => (method === 'POST' && url === '/api/question-banks' ? jsonResponse(201, madeBank) : undefined),
    })
    renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))
    fireEvent.click(screen.getByText(words.editor.writeNew).closest('button')!)
    await editorOf()
    expect(writes(calls, 'POST')[0]!.body).toEqual({ name: { ar: 'أسئلة أساسيات بايثون' }, courseId: makeOnlineExam().class.course.id })
  })

  it('says so when the bank cannot be prepared, and opens no form', async () => {
    mockTabApi({ questions: () => makeExamQuestions(), banks: () => [], respond: () => jsonResponse(403, { statusCode: 403, message: 'no', code: 'permission_denied' }) })
    renderTab()
    await waitFor(() => expect(rows()).toHaveLength(3))
    fireEvent.click(screen.getByText(words.editor.writeNew).closest('button')!)
    expect(await screen.findByTestId('exam-questions-error')).toHaveTextContent(/تعذّر تجهيز بنك الأسئلة/)
    expect(screen.queryByText(words.editor.write.saveAndAdd)).not.toBeInTheDocument()
  })
})
