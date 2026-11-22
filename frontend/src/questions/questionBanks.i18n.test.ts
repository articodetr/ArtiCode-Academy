// The words of the question banks page (src/i18n/{ar,en}/questionBanks.ts): every key the module's sources name
// exists — `t()` takes any string, so a mistyped key would only show on screen, as the key itself — every value a
// source picks by a code of the API has its text, and the counted strings read right in their Arabic plural forms
// (Intl.PluralRules('ar'): 0 zero → the plain key, 1 one, 2 two, 3..10 few, 11..99 many, 100 other).
import { describe, expect, it } from 'vitest'
import { QUESTION_DIFFICULTIES, QUESTION_PROBLEMS, QUESTION_STATUSES, QUESTION_TYPES } from '../api/questionBanks'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'

/** The sources of the page, as text. */
const sources = import.meta.glob<string>(['./*.{ts,tsx}', '../pages/QuestionBanksPage.tsx', '!./*.test.{ts,tsx}', '!../pages/*.test.tsx'], { query: '?raw', import: 'default', eager: true })

const arabic = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('ar')(key, options)
const english = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('en')(key, options)

function resolve(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined), tree)
}

/** A prefix handed to useUnsavedChangesGuard: the four strings of its question live under it. */
const QUESTION_PREFIXES = ['questionBanks.bankForm.unsaved']

describe('the translation keys of the question banks page', () => {
  it('reads the sources of the module', () => {
    const files = Object.keys(sources)
    expect(files).toContain('../pages/QuestionBanksPage.tsx')
    expect(files).toContain('./QuestionEditor.tsx')
    expect(files).toContain('./questions.errors.ts')
    expect(files.some((file) => file.includes('.test.'))).toBe(false)
  })

  it('has a text in both languages for every key a source names in full', () => {
    const keys = new Set<string>()
    for (const text of Object.values(sources)) {
      for (const match of text.matchAll(/'((?:questionBanks|common|login)\.[A-Za-z0-9_.]+)'/g)) keys.add(match[1]!)
    }
    // The page, the two forms, the panel, the editor and the errors together name well over a hundred keys.
    expect(keys.size).toBeGreaterThan(100)
    const missing = [...keys].filter((key) => {
      if (QUESTION_PREFIXES.includes(key)) return ['title', 'content', 'ok', 'cancel'].some((part) => typeof resolve(ar, `${key}.${part}`) !== 'string')
      return typeof resolve(ar, key) !== 'string' || typeof resolve(en, key) !== 'string'
    })
    expect(missing).toEqual([])
  })

  it('has a text for every key a source builds from a prefix and a value of the API', () => {
    const prefixes = new Set<string>()
    for (const text of Object.values(sources)) {
      for (const match of text.matchAll(/`(questionBanks\.[A-Za-z0-9_.]+)\.\$\{/g)) prefixes.add(match[1]!)
    }
    // Each prefix a source uses is listed here with the values it is completed with.
    const completions: Record<string, readonly string[]> = {
      'questionBanks.statuses': QUESTION_STATUSES,
      'questionBanks.types': QUESTION_TYPES,
      'questionBanks.typesShort': QUESTION_TYPES,
      'questionBanks.difficulties': [...QUESTION_DIFFICULTIES, 'none'],
      'questionBanks.problems': QUESTION_PROBLEMS,
      'questionBanks.missing': QUESTION_PROBLEMS,
      'questionBanks.errors': ['question_bank_not_found', 'question_bank_in_use', 'course_not_found', 'question_not_found', 'question_invalid', 'question_in_use', 'nothing_to_update', 'cursor_invalid', 'permission_denied', 'origin_forbidden', 'rate_limited'],
      'questionBanks.editor.created': QUESTION_STATUSES,
      'questionBanks.editor.saved': QUESTION_STATUSES,
      'questionBanks.editor.validation': ['optionArabicFirst', 'correctOptionBlank', 'tagsMax', 'tagMax'],
      'questionBanks.questions.actions': ['markReady', 'backToDraft', 'archive', 'restore'],
      'questionBanks.questions.done': ['markReady', 'backToDraft', 'archive'],
      'questionBanks.questions.done.restored': QUESTION_STATUSES,
      'questionBanks.bankForm.hints': ['course', 'courseTaught', 'needsCoursesRead'],
    }
    expect([...prefixes].sort()).toEqual(Object.keys(completions).sort())
    const missing = Object.entries(completions).flatMap(([prefix, values]) => values.map((value) => `${prefix}.${value}`).filter((key) => typeof resolve(ar, key) !== 'string' || typeof resolve(en, key) !== 'string'))
    expect(missing).toEqual([])
  })
})

describe('the counted strings in their plural forms', () => {
  it('words a bank’s question count: «لا أسئلة», «سؤال واحد», «سؤالان», «3 أسئلة», «11 سؤالاً», «100 سؤال»', () => {
    const count = (value: number) => arabic('questionBanks.banks.questionCount', { count: value })
    expect([0, 1, 2, 3, 10, 11, 99, 100, 103].map(count)).toEqual(['لا أسئلة', 'سؤال واحد', 'سؤالان', '3 أسئلة', '10 أسئلة', '11 سؤالاً', '99 سؤالاً', '100 سؤال', '103 أسئلة'])
    expect([1, 12].map((value) => english('questionBanks.banks.questionCount', { count: value }))).toEqual(['1 question', '12 questions'])
  })

  it('words the exams that use a question: «مستعمل في اختبار واحد», «اختبارين», «3 اختبارات», «11 اختباراً», «100 اختبار»', () => {
    const used = (value: number) => arabic('questionBanks.questions.usedIn', { count: value })
    expect([0, 1, 2, 3, 11, 100].map(used)).toEqual([
      'غير مستعمل في أي اختبار',
      'مستعمل في اختبار واحد',
      'مستعمل في اختبارين',
      'مستعمل في 3 اختبارات',
      'مستعمل في 11 اختباراً',
      'مستعمل في 100 اختبار',
    ])
    expect([1, 2].map((value) => english('questionBanks.questions.usedIn', { count: value }))).toEqual(['Used in 1 exam', 'Used in 2 exams'])
  })

  it('shows a number beside its label without a plural form', () => {
    expect(arabic('questionBanks.banks.readyCount', { ready: 9 })).toBe('الجاهز منها: 9')
    expect(arabic('questionBanks.pagination.pageSize', { size: 20 })).toBe('20 في الصفحة')
    expect(arabic('questionBanks.pagination.page', { page: 2 })).toBe('الصفحة 2')
    expect(arabic('questionBanks.editor.option', { number: 3 })).toBe('الخيار 3')
  })
})
