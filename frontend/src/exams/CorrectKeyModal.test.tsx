// «تصحيح المفتاح» on its own (API-272): what it refuses before any request, what it holds as unsent work and how it
// lets go of it, and which refusals end the dialog. The body it sends and the server's answer are also exercised
// through the tab (ExamQuestionsTab.test.tsx).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExamQuestionItem } from '../api/examQuestions'
import { ar } from '../i18n/ar'
import { EXAM_QUESTION_IDS, POWER_OPTION_IDS, frozenItems, makeKeyCorrectionResult } from '../test/examQuestions'
import { EXAM_ID } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { unloadWouldPrompt } from '../test/navigation'
import { renderWithProviders } from '../test/render'
import { CorrectKeyModal } from './CorrectKeyModal'

const words = ar.examOnline.key
const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), template)
const [power, lists] = frozenItems()

/** Records the corrections sent and answers each with `respond()`. */
function mockKeyApi(respond: () => Response = () => jsonResponse(200, makeKeyCorrectionResult())) {
  const posts: { url: string; body: unknown }[] = []
  mockFetch((url, init) => {
    posts.push({ url: new URL(url, 'http://localhost').pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return respond()
  })
  return posts
}

function renderModal(item: ExamQuestionItem = power!, number = 1) {
  const handlers = { onDone: vi.fn(), onStale: vi.fn(), onCancel: vi.fn(), onDirtyChange: vi.fn() }
  renderWithProviders(<CorrectKeyModal examId={EXAM_ID} item={item} number={number} {...handlers} />)
  const dialog = screen.getByText(fill(words.title, { number })).closest('[role="dialog"]') as HTMLElement
  return { dialog, ...handlers }
}

const reasonOf = (dialog: HTMLElement) => within(dialog).getByLabelText(words.reason)
const submit = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByText(words.submit).closest('button')!)
const closeButton = (dialog: HTMLElement) => dialog.querySelector<HTMLButtonElement>('.ant-modal-close')!
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })

/** The latest «discard?» question of the dialog (antd shows a confirm's title twice; an answered one may linger). */
async function discardQuestion(previous?: HTMLElement): Promise<HTMLElement> {
  const latest = () => {
    const titles = screen.queryAllByText(words.discard.title)
    return titles.length > 0 ? (titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement) : null
  }
  await waitFor(() => {
    const question = latest()
    if (!question || question === previous) throw new Error('no new discard question yet')
  })
  return latest()!
}

describe('CorrectKeyModal', () => {
  it('shows the question, its own options with the recorded key chosen, and what a correction does', () => {
    mockKeyApi()
    const { dialog } = renderModal()
    expect(within(dialog).getByTestId('correct-key-prompt')).toHaveTextContent(power!.question.prompt.ar)
    expect(within(dialog).getByRole('radiogroup', { name: words.answer })).toBeInTheDocument()
    const radios = within(dialog).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.checked)).toEqual([false, true, false])
    expect(radios[1]!.closest('label')).toHaveTextContent(words.current)
    expect(radios[0]!.closest('label')).not.toHaveTextContent(words.current)
    expect(within(dialog).getByText(words.effectTitle)).toBeInTheDocument()
    expect(within(dialog).getByText(words.effect)).toBeInTheDocument()
    expect(within(dialog).getByText(words.reasonHint)).toBeInTheDocument()
  })

  it('offers «صحيح» and «خطأ» for a true/false question, the recorded answer chosen', () => {
    mockKeyApi()
    const { dialog } = renderModal(lists!, 2)
    const radios = within(dialog).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.closest('label')!.textContent)).toEqual([`${ar.examOnline.answers.true}${words.current}`, ar.examOnline.answers.false])
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])
  })

  it('needs a reason before anything is sent — blanks are no reason', async () => {
    const posts = mockKeyApi()
    const { dialog, onDone } = renderModal()
    fireEvent.click(within(dialog).getByRole('radio', { name: '9' }))
    submit(dialog)
    expect(await within(dialog).findByText(words.reasonRequired)).toBeInTheDocument()
    await userEvent.type(reasonOf(dialog), '   ')
    submit(dialog)
    expect(await within(dialog).findByText(words.reasonRequired)).toBeInTheDocument()
    expect(posts).toEqual([])
    expect(onDone).not.toHaveBeenCalled()
  })

  it('asks for an answer when the question has no recorded key', async () => {
    const posts = mockKeyApi()
    const keyless: ExamQuestionItem = { ...power!, question: { ...power!.question, options: power!.question.options.map((option) => ({ ...option, isCorrect: false })) } }
    const { dialog } = renderModal(keyless)
    expect((within(dialog).getAllByRole('radio') as HTMLInputElement[]).some((radio) => radio.checked)).toBe(false)
    await userEvent.type(reasonOf(dialog), 'لم يكن للسؤال مفتاح')
    submit(dialog)
    expect(await within(dialog).findByText(words.answerRequired)).toBeInTheDocument()
    expect(posts).toEqual([])
  })

  it('sends the chosen option with the trimmed reason and hands the server’s answer over', async () => {
    const result = makeKeyCorrectionResult()
    const posts = mockKeyApi(() => jsonResponse(200, result))
    const { dialog, onDone, onDirtyChange } = renderModal()
    fireEvent.click(within(dialog).getByRole('radio', { name: '9' }))
    await userEvent.type(reasonOf(dialog), '  تصحيح المفتاح  ')
    submit(dialog)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(result))
    expect(posts).toEqual([{ url: `/api/exams/${EXAM_ID}/questions/${EXAM_QUESTION_IDS[0]}/key`, body: { correctOptionId: POWER_OPTION_IDS[2], reason: 'تصحيح المفتاح' } }])
    // Sent: nothing is left to lose.
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
  })

  it('reports what a close would drop — a typed reason, or another answer than the key — and nothing once it is undone', async () => {
    mockKeyApi()
    const { dialog, onDirtyChange } = renderModal()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    expect(unloadWouldPrompt()).toBe(false)

    await userEvent.type(reasonOf(dialog), 'س')
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
    expect(unloadWouldPrompt()).toBe(true)
    await userEvent.clear(reasonOf(dialog))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))

    fireEvent.click(within(dialog).getByRole('radio', { name: '6' }))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
    // Back to the recorded key (its label carries the «current key» tag).
    fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(`^8\\s*${words.current}$`) }))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
    expect(unloadWouldPrompt()).toBe(false)
  })

  it('leaves at once on Escape, × and «cancel» while it holds nothing', async () => {
    mockKeyApi()
    const { dialog, onCancel } = renderModal()
    pressEscape()
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(closeButton(dialog))
    expect(onCancel).toHaveBeenCalledTimes(2)
    fireEvent.click(within(dialog).getByText(ar.common.cancel).closest('button')!)
    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(screen.queryByText(words.discard.title)).not.toBeInTheDocument()
  })

  it('keeps a typed reason on Escape, and × and «cancel» ask first in the dialog’s own words: «keep» stays, «discard» leaves once', async () => {
    const posts = mockKeyApi()
    const { dialog, onCancel } = renderModal()
    await userEvent.type(reasonOf(dialog), 'سبب لم يُرسَل')

    pressEscape()
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.queryByText(words.discard.title)).not.toBeInTheDocument()

    fireEvent.click(closeButton(dialog))
    const first = await discardQuestion()
    expect(within(first).getByText(words.discard.content)).toBeInTheDocument()
    fireEvent.click(within(first).getByText(words.discard.cancel).closest('button')!)
    expect(onCancel).not.toHaveBeenCalled()
    expect(reasonOf(dialog)).toHaveValue('سبب لم يُرسَل')

    fireEvent.click(within(dialog).getByText(ar.common.cancel).closest('button')!)
    const second = await discardQuestion(first)
    fireEvent.click(within(second).getByText(words.discard.ok).closest('button')!)
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    expect(posts).toEqual([])
  })

  it('ends the dialog and asks the tab to re-read when the key no longer fits the question (option_unknown)', async () => {
    mockKeyApi(() => jsonResponse(400, { statusCode: 400, code: 'key_invalid', problem: 'option_unknown', message: 'unknown' }))
    const { dialog, onStale, onDone } = renderModal()
    fireEvent.click(within(dialog).getByRole('radio', { name: '9' }))
    await userEvent.type(reasonOf(dialog), 'سبب')
    submit(dialog)
    await waitFor(() => expect(onStale).toHaveBeenCalledWith(words.errors.key_invalid.option_unknown))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('keeps the dialog and its reason on a missing permission, named', async () => {
    mockKeyApi(() => jsonResponse(403, { statusCode: 403, code: 'permission_denied', missing: ['exams.grade'], message: 'denied' }))
    const { dialog, onStale, onDone } = renderModal()
    fireEvent.click(within(dialog).getByRole('radio', { name: '9' }))
    await userEvent.type(reasonOf(dialog), 'سبب')
    submit(dialog)
    expect(await within(dialog).findByTestId('correct-key-error')).toHaveTextContent(ar.exams.errors.permission_denied.replace('{{list}}', '(exams.grade)'))
    expect(reasonOf(dialog)).toHaveValue('سبب')
    expect(onStale).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    // It can be sent again.
    await waitFor(() => expect(within(dialog).getByText(words.submit).closest('button')).not.toHaveClass('ant-btn-loading'))
  })
})
