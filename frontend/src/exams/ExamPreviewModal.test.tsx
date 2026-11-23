// «معاينة كطالب» on its own: what a learner will see of the questions — and, above all, what they must not.
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExamQuestionItem } from '../api/examQuestions'
import { ar } from '../i18n/ar'
import { frozenItems, makeKeyCorrectionResult, threeExamQuestions } from '../test/examQuestions'
import { mockFetch } from '../test/http'
import { renderWithProviders } from '../test/render'
import { ExamPreviewModal } from './ExamPreviewModal'

const words = ar.examOnline
const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), template)

function renderPreview(items: readonly ExamQuestionItem[]) {
  // The preview is built from what the tab already holds: any request would be a defect.
  const fetchMock = mockFetch(() => {
    throw new Error('the preview must not ask the server anything')
  })
  const onClose = vi.fn()
  const { unmount } = renderWithProviders(<ExamPreviewModal title="اختبار قصير إلكتروني" items={items} onClose={onClose} />)
  const dialog = screen.getByText(fill(words.preview.title, { title: 'اختبار قصير إلكتروني' })).closest('[role="dialog"]') as HTMLElement
  return { dialog, onClose, fetchMock, unmount }
}

describe('ExamPreviewModal', () => {
  it('shows every question in order with its number, points, prompt and choices as radios nobody can press', () => {
    const { dialog, fetchMock } = renderPreview(frozenItems())
    expect(within(dialog).getByText(words.preview.note)).toBeInTheDocument()
    const questions = within(dialog).getAllByTestId('exam-preview-question')
    expect(questions.map((question) => within(question).getByText(/السؤال \d من 3/).textContent)).toEqual([1, 2, 3].map((number) => fill(words.preview.question, { number, total: 3 })))
    expect(questions.map((question) => within(question).getByText(/^النقاط/).textContent)).toEqual([4, 3, 3].map((points) => fill(words.questions.points, { points })))
    // Each group of choices is named by its question, for a screen reader as for the eye.
    const groups = within(dialog).getAllByRole('radiogroup')
    expect(groups).toHaveLength(3)
    expect(groups[0]).toHaveAccessibleName('ما ناتج print(2 ** 3) في بايثون؟')
    expect(within(groups[0]!).getAllByRole('radio').map((radio) => radio.closest('label')!.textContent)).toEqual(['6', '8', '9'])
    expect(within(groups[1]!).getAllByRole('radio').map((radio) => radio.closest('label')!.textContent)).toEqual([words.answers.true, words.answers.false])
    const radios = within(dialog).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.every((radio) => radio.disabled)).toBe(true)
    // One radio group per question: no shared name.
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(3)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows NO key, no explanation and no correction — for a draft’s questions, frozen ones and a corrected one alike', () => {
    const corrected = makeKeyCorrectionResult().question
    for (const items of [threeExamQuestions(), frozenItems(), [corrected]]) {
      const { dialog, unmount } = renderPreview(items)
      const radios = within(dialog).getAllByRole('radio') as HTMLInputElement[]
      // No answer is chosen, no answer is marked.
      expect(radios.some((radio) => radio.checked)).toBe(false)
      expect(within(dialog).queryByTestId('exam-question-key')).not.toBeInTheDocument()
      expect(dialog.querySelector('[data-key]')).toBeNull()
      for (const secret of [words.frozen.correct, words.key.current, words.frozen.explanation, words.frozen.corrections]) expect(within(dialog).queryByText(secret)).not.toBeInTheDocument()
      // Neither the explanation's nor a correction's own words.
      expect(dialog.textContent).not.toContain('العامل ** هو الأس')
      expect(dialog.textContent).not.toContain(corrected.corrections[0]!.reason)
      unmount()
    }
  })

  it('says there is nothing to preview for an exam without questions, and closes on its button', () => {
    const { dialog, onClose } = renderPreview([])
    expect(within(dialog).getByText(words.preview.empty)).toBeInTheDocument()
    expect(within(dialog).queryByTestId('exam-preview-question')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByText(words.preview.close).closest('button')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
