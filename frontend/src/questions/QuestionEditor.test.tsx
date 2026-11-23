// The question editor (MOD-09 phase 2 — OEX-T07): what it sends (API-266 / API-268), what it refuses before any
// request (the mirror of the server rules), where a server `question_invalid` lands, and that typed work is never
// dropped silently.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Question } from '../api/questionBanks'
import { ar } from '../i18n/ar'
import { clickWhenSettled } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { answerDiscardQuestion, latestDiscardQuestion, unloadWouldPrompt } from '../test/navigation'
import { BANK_ID, QUESTION_ID, QUESTION_IDS, QUESTION_TEACHER_PERMISSIONS, makeBank, makeDraftQuestion, makeQuestion, makeTrueFalseQuestion } from '../test/questionBanks'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { QuestionEditor } from './QuestionEditor'

const words = ar.questionBanks.editor
const problems = ar.questionBanks.problems

interface Call {
  method: string
  url: string
  body: unknown
  /** The body as it travelled, to tell a JSON boolean or number from a string. */
  raw: string
}

/** Records every request and answers with `answer(method, url, body)`. */
function mockApi(answer: (method: string, url: string, body: unknown) => Response) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const raw = init?.body ? String(init.body) : ''
    const body = raw ? JSON.parse(raw) : undefined
    calls.push({ method, url, body, raw })
    return answer(method, url, body)
  })
  return { calls }
}

/** The editor with spy parents: it stays mounted, so every close and every save is counted. */
async function renderEditor(question: Question | null = null) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const onStale = vi.fn()
  renderWithProviders(<QuestionEditor bank={makeBank()} question={question} onClose={onClose} onSaved={onSaved} onStale={onStale} />, {
    auth: makeAuth({ user: makeUser({ permissions: QUESTION_TEACHER_PERMISSIONS }) }),
    route: '/question-banks',
  })
  const title = await screen.findByText(question ? words.editTitle : words.createTitle)
  const drawer = title.closest('.ant-drawer-content-wrapper') as HTMLElement
  return { drawer, onClose, onSaved, onStale }
}

const button = (container: HTMLElement, text: string) => within(container).getByText(text).closest('button')!
const field = (container: HTMLElement, label: string) => within(container).getByLabelText(label)
const setText = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } })
const optionCards = (drawer: HTMLElement) => within(drawer).getAllByTestId('question-option')
const optionAr = (card: HTMLElement) => within(card).getByLabelText(words.fields.optionAr)
const optionEn = (card: HTMLElement) => within(card).getByLabelText(words.fields.optionEn)
const correctRadio = (drawer: HTMLElement, number: number) => within(drawer).getByLabelText(`الخيار ${number} هو الإجابة الصحيحة`)
const optionProblems = (drawer: HTMLElement) => within(drawer).getByTestId('question-options-problems')
const outcome = (drawer: HTMLElement) => within(drawer).getByTestId('question-editor-outcome')
/** The form messages on screen — not those antd is animating away (their leave motion never ends in jsdom). */
const shownErrors = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.ant-form-item-explain-error:not(.ant-form-show-help-item-leave)')).map((element) => element.textContent)
/** Escape as the browser sends it: the drawer listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const mask = () => document.querySelector<HTMLElement>('.ant-drawer-mask')!

describe('QuestionEditor — a new question (API-266)', () => {
  it('saves a single-choice question as ready: the options in order, one key, JSON booleans and numbers, the tags as stored', async () => {
    const created = makeQuestion({ id: QUESTION_IDS[3] })
    const { calls } = mockApi(() => jsonResponse(201, created))
    const { drawer, onSaved } = await renderEditor()

    // A new question is single choice with four rows and one point.
    expect(field(drawer, ar.questionBanks.types.single_choice)).toBeChecked()
    expect(optionCards(drawer)).toHaveLength(4)
    expect(field(drawer, words.fields.points)).toHaveValue('1')

    setText(field(drawer, words.fields.promptAr), ' ما ناتج print(2 + 3)؟ ')
    setText(field(drawer, words.fields.promptEn), 'What does print(2 + 3) output?')
    const cards = optionCards(drawer)
    setText(optionAr(cards[0]!), '4')
    setText(optionAr(cards[1]!), '5')
    setText(optionEn(cards[1]!), 'Five')
    setText(optionAr(cards[2]!), '6')
    // The fourth row is left empty: it is not an option.
    fireEvent.click(correctRadio(drawer, 2))
    expect(correctRadio(drawer, 2)).toBeChecked()
    expect(correctRadio(drawer, 1)).not.toBeChecked()
    setText(field(drawer, words.fields.points), '2.5')
    fireEvent.mouseDown(field(drawer, words.fields.difficulty))
    fireEvent.click(await screen.findByText(ar.questionBanks.difficulties.medium, { selector: '.ant-select-item-option-content' }))
    await userEvent.type(field(drawer, words.fields.tags), 'Loops{enter}')
    setText(field(drawer, words.fields.explanationAr), 'عامل الجمع يجمع العددين.')

    fireEvent.click(button(drawer, words.saveReady))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(onSaved).toHaveBeenCalledWith(created, true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'POST', url: `/api/question-banks/${BANK_ID}/questions` })
    expect(calls[0]!.body).toEqual({
      type: 'single_choice',
      prompt: { ar: 'ما ناتج print(2 + 3)؟', en: 'What does print(2 + 3) output?' },
      explanation: { ar: 'عامل الجمع يجمع العددين.' },
      points: 2.5,
      difficulty: 'medium',
      tags: ['loops'],
      status: 'ready',
      options: [
        { text: { ar: '4' }, isCorrect: false },
        { text: { ar: '5', en: 'Five' }, isCorrect: true },
        { text: { ar: '6' }, isCorrect: false },
      ],
    })
    // JSON booleans and a JSON number — never "true" or "2.5".
    expect(calls[0]!.raw).toContain('"isCorrect":true')
    expect(calls[0]!.raw).toContain('"isCorrect":false')
    expect(calls[0]!.raw).toContain('"points":2.5')
  })

  it('accepts a draft with only a prompt: the type, the prompt, the points and the status — nothing else', async () => {
    const created = makeDraftQuestion({ options: [] })
    const { calls } = mockApi(() => jsonResponse(201, created))
    const { drawer, onSaved } = await renderEditor()

    setText(field(drawer, words.fields.promptAr), 'أيّ هذه حلقة تكرار؟')
    fireEvent.click(button(drawer, words.saveDraft))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created, true))
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['POST', `/api/question-banks/${BANK_ID}/questions`, { type: 'single_choice', prompt: { ar: 'أيّ هذه حلقة تكرار؟' }, points: 1, status: 'draft' }],
    ])
  })

  it('asks even a draft for its Arabic prompt and its points, on their fields and without a request', async () => {
    const { calls } = mockApi(() => jsonResponse(500, {}))
    const { drawer, onSaved } = await renderEditor()

    setText(field(drawer, words.fields.promptEn), 'English only')
    setText(field(drawer, words.fields.points), '0')
    fireEvent.click(button(drawer, words.saveDraft))
    await waitFor(() => expect(shownErrors(drawer)).toEqual([words.validation.promptArRequired, words.validation.arabicFirst, words.validation.points]))

    setText(field(drawer, words.fields.points), '')
    await waitFor(() => expect(shownErrors(drawer)).toContain(words.validation.pointsRequired))
    setText(field(drawer, words.fields.points), '2.555')
    await waitFor(() => expect(shownErrors(drawer)).toContain(words.validation.points))
    expect(calls).toHaveLength(0)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('refuses a ready save that breaks a rule before any request, where it is fixed, and the messages follow the edits', async () => {
    const { calls } = mockApi(() => jsonResponse(500, {}))
    const { drawer, onSaved } = await renderEditor()
    setText(field(drawer, words.fields.promptAr), 'ما ناتج 2 + 3؟')

    // Nothing written in the rows: no options, no key.
    fireEvent.click(button(drawer, words.saveReady))
    await waitFor(() => expect(optionProblems(drawer)).toHaveTextContent(problems.options_too_few))
    expect(optionProblems(drawer)).toHaveTextContent(problems.correct_option_required)
    // The same above the form, with the headline of a local refusal (the save buttons live in the footer).
    expect(within(outcome(drawer)).getByText(words.refused)).toBeInTheDocument()
    expect(within(outcome(drawer)).getByText(problems.options_too_few)).toBeInTheDocument()
    expect(outcome(drawer)).toHaveFocus()

    // One option written: still too few, still no key.
    const cards = optionCards(drawer)
    setText(optionAr(cards[0]!), '4')
    expect(optionProblems(drawer)).toHaveTextContent(problems.options_too_few)
    // A second one: only the key is missing now.
    setText(optionAr(cards[1]!), '5')
    expect(optionProblems(drawer)).not.toHaveTextContent(problems.options_too_few)
    expect(optionProblems(drawer)).toHaveTextContent(problems.correct_option_required)
    // The key marked: nothing is left, and the headline goes with the last problem.
    fireEvent.click(correctRadio(drawer, 2))
    expect(optionProblems(drawer)).toBeEmptyDOMElement()
    expect(within(outcome(drawer)).queryByText(words.refused)).not.toBeInTheDocument()

    // The same Arabic text twice is refused in a draft too.
    setText(optionAr(cards[2]!), ' 5 ')
    fireEvent.click(button(drawer, words.saveDraft))
    await waitFor(() => expect(optionProblems(drawer)).toHaveTextContent(problems.duplicate_options))
    expect(calls).toHaveLength(0)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('refuses a row it cannot send on that row: English without Arabic, the key on a row without a text', async () => {
    const { calls } = mockApi(() => jsonResponse(500, {}))
    const { drawer } = await renderEditor()
    setText(field(drawer, words.fields.promptAr), 'سؤال')
    const cards = optionCards(drawer)
    setText(optionEn(cards[0]!), 'Four')
    fireEvent.click(correctRadio(drawer, 2))

    fireEvent.click(button(drawer, words.saveDraft))
    await waitFor(() => expect(shownErrors(cards[0]!)).toEqual([words.validation.optionArabicFirst]))
    expect(shownErrors(cards[1]!)).toEqual([words.validation.correctOptionBlank])

    // Each message goes once its row is right: the Arabic text written, the key moved onto a written row.
    setText(optionAr(cards[0]!), '4')
    await waitFor(() => expect(shownErrors(cards[0]!)).toEqual([]))
    fireEvent.click(correctRadio(drawer, 1))
    await waitFor(() => expect(shownErrors(cards[1]!)).toEqual([]))
    expect(calls).toHaveLength(0)
  })

  it('saves a true/false question: the key is asked for when ready, and travels as a JSON boolean — false included', async () => {
    const created = makeTrueFalseQuestion({ correctAnswer: false })
    const { calls } = mockApi(() => jsonResponse(201, created))
    const { drawer, onSaved } = await renderEditor()

    fireEvent.click(field(drawer, ar.questionBanks.types.true_false))
    // The options give way to the key.
    await waitFor(() => expect(within(drawer).queryByTestId('question-options')).not.toBeInTheDocument())
    setText(field(drawer, words.fields.promptAr), 'بايثون لغة مفسَّرة.')

    fireEvent.click(button(drawer, words.saveReady))
    await waitFor(() => expect(shownErrors(drawer)).toEqual([problems.correct_answer_required]))
    expect(within(outcome(drawer)).getByText(words.refused)).toBeInTheDocument()
    expect(calls).toHaveLength(0)

    fireEvent.click(field(drawer, words.answerFalse))
    await waitFor(() => expect(shownErrors(drawer)).toEqual([]))
    fireEvent.click(button(drawer, words.saveReady))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created, true))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.body).toEqual({ type: 'true_false', prompt: { ar: 'بايثون لغة مفسَّرة.' }, points: 1, status: 'ready', correctAnswer: false })
    expect(calls[0]!.raw).toContain('"correctAnswer":false')
  })

  it('adds, removes and moves options: the body follows the order on screen, and a moved key stays with its row', async () => {
    const { calls } = mockApi(() => jsonResponse(201, makeQuestion()))
    const { drawer, onSaved } = await renderEditor()
    setText(field(drawer, words.fields.promptAr), 'سؤال')
    let cards = optionCards(drawer)
    setText(optionAr(cards[0]!), 'أ')
    setText(optionAr(cards[1]!), 'ب')
    setText(optionAr(cards[2]!), 'ج')
    fireEvent.click(correctRadio(drawer, 1))

    // The first row cannot go up, the last one cannot go down.
    expect(field(drawer, 'نقل الخيار 1 إلى أعلى')).toBeDisabled()
    expect(field(drawer, 'نقل الخيار 4 إلى أسفل')).toBeDisabled()
    // «أ» (the key) down one place: ب، أ، ج. The key stays with its row, and so does the focus — on the same arrow.
    fireEvent.click(field(drawer, 'نقل الخيار 1 إلى أسفل'))
    await waitFor(() => expect(optionAr(optionCards(drawer)[1]!)).toHaveValue('أ'))
    expect(correctRadio(drawer, 2)).toBeChecked()
    expect(correctRadio(drawer, 1)).not.toBeChecked()
    await waitFor(() => expect(field(drawer, 'نقل الخيار 2 إلى أسفل')).toHaveFocus())
    // «ج» down to the last place: its «down» is off there, so the focus takes its «up».
    fireEvent.click(field(drawer, 'نقل الخيار 3 إلى أسفل'))
    await waitFor(() => expect(optionAr(optionCards(drawer)[3]!)).toHaveValue('ج'))
    await waitFor(() => expect(field(drawer, 'نقل الخيار 4 إلى أعلى')).toHaveFocus())

    // A fifth row, which takes the focus; then the empty third one removed, and the focus goes to «add».
    fireEvent.click(button(drawer, words.addOption))
    await waitFor(() => expect(optionCards(drawer)).toHaveLength(5))
    cards = optionCards(drawer)
    await waitFor(() => expect(optionAr(cards[4]!)).toHaveFocus())
    setText(optionAr(cards[4]!), 'د')
    fireEvent.click(field(drawer, 'حذف الخيار 3'))
    await waitFor(() => expect(optionCards(drawer)).toHaveLength(4))
    await waitFor(() => expect(button(drawer, words.addOption)).toHaveFocus())

    fireEvent.click(button(drawer, words.saveReady))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect((calls[0]!.body as { options: unknown }).options).toEqual([
      { text: { ar: 'ب' }, isCorrect: false },
      { text: { ar: 'أ' }, isCorrect: true },
      { text: { ar: 'ج' }, isCorrect: false },
      { text: { ar: 'د' }, isCorrect: false },
    ])
  })

  it('keeps two rows at least and ten at most, in one labelled group whose radios share a name', async () => {
    mockApi(() => jsonResponse(500, {}))
    const { drawer } = await renderEditor(makeDraftQuestion())

    // A draft with one option still shows two rows; neither can be removed.
    expect(optionCards(drawer)).toHaveLength(2)
    expect(field(drawer, 'حذف الخيار 1')).toBeDisabled()
    expect(field(drawer, 'حذف الخيار 2')).toBeDisabled()
    const group = within(drawer).getByTestId('question-options')
    expect(group).toHaveAttribute('role', 'group')
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)).toHaveTextContent(words.fields.options)
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    expect(radios).toHaveLength(2)
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1)
    expect(radios[0]!.name).not.toBe('')

    for (let count = 2; count < 10; count += 1) fireEvent.click(button(drawer, words.addOption))
    await waitFor(() => expect(optionCards(drawer)).toHaveLength(10))
    expect(button(drawer, words.addOption)).toBeDisabled()
    expect(field(drawer, 'حذف الخيار 1')).toBeEnabled()
  })
})

describe('QuestionEditor — an existing question (API-268)', () => {
  it('shows the question as the server holds it, its type fixed, and sends only what changed', async () => {
    const question = makeQuestion()
    const updated = makeQuestion({ points: 3 })
    const { calls } = mockApi(() => jsonResponse(200, updated))
    const { drawer, onSaved } = await renderEditor(question)

    expect(within(drawer).getByTestId('question-type')).toHaveTextContent(ar.questionBanks.types.single_choice)
    expect(within(drawer).getByText(words.hints.typeFixed)).toBeInTheDocument()
    expect(within(drawer).queryByLabelText(ar.questionBanks.types.true_false)).not.toBeInTheDocument()
    expect(field(drawer, words.fields.promptAr)).toHaveValue('ما ناتج print(2 + 3) في بايثون؟')
    expect(optionCards(drawer).map((card) => (optionAr(card) as HTMLInputElement).value)).toEqual(['4', '5', '6', '23'])
    expect(correctRadio(drawer, 2)).toBeChecked()
    expect(within(drawer).getByText('python')).toBeInTheDocument()
    expect(within(drawer).getByText('حساب')).toBeInTheDocument()
    // No exam uses it: no note about frozen copies.
    expect(within(drawer).queryByTestId('question-in-use')).not.toBeInTheDocument()

    setText(field(drawer, words.fields.points), '3')
    fireEvent.click(button(drawer, words.saveReady))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated, false))
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([['PATCH', `/api/questions/${QUESTION_ID}`, { points: 3 }]])
  })

  it('sends nothing when nothing changed, and says so', async () => {
    const { calls } = mockApi(() => jsonResponse(500, {}))
    const { drawer, onClose, onSaved } = await renderEditor(makeQuestion())

    fireEvent.click(button(drawer, words.saveReady))
    expect(await screen.findByText(words.nothingChanged)).toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(0)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('sends the options as the whole ordered list when one of them changed, with the Turkish text the form does not show', async () => {
    const question = makeQuestion()
    const { calls } = mockApi(() => jsonResponse(200, question))
    const { drawer, onSaved } = await renderEditor(question)

    // The key moves from «5» to «6».
    fireEvent.click(correctRadio(drawer, 3))
    fireEvent.click(button(drawer, words.saveReady))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(calls[0]!.body).toEqual({
      options: [
        { text: { ar: '4' }, isCorrect: false },
        { text: { ar: '5' }, isCorrect: false },
        { text: { ar: '6', tr: 'altı' }, isCorrect: true },
        { text: { ar: '23' }, isCorrect: false },
      ],
    })
  })

  it('makes a ready question a draft again with «save as draft»: the status alone', async () => {
    const question = makeQuestion()
    const { calls } = mockApi(() => jsonResponse(200, makeQuestion({ status: 'draft' })))
    const { drawer, onSaved } = await renderEditor(question)

    fireEvent.click(button(drawer, words.saveDraft))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(calls[0]!.body).toEqual({ status: 'draft' })
  })

  it('makes a completed draft ready: the options written and the status, refused locally while it is incomplete', async () => {
    const draft = makeDraftQuestion()
    const { calls } = mockApi(() => jsonResponse(200, makeQuestion({ id: draft.id })))
    const { drawer, onSaved } = await renderEditor(draft)

    fireEvent.click(button(drawer, words.saveReady))
    await waitFor(() => expect(optionProblems(drawer)).toHaveTextContent(problems.options_too_few))
    expect(calls).toHaveLength(0)

    setText(optionAr(optionCards(drawer)[1]!), 'if')
    fireEvent.click(correctRadio(drawer, 1))
    fireEvent.click(button(drawer, words.saveReady))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(calls[0]!.body).toEqual({
      status: 'ready',
      options: [
        { text: { ar: 'for' }, isCorrect: true },
        { text: { ar: 'if' }, isCorrect: false },
      ],
    })
  })

  it('edits the key of a true/false question and clears its explanation with null', async () => {
    const question = makeTrueFalseQuestion({ explanation: { ar: 'تُنفَّذ سطراً سطراً.' } })
    const { calls } = mockApi(() => jsonResponse(200, question))
    const { drawer, onSaved } = await renderEditor(question)

    expect(field(drawer, words.answerTrue)).toBeChecked()
    expect(within(drawer).queryByTestId('question-options')).not.toBeInTheDocument()
    fireEvent.click(field(drawer, words.answerFalse))
    setText(field(drawer, words.fields.explanationAr), '')
    fireEvent.click(button(drawer, words.saveReady))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(calls[0]!.body).toEqual({ correctAnswer: false, explanation: null })
    expect(calls[0]!.raw).toContain('"correctAnswer":false')
    expect(calls[0]!.raw).toContain('"explanation":null')
  })

  it('says that an exam already made available keeps its own copy when exams use the question', async () => {
    mockApi(() => jsonResponse(500, {}))
    const { drawer } = await renderEditor(makeQuestion({ examCount: 2 }))

    const note = within(drawer).getByTestId('question-in-use')
    expect(within(note).getByText('مستعمل في اختبارين')).toBeInTheDocument()
    expect(within(note).getByText(words.inUse)).toBeInTheDocument()
  })

  it('gives an archived question one save, which keeps it archived', async () => {
    const archived = makeQuestion({ status: 'archived' })
    const { calls } = mockApi(() => jsonResponse(200, makeQuestion({ status: 'archived', points: 4 })))
    const { drawer, onSaved } = await renderEditor(archived)

    expect(within(drawer).getByText(words.hints.archived)).toBeInTheDocument()
    expect(within(drawer).queryByText(words.saveDraft)).not.toBeInTheDocument()
    expect(within(drawer).queryByText(words.saveReady)).not.toBeInTheDocument()
    setText(field(drawer, words.fields.points), '4')
    fireEvent.click(button(drawer, ar.common.save))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(calls[0]!.body).toEqual({ points: 4 })
  })
})

describe('QuestionEditor — the server’s refusals', () => {
  it('puts a server question_invalid on the form, problem by problem, and keeps what was typed', async () => {
    const question = makeQuestion()
    const { calls } = mockApi(() => jsonResponse(400, { statusCode: 400, error: 'Bad Request', code: 'question_invalid', message: 'rules', problems: ['options_too_few', 'correct_option_required'] }))
    const { drawer, onSaved } = await renderEditor(question)

    // The mirror finds nothing: the question changed elsewhere, and only the server knows.
    setText(field(drawer, words.fields.promptEn), 'What is 2 + 3?')
    fireEvent.click(button(drawer, words.saveReady))

    await waitFor(() => expect(within(outcome(drawer)).getByText(words.serverRefused)).toBeInTheDocument())
    expect(optionProblems(drawer)).toHaveTextContent(problems.options_too_few)
    expect(optionProblems(drawer)).toHaveTextContent(problems.correct_option_required)
    expect(within(outcome(drawer)).getByText(problems.correct_option_required)).toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(field(drawer, words.fields.promptEn)).toHaveValue('What is 2 + 3?')
    // The buttons work again: the session is not over.
    expect(button(drawer, words.saveReady)).toBeEnabled()
  })

  it('puts a server correct_answer_required on the key of a true/false question', async () => {
    const question = makeTrueFalseQuestion()
    mockApi(() => jsonResponse(400, { statusCode: 400, code: 'question_invalid', message: 'rules', problems: ['correct_answer_required'] }))
    const { drawer } = await renderEditor(question)

    setText(field(drawer, words.fields.points), '2')
    fireEvent.click(button(drawer, words.saveReady))
    await waitFor(() => expect(shownErrors(drawer)).toEqual([problems.correct_answer_required]))
    expect(within(outcome(drawer)).getByText(words.serverRefused)).toBeInTheDocument()
  })

  it('shows any other refusal above the form in words', async () => {
    mockApi(() => jsonResponse(403, { statusCode: 403, code: 'permission_denied', message: 'denied', missing: ['questions.manage'] }))
    const { drawer, onSaved, onStale } = await renderEditor(makeQuestion())

    setText(field(drawer, words.fields.points), '5')
    fireEvent.click(button(drawer, words.saveReady))
    expect(await within(outcome(drawer)).findByText('ليست لديك الصلاحية اللازمة لهذا الإجراء (questions.manage)')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    expect(onStale).not.toHaveBeenCalled()
  })

  it('ends the saving of a question that is gone, keeps its text to copy, and tells the page', async () => {
    mockApi(() => jsonResponse(404, { statusCode: 404, code: 'question_not_found', message: 'gone', questionId: QUESTION_ID }))
    const { drawer, onSaved, onStale } = await renderEditor(makeQuestion())

    setText(field(drawer, words.fields.promptAr), 'نص جديد للسؤال')
    fireEvent.click(button(drawer, words.saveReady))

    expect(await within(outcome(drawer)).findByText(ar.questionBanks.errors.question_not_found)).toBeInTheDocument()
    expect(within(outcome(drawer)).getByText(words.stopped)).toBeInTheDocument()
    expect(onStale).toHaveBeenCalledWith('question')
    expect(onSaved).not.toHaveBeenCalled()
    await waitFor(() => expect(button(drawer, words.saveReady)).toBeDisabled())
    expect(button(drawer, words.saveDraft)).toBeDisabled()
    // The text stays, and stays selectable.
    expect(field(drawer, words.fields.promptAr)).toHaveValue('نص جديد للسؤال')
    expect(field(drawer, words.fields.promptAr)).toBeEnabled()
  })

  it('tells the page when the bank of a new question is gone', async () => {
    mockApi(() => jsonResponse(404, { statusCode: 404, code: 'question_bank_not_found', message: 'gone', bankId: BANK_ID }))
    const { drawer, onStale } = await renderEditor()

    setText(field(drawer, words.fields.promptAr), 'سؤال')
    fireEvent.click(button(drawer, words.saveDraft))
    expect(await within(outcome(drawer)).findByText(ar.questionBanks.errors.question_bank_not_found)).toBeInTheDocument()
    expect(onStale).toHaveBeenCalledWith('bank')
  })
})

describe('QuestionEditor — unsaved work', () => {
  it('closes at once on Escape, a mask click and the close button while nothing is written', async () => {
    mockApi(() => jsonResponse(500, {}))
    const { onClose } = await renderEditor()
    expect(unloadWouldPrompt()).toBe(false)

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    await clickWhenSettled(mask)
    expect(onClose).toHaveBeenCalledTimes(2)
    await clickWhenSettled(closeButton)
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()
  })

  it('keeps a typed question on Escape and a mask click, holds a reload, and asks before the close button or «cancel» drops it', async () => {
    const { calls } = mockApi(() => jsonResponse(500, {}))
    const { drawer, onClose } = await renderEditor()
    const prompt = field(drawer, words.fields.promptAr)
    setText(prompt, 'ما ناتج 2 + 3؟')

    pressEscape()
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expect(prompt).toHaveValue('ما ناتج 2 + 3؟')
    expect(unloadWouldPrompt()).toBe(true)
    expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()

    await clickWhenSettled(closeButton)
    await answerDiscardQuestion(await latestDiscardQuestion(), 'keep')
    expect(onClose).not.toHaveBeenCalled()
    expect(prompt).toHaveValue('ما ناتج 2 + 3؟')

    fireEvent.click(button(drawer, ar.common.cancel))
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(calls).toHaveLength(0)
  })

  it('holds a marked key and a changed field of an existing question, and nothing once they are changed back', async () => {
    mockApi(() => jsonResponse(500, {}))
    const { drawer, onClose } = await renderEditor(makeQuestion())

    // The key alone is work: marking it fires no form event of its own.
    fireEvent.click(correctRadio(drawer, 1))
    expect(unloadWouldPrompt()).toBe(true)
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(correctRadio(drawer, 2))
    expect(unloadWouldPrompt()).toBe(false)

    setText(field(drawer, words.fields.points), '3')
    expect(unloadWouldPrompt()).toBe(true)
    setText(field(drawer, words.fields.points), '2')
    expect(unloadWouldPrompt()).toBe(false)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
