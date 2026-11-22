// The question editor and the bank form hold a browser back while they hold unsaved work (KI-055): the same
// «discard?» question as their close button, asked once. A data router is needed — src/test/navigation.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { answerDiscardQuestion, blockerStates, discardQuestionCount, goBack, latestDiscardQuestion, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { QUESTION_TEACHER_PERMISSIONS, makeBank, makeQuestion } from '../test/questionBanks'
import { makeAuth, makeUser } from '../test/render'
import { BankFormModal } from './BankFormModal'
import { QuestionEditor } from './QuestionEditor'

const words = ar.questionBanks
const auth = () => makeAuth({ user: makeUser({ permissions: QUESTION_TEACHER_PERMISSIONS }) })

/** Every request is recorded; none is expected to write. */
function mockApi() {
  const writes: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') writes.push(`${method} ${url}`)
    return method === 'GET' ? jsonResponse(200, { items: [], nextCursor: null }) : jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return { writes }
}

describe('QuestionEditor — browser back with unsaved work', () => {
  async function renderRouted() {
    const onClose = vi.fn()
    const { router } = renderInDataRouter(<QuestionEditor bank={makeBank()} question={makeQuestion()} onClose={onClose} onSaved={vi.fn()} onStale={vi.fn()} />, {
      auth: auth(),
      path: '/question-banks',
    })
    const drawer = (await screen.findByText(words.editor.editTitle)).closest('.ant-drawer-content-wrapper') as HTMLElement
    return { router, onClose, drawer }
  }

  it('lets a back navigation through while nothing is unsaved', async () => {
    mockApi()
    const { router, onClose } = await renderRouted()
    await goBack(router)
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('holds a back navigation while the question is edited: «keep editing» stays with the text, «discard» goes back and closes once', async () => {
    const { writes } = mockApi()
    const { router, onClose, drawer } = await renderRouted()
    const prompt = within(drawer).getByLabelText(words.editor.fields.promptAr)
    fireEvent.change(prompt, { target: { value: 'نص معدَّل للسؤال' } })

    await goBack(router)
    const first = await latestDiscardQuestion()
    expect(discardQuestionCount()).toBe(1)
    expect(router.state.location.pathname).toBe('/question-banks')
    await answerDiscardQuestion(first, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(prompt).toHaveValue('نص معدَّل للسؤال')

    await goBack(router)
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })
})

describe('BankFormModal — browser back with unsaved work', () => {
  it('holds a back navigation while a bank is being typed, in the dialog’s own words', async () => {
    const { writes } = mockApi()
    const onClose = vi.fn()
    const { router } = renderInDataRouter(<BankFormModal bank={null} onClose={onClose} onSaved={vi.fn()} onStale={vi.fn()} />, { auth: auth(), path: '/question-banks' })
    const dialog = (await screen.findByText(words.bankForm.createTitle)).closest('[role="dialog"]') as HTMLElement
    const name = within(dialog).getByLabelText(words.bankForm.fields.nameAr)
    fireEvent.change(name, { target: { value: 'بنك لم يُحفظ' } })
    expect(unloadWouldPrompt()).toBe(true)

    await goBack(router)
    const question = (await screen.findAllByText(words.bankForm.unsaved.title)).at(-1)!.closest('[role="dialog"]') as HTMLElement
    expect(router.state.location.pathname).toBe('/question-banks')
    fireEvent.click(within(question).getByText(words.bankForm.unsaved.cancel).closest('button')!)
    await waitFor(() => expect(blockerStates(router)).toEqual(['unblocked']))
    expect(name).toHaveValue('بنك لم يُحفظ')
    expect(onClose).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})
