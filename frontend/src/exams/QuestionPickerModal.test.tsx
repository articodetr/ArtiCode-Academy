// «إضافة أسئلة» against a mocked API-260 (banks) and API-265 (a bank's ready questions): what it asks the server, what
// can be ticked, and what it hands to the editor.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Question, QuestionBank, QuestionList } from '../api/questionBanks'
import { ar } from '../i18n/ar'
import { BANK_QUESTION_IDS, QUESTION_BANK_ID, QUESTION_BANK_ID_2, makeBankQuestion, makeLenQuestion, makeQuestionBank, makeQuestionList } from '../test/examQuestions'
import { jsonResponse, mockFetch } from '../test/http'
import { renderWithProviders } from '../test/render'
import { PICKER_PAGE_SIZE, QuestionPickerModal } from './QuestionPickerModal'

const words = ar.examOnline.picker
const [first, , , fourth, fifth] = BANK_QUESTION_IDS
const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), template)

const pythonBank = makeQuestionBank()
const mathBank = makeQuestionBank({ id: QUESTION_BANK_ID_2, name: { ar: 'أسئلة الرياضيات' }, course: null, readyCount: 2 })
/** The power question of the exam as its bank lists it: already linked in these tests. */
const linkedQuestion = makeBankQuestion({ id: first, prompt: { ar: 'ما ناتج print(2 ** 3) في بايثون؟' }, points: 4 })
const defQuestion = makeBankQuestion()
const lenQuestion = makeLenQuestion()
const mathQuestion = makeBankQuestion({ id: 'math-1', bankId: QUESTION_BANK_ID_2, prompt: { ar: 'كم يساوي 7 × 8؟' }, points: 1 })

interface PickerCall {
  url: string
  query: Record<string, string>
}

interface PickerApiOptions {
  banks?: (query: URLSearchParams) => QuestionBank[]
  questions?: (query: URLSearchParams) => QuestionList | Response
}

function mockPickerApi({ banks = () => [pythonBank, mathBank], questions = () => makeQuestionList([linkedQuestion, defQuestion, lenQuestion]) }: PickerApiOptions = {}) {
  const calls: PickerCall[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    calls.push({ url: `${init?.method ?? 'GET'} ${parsed.pathname}`, query: Object.fromEntries(parsed.searchParams) })
    if (parsed.pathname === '/api/question-banks') return jsonResponse(200, { items: banks(parsed.searchParams), nextCursor: null })
    if (parsed.pathname === '/api/questions') {
      const answer = questions(parsed.searchParams)
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return calls
}

function renderPicker({ linkedIds = new Set([first]), room = 197 }: { linkedIds?: ReadonlySet<string>; room?: number } = {}) {
  const onAdd = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<QuestionPickerModal linkedIds={linkedIds} room={room} onAdd={onAdd} onClose={onClose} />)
  const dialog = screen.getByText(words.title).closest('[role="dialog"]') as HTMLElement
  return { dialog, onAdd, onClose }
}

const bankLabel = (bank: QuestionBank) => fill(words.bankOption, { name: bank.name.ar, ready: bank.readyCount })
const questionCalls = (calls: PickerCall[]) => calls.filter((call) => call.url === 'GET /api/questions')
const checkbox = (dialog: HTMLElement, question: Question) => within(dialog).getByLabelText(question.prompt.ar) as HTMLInputElement
const submitButton = (dialog: HTMLElement, count: number) => within(dialog).getByText(fill(words.submit, { value: count })).closest('button')!

async function chooseBank(dialog: HTMLElement, bank: QuestionBank) {
  fireEvent.mouseDown(within(dialog).getByLabelText(words.bank))
  fireEvent.click(await screen.findByText(bankLabel(bank), { selector: '.ant-select-item-option-content' }))
}

describe('QuestionPickerModal', () => {
  it('asks for a bank first: the banks the caller sees, each with its ready count, searched by name on the server', async () => {
    const calls = mockPickerApi({ banks: (query) => (query.get('q') ? [mathBank] : [pythonBank, mathBank]) })
    const { dialog } = renderPicker()
    expect(within(dialog).getByText(words.chooseBank)).toBeInTheDocument()
    expect(submitButton(dialog, 0)).toBeDisabled()
    // No question is read before a bank is chosen.
    await waitFor(() => expect(calls.some((call) => call.url === 'GET /api/question-banks')).toBe(true))
    expect(questionCalls(calls)).toEqual([])

    const bank = within(dialog).getByLabelText(words.bank)
    fireEvent.mouseDown(bank)
    expect(await screen.findByText(bankLabel(pythonBank), { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
    await userEvent.type(bank, 'رياض')
    await waitFor(() => expect(calls.some((call) => call.url === 'GET /api/question-banks' && call.query.q === 'رياض')).toBe(true))
    expect(await screen.findByText(bankLabel(mathBank), { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(bankLabel(pythonBank), { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument())
  })

  it('lists the READY questions of the chosen bank with their type and default points; a linked one is shown as added and cannot be ticked', async () => {
    const calls = mockPickerApi()
    const { dialog } = renderPicker()
    await chooseBank(dialog, pythonBank)
    await within(dialog).findByLabelText(defQuestion.prompt.ar)

    expect(questionCalls(calls)).toEqual([{ url: 'GET /api/questions', query: { bankId: QUESTION_BANK_ID, status: 'ready', limit: String(PICKER_PAGE_SIZE) } }])
    expect(within(dialog).getByText(words.onlyReady)).toBeInTheDocument()
    const rows = within(dialog).getAllByTestId('question-picker-row')
    expect(rows).toHaveLength(3)
    expect(checkbox(dialog, linkedQuestion)).toBeDisabled()
    expect(checkbox(dialog, linkedQuestion)).not.toBeChecked()
    expect(within(rows[0]!).getByText(words.added)).toBeInTheDocument()
    expect(within(rows[1]!).queryByText(words.added)).not.toBeInTheDocument()
    expect(checkbox(dialog, defQuestion)).toBeEnabled()
    expect(within(rows[1]!).getByText(ar.examOnline.types.single_choice)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(fill(ar.examOnline.questions.points, { points: 2 }))).toBeInTheDocument()
    expect(within(rows[2]!).getByText(ar.examOnline.types.true_false)).toBeInTheDocument()
    expect(within(rows[2]!).getByText(fill(ar.examOnline.questions.points, { points: 1.5 }))).toBeInTheDocument()
    // The key of a bank question is nobody's business here.
    expect(dialog.textContent).not.toContain('func')
  })

  it('hands over the ticked questions in the order they were ticked, each with its bank — also across two banks', async () => {
    mockPickerApi({ questions: (query) => makeQuestionList(query.get('bankId') === QUESTION_BANK_ID_2 ? [mathQuestion] : [linkedQuestion, defQuestion, lenQuestion]) })
    const { dialog, onAdd, onClose } = renderPicker()
    await chooseBank(dialog, pythonBank)
    fireEvent.click(await within(dialog).findByLabelText(lenQuestion.prompt.ar))
    fireEvent.click(checkbox(dialog, defQuestion))
    expect(within(dialog).getByTestId('question-picker-selected')).toHaveTextContent(fill(words.selected, { value: 2 }))
    // Changed my mind about one, then picked it again: it now comes last.
    fireEvent.click(checkbox(dialog, lenQuestion))
    expect(submitButton(dialog, 1)).toBeEnabled()
    fireEvent.click(checkbox(dialog, lenQuestion))

    await chooseBank(dialog, mathBank)
    fireEvent.click(await within(dialog).findByLabelText(mathQuestion.prompt.ar))
    expect(within(dialog).queryByLabelText(defQuestion.prompt.ar)).not.toBeInTheDocument()
    fireEvent.click(submitButton(dialog, 3))

    expect(onAdd).toHaveBeenCalledTimes(1)
    const picked = onAdd.mock.calls[0]![0] as { question: Question; bank: QuestionBank }[]
    expect(picked.map((entry) => [entry.question.id, entry.bank.id])).toEqual([
      [fourth, QUESTION_BANK_ID],
      [fifth, QUESTION_BANK_ID],
      ['math-1', QUESTION_BANK_ID_2],
    ])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('searches the bank’s questions by their text and reads on with «تحميل المزيد»; the ticks survive both', async () => {
    const more = makeBankQuestion({ id: 'more-1', prompt: { ar: 'ما امتداد ملفات بايثون؟' } })
    const calls = mockPickerApi({
      questions: (query) => {
        if (query.get('q')) return makeQuestionList([lenQuestion])
        return query.get('cursor') ? makeQuestionList([more]) : makeQuestionList([linkedQuestion, defQuestion], 'cursor-2')
      },
    })
    const { dialog, onAdd } = renderPicker()
    await chooseBank(dialog, pythonBank)
    fireEvent.click(await within(dialog).findByLabelText(defQuestion.prompt.ar))

    fireEvent.click(within(dialog).getByText(words.loadMore).closest('button')!)
    expect(await within(dialog).findByLabelText(more.prompt.ar)).toBeInTheDocument()
    expect(questionCalls(calls).at(-1)!.query).toEqual({ bankId: QUESTION_BANK_ID, status: 'ready', limit: String(PICKER_PAGE_SIZE), cursor: 'cursor-2' })
    // The page was appended, and the tick is still there.
    expect(within(dialog).getAllByTestId('question-picker-row')).toHaveLength(3)
    expect(checkbox(dialog, defQuestion)).toBeChecked()
    expect(within(dialog).queryByText(words.loadMore)).not.toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText(words.search), 'len{enter}')
    expect(await within(dialog).findByLabelText(lenQuestion.prompt.ar)).toBeInTheDocument()
    // A search starts from the first page again.
    expect(questionCalls(calls).at(-1)!.query).toEqual({ bankId: QUESTION_BANK_ID, q: 'len', status: 'ready', limit: String(PICKER_PAGE_SIZE) })
    await waitFor(() => expect(within(dialog).getAllByTestId('question-picker-row')).toHaveLength(1))
    fireEvent.click(checkbox(dialog, lenQuestion))
    fireEvent.click(submitButton(dialog, 2))
    expect((onAdd.mock.calls[0]![0] as { question: Question }[]).map((entry) => entry.question.id)).toEqual([fourth, fifth])
  })

  it('stops ticking at the room the exam has left, and says so', async () => {
    mockPickerApi()
    const { dialog } = renderPicker({ room: 1 })
    await chooseBank(dialog, pythonBank)
    await within(dialog).findByLabelText(defQuestion.prompt.ar)
    expect(within(dialog).getByText(fill(words.room, { value: 1, max: 200 }))).toBeInTheDocument()

    fireEvent.click(checkbox(dialog, defQuestion))
    expect(within(dialog).getByText(fill(words.full, { max: 200 }))).toBeInTheDocument()
    expect(checkbox(dialog, lenQuestion)).toBeDisabled()
    // The ticked one can still be given back.
    expect(checkbox(dialog, defQuestion)).toBeEnabled()
    fireEvent.click(checkbox(dialog, defQuestion))
    expect(checkbox(dialog, lenQuestion)).toBeEnabled()
  })

  it('says a bank has no ready question, and that a search matches none', async () => {
    mockPickerApi({ questions: () => makeQuestionList([]) })
    const { dialog } = renderPicker()
    await chooseBank(dialog, pythonBank)
    expect(await within(dialog).findByText(words.empty)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(words.search), 'شيء{enter}')
    expect(await within(dialog).findByText(words.emptySearch)).toBeInTheDocument()
  })

  it('says the questions could not be loaded and asks again on «retry»', async () => {
    let fail = true
    const calls = mockPickerApi({ questions: () => (fail ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : makeQuestionList([defQuestion])) })
    const { dialog } = renderPicker()
    await chooseBank(dialog, pythonBank)
    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText(words.loadError)).toBeInTheDocument()
    expect(within(alert).getByText(ar.login.errors.server)).toBeInTheDocument()
    fail = false
    fireEvent.click(within(alert).getByText(words.retry).closest('button')!)
    expect(await within(dialog).findByLabelText(defQuestion.prompt.ar)).toBeInTheDocument()
    expect(questionCalls(calls)).toHaveLength(2)
  })

  it('leaves at once on «cancel», ticks or not — nothing was sent to the server', async () => {
    const calls = mockPickerApi()
    const { dialog, onAdd, onClose } = renderPicker()
    await chooseBank(dialog, pythonBank)
    fireEvent.click(await within(dialog).findByLabelText(defQuestion.prompt.ar))
    fireEvent.click(within(dialog).getByText(ar.common.cancel).closest('button')!)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onAdd).not.toHaveBeenCalled()
    expect(calls.every((call) => call.url.startsWith('GET '))).toBe(true)
  })
})
