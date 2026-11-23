import { describe, expect, it } from 'vitest'
import { makeDraftQuestion, makeQuestion, makeTrueFalseQuestion } from '../test/questionBanks'
import { emptyOption, newQuestionForm, questionFormValuesOf } from './questions.form'
import type { QuestionFormValues } from './questions.form'
import { planQuestionPatch, questionFormHasChanges, statusAfterSave } from './questions.patch'

const question = makeQuestion()
const loaded = (): QuestionFormValues => questionFormValuesOf(question)

describe('planQuestionPatch() — the smallest PATCH of API-268', () => {
  it('plans nothing for the question as loaded, whatever the save keeps its status with', () => {
    expect(planQuestionPatch(question, loaded(), 'keep')).toBeNull()
    expect(planQuestionPatch(question, loaded(), 'ready')).toBeNull()
  })

  it('plans nothing for spaces around a text, an empty row added, or the points written another way', () => {
    const values = loaded()
    expect(
      planQuestionPatch(question, { ...values, promptAr: `  ${values.promptAr} `, explanationAr: ` ${values.explanationAr}  `, options: [...values.options, emptyOption()], points: 2.0, tags: [' Python', 'حساب '] }, 'keep'),
    ).toBeNull()
  })

  it('sends the status alone when only the save button differs', () => {
    expect(planQuestionPatch(question, loaded(), 'draft')).toEqual({ status: 'draft' })
    const draft = makeDraftQuestion()
    expect(planQuestionPatch(draft, questionFormValuesOf(draft), 'ready')).toEqual({ status: 'ready' })
    expect(planQuestionPatch(draft, questionFormValuesOf(draft), 'draft')).toBeNull()
  })

  it('sends only the field that changed: the prompt whole, with the locale it kept', () => {
    expect(planQuestionPatch(question, { ...loaded(), promptAr: 'ما ناتج print(3 + 2)؟' }, 'keep')).toEqual({ prompt: { ar: 'ما ناتج print(3 + 2)؟', en: 'What does print(2 + 3) output in Python?' } })
    // An emptied English text drops the locale.
    expect(planQuestionPatch(question, { ...loaded(), promptEn: '  ' }, 'keep')).toEqual({ prompt: { ar: 'ما ناتج print(2 + 3) في بايثون؟' } })
    // An emptied Arabic text is refused by the form, never sent.
    expect(planQuestionPatch(question, { ...loaded(), promptAr: '' }, 'keep')).toBeNull()
  })

  it('keeps the Turkish texts the form does not show', () => {
    const turkish = makeQuestion({ prompt: { ar: 'سؤال', tr: 'Soru' }, explanation: { ar: 'شرح', tr: 'Açıklama' } })
    const values = questionFormValuesOf(turkish)
    expect(planQuestionPatch(turkish, { ...values, promptEn: 'Question', explanationAr: 'شرح أطول' }, 'keep')).toEqual({
      prompt: { ar: 'سؤال', en: 'Question', tr: 'Soru' },
      explanation: { ar: 'شرح أطول', tr: 'Açıklama' },
    })
  })

  it('clears the explanation and the difficulty with null', () => {
    expect(planQuestionPatch(question, { ...loaded(), explanationAr: '', difficulty: 'none' }, 'keep')).toEqual({ explanation: null, difficulty: null })
    // An English text added beside the Arabic one: the explanation travels whole.
    expect(planQuestionPatch(question, { ...loaded(), explanationEn: 'The plus operator' }, 'keep')).toEqual({ explanation: { ar: 'عامل الجمع يجمع العددين.', en: 'The plus operator' } })
  })

  it('compares the points at two decimals and sends a JSON number', () => {
    expect(planQuestionPatch(question, { ...loaded(), points: 2.5 }, 'keep')).toEqual({ points: 2.5 })
    expect(planQuestionPatch(question, { ...loaded(), points: 2.004 }, 'keep')).toBeNull()
    // Emptied points are refused by the form, never sent.
    expect(planQuestionPatch(question, { ...loaded(), points: null }, 'keep')).toBeNull()
  })

  it('sends the difficulty and the tags as the server stores them', () => {
    expect(planQuestionPatch(question, { ...loaded(), difficulty: 'hard', tags: ['python', 'حساب', ' Loops '] }, 'keep')).toEqual({ difficulty: 'hard', tags: ['python', 'حساب', 'loops'] })
    expect(planQuestionPatch(question, { ...loaded(), tags: [] }, 'keep')).toEqual({ tags: [] })
    // The same tags in another order are another list.
    expect(planQuestionPatch(question, { ...loaded(), tags: ['حساب', 'python'] }, 'keep')).toEqual({ tags: ['حساب', 'python'] })
  })

  it('sends the options as the whole ordered list, and only when a text, a key or the order changed', () => {
    const values = loaded()
    const stored = [
      { text: { ar: '4' }, isCorrect: false },
      { text: { ar: '5' }, isCorrect: true },
      { text: { ar: '6', tr: 'altı' }, isCorrect: false },
      { text: { ar: '23' }, isCorrect: false },
    ]
    // Another key.
    expect(planQuestionPatch(question, { ...values, options: values.options.map((row, index) => ({ ...row, isCorrect: index === 0 })) }, 'keep')).toEqual({
      options: stored.map((option, index) => ({ ...option, isCorrect: index === 0 })),
    })
    // Another order: the second row first.
    const [first, second, ...rest] = values.options
    expect(planQuestionPatch(question, { ...values, options: [second!, first!, ...rest] }, 'keep')).toEqual({ options: [stored[1], stored[0], stored[2], stored[3]] })
    // A new English text on one row: the whole list travels, the Turkish text of the third row with it.
    expect(planQuestionPatch(question, { ...values, options: values.options.map((row, index) => (index === 1 ? { ...row, textEn: 'Five' } : row)) }, 'keep')).toEqual({
      options: [stored[0], { text: { ar: '5', en: 'Five' }, isCorrect: true }, stored[2], stored[3]],
    })
    // A row emptied is a row removed; a new row is an option added.
    expect(planQuestionPatch(question, { ...values, options: [values.options[0]!, values.options[1]!, emptyOption(), values.options[3]!, { textAr: '7', textEn: '', isCorrect: false }] }, 'keep')).toEqual({
      options: [stored[0], stored[1], stored[3], { text: { ar: '7' }, isCorrect: false }],
    })
  })

  it('sends [] when every option of a draft was emptied', () => {
    const draft = makeDraftQuestion()
    expect(planQuestionPatch(draft, { ...questionFormValuesOf(draft), options: [emptyOption(), emptyOption()] }, 'draft')).toEqual({ options: [] })
  })

  it('sends the key of a true/false question — false included — and never its options', () => {
    const trueFalse = makeTrueFalseQuestion()
    const values = questionFormValuesOf(trueFalse)
    expect(planQuestionPatch(trueFalse, values, 'keep')).toBeNull()
    expect(planQuestionPatch(trueFalse, { ...values, correctAnswer: false }, 'keep')).toEqual({ correctAnswer: false })
    expect(planQuestionPatch(trueFalse, { ...values, correctAnswer: null }, 'draft')).toEqual({ status: 'draft', correctAnswer: null })
    // Rows left in the store by a single-choice session never travel with a true/false question.
    expect(planQuestionPatch(trueFalse, { ...values, options: [{ textAr: 'صح', isCorrect: true }] }, 'keep')).toBeNull()
  })

  it('never sends the type', () => {
    const body = planQuestionPatch(question, { ...loaded(), type: 'true_false', promptAr: 'سؤال آخر' }, 'draft')
    expect(body).toEqual({ status: 'draft', prompt: { ar: 'سؤال آخر', en: 'What does print(2 + 3) output in Python?' } })
    expect(body && 'type' in body).toBe(false)
  })

  it('keeps an archived question archived when its one save is used', () => {
    const archived = makeQuestion({ status: 'archived' })
    expect(planQuestionPatch(archived, { ...questionFormValuesOf(archived), points: 3 }, 'keep')).toEqual({ points: 3 })
  })
})

describe('statusAfterSave()', () => {
  it('is the status the save names, else the one the question has; a new question is a draft', () => {
    expect(statusAfterSave(question, 'draft')).toBe('draft')
    expect(statusAfterSave(question, 'ready')).toBe('ready')
    expect(statusAfterSave(makeQuestion({ status: 'archived' }), 'keep')).toBe('archived')
    expect(statusAfterSave(null, 'ready')).toBe('ready')
    expect(statusAfterSave(null, 'keep')).toBe('draft')
  })
})

describe('questionFormHasChanges() — the unsaved guard of the editor', () => {
  it('holds nothing for the question as loaded, or changed and changed back', () => {
    expect(questionFormHasChanges(question, loaded())).toBe(false)
    expect(questionFormHasChanges(question, { ...loaded(), promptAr: ' ما ناتج print(2 + 3) في بايثون؟ ' })).toBe(false)
    expect(questionFormHasChanges(question, { ...loaded(), options: [...loaded().options, emptyOption()] })).toBe(false)
    const draft = makeDraftQuestion()
    expect(questionFormHasChanges(draft, questionFormValuesOf(draft))).toBe(false)
    const trueFalse = makeTrueFalseQuestion()
    expect(questionFormHasChanges(trueFalse, questionFormValuesOf(trueFalse))).toBe(false)
  })

  it('holds any change the save would send', () => {
    expect(questionFormHasChanges(question, { ...loaded(), promptEn: 'Changed' })).toBe(true)
    expect(questionFormHasChanges(question, { ...loaded(), points: 3 })).toBe(true)
    expect(questionFormHasChanges(question, { ...loaded(), tags: ['python'] })).toBe(true)
    expect(questionFormHasChanges(question, { ...loaded(), options: loaded().options.slice(0, 3) })).toBe(true)
    const trueFalse = makeTrueFalseQuestion()
    expect(questionFormHasChanges(trueFalse, { ...questionFormValuesOf(trueFalse), correctAnswer: false })).toBe(true)
  })

  it('holds what the save would refuse instead of sending', () => {
    expect(questionFormHasChanges(question, { ...loaded(), promptAr: '  ' })).toBe(true)
    expect(questionFormHasChanges(question, { ...loaded(), points: null })).toBe(true)
    const bare = makeQuestion({ explanation: null })
    expect(questionFormHasChanges(bare, { ...questionFormValuesOf(bare), explanationEn: 'Only English' })).toBe(true)
    // A new row with an English text only, and the key moved onto a row without a text.
    expect(questionFormHasChanges(question, { ...loaded(), options: [...loaded().options, { textAr: '', textEn: 'Seven', isCorrect: false }] })).toBe(true)
    const draft = makeDraftQuestion()
    expect(questionFormHasChanges(draft, { ...questionFormValuesOf(draft), options: [{ textAr: 'for', textEn: '', isCorrect: false }, { textAr: '', textEn: '', isCorrect: true }] })).toBe(true)
  })

  it('follows a new question from its untouched start', () => {
    expect(questionFormHasChanges(null, newQuestionForm())).toBe(false)
    expect(questionFormHasChanges(null, { ...newQuestionForm(), type: 'true_false' })).toBe(false)
    expect(questionFormHasChanges(null, { ...newQuestionForm(), promptAr: 'سؤال' })).toBe(true)
  })
})
