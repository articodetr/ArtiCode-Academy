import { describe, expect, it } from 'vitest'
import { EXAM_READINESS_PROBLEMS } from '../api/examQuestions'
import { EXAM_RESULT_STATUSES } from '../api/examResults'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { makeExam } from '../test/exams'
import { RESULT_STATUS_COLORS, examTitle, isReadinessProblem, readinessFixOf, readinessProblemText, resultsRatio } from './exams.format'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)

describe('exams.format', () => {
  it('shows the title in the active language with the Arabic one as the fallback', () => {
    expect(examTitle(makeExam(), 'ar')).toBe('اختبار منتصف الفصل')
    expect(examTitle(makeExam(), 'en')).toBe('Midterm exam')
    expect(examTitle(makeExam({ title: { ar: 'قصير' } }), 'en')).toBe('قصير')
  })

  it('reads «recorded / total» from the server’s counts and gives every result status a colour', () => {
    expect(resultsRatio(makeExam({ results: { students: 14, scored: 12, absent: 1, excused: 1 }, activeStudents: 18 }))).toBe('14 / 18')
    expect(EXAM_RESULT_STATUSES.map((status) => RESULT_STATUS_COLORS[status])).toEqual(['green', 'red', 'blue'])
  })
})

describe('exams.format — what keeps an online draft from being made available (MOD-09 phase 2)', () => {
  const words = ar.examOnline.readiness.problems
  const numbers = { totalPoints: 8.5, maxScore: 10 }

  it('words every problem of the contract, in Arabic and in English', () => {
    for (const problem of EXAM_READINESS_PROBLEMS) {
      expect(isReadinessProblem(problem)).toBe(true)
      expect(words[problem]).toBeTruthy()
      expect(en.examOnline.readiness.problems[problem]).toBeTruthy()
      expect(readinessProblemText(t, problem, numbers)).not.toBe(problem)
    }
    expect(readinessProblemText(t, 'no_questions', numbers)).toBe(words.no_questions)
    expect(readinessProblemText(t, 'window_closed', numbers)).toBe(words.window_closed)
  })

  it('names the server’s two numbers behind points_mismatch, and none when it sent none', () => {
    expect(readinessProblemText(t, 'points_mismatch', numbers)).toBe(words.points_mismatch.replace('{{total}}', '8.5').replace('{{max}}', '10'))
    expect(readinessProblemText(t, 'points_mismatch', { totalPoints: null, maxScore: 10 })).toBe(words.points_mismatch_plain)
    expect(readinessProblemText(t, 'points_mismatch', { totalPoints: 0, maxScore: 10 })).toBe(words.points_mismatch.replace('{{total}}', '0').replace('{{max}}', '10'))
  })

  it('shows a problem of a newer server as it came, and says where each known one is put right', () => {
    expect(isReadinessProblem('something_new')).toBe(false)
    expect(readinessProblemText(t, 'something_new', numbers)).toBe('something_new')
    expect(readinessFixOf('something_new')).toBeNull()
    expect(EXAM_READINESS_PROBLEMS.map(readinessFixOf)).toEqual(['questions', 'questions', 'questions', 'settings', 'settings', 'settings'])
  })
})
