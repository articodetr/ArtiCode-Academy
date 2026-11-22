// MOD-09 phase 2 (OEX-T07) — leaving the exam page while an answer has not
// reached the server: a router navigation (the browser's back) asks first, in
// the page's own words; staying keeps everything; leaving sends what is
// unsaved once more with keepalive and never submits. With everything saved,
// leaving asks nothing. Runs in a data router (react-router's useBlocker).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AnswerEntry } from '../api/myAttempts'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { ATTEMPT_ID, OPTION_IDS, QUESTION_IDS, QUESTION_PROMPTS, makeMyAttempt, makeSaveResult } from '../test/myAttempts'
import { STUDENT_EXAM_PERMISSIONS } from '../test/myExams'
import { SELF_STUDENT } from '../test/myLessons'
import { blockerStates, goBack, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser } from '../test/render'
import { TakeExamScreen } from './TakeExamScreen'

const take = ar.takeExam

interface Call {
  method: string
  path: string
  answers: AnswerEntry[] | null
  keepalive: boolean
}

/** Serves the attempt; a save fails with 503 while `failing` is true. */
function serve(state: { failing: boolean }) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const path = new URL(url, 'http://localhost').pathname
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { answers?: AnswerEntry[] }) : null
    calls.push({ method, path, answers: body?.answers ?? null, keepalive: init?.keepalive === true })
    if (method === 'GET') return jsonResponse(200, makeMyAttempt())
    if (method === 'PUT') return state.failing ? jsonResponse(503, { statusCode: 503, message: 'unavailable' }) : jsonResponse(200, makeSaveResult())
    return jsonResponse(404, { statusCode: 404, message: 'not served' })
  })
  return calls
}

function renderScreen() {
  const auth = makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role: 'student', roles: ['student'], permissions: STUDENT_EXAM_PERMISSIONS }) })
  return renderInDataRouter(<TakeExamScreen attemptId={ATTEMPT_ID} />, { auth, path: '/take-exam/current', previous: '/my-exams' })
}

const option = (label: string) => within(screen.getByRole('radiogroup', { name: QUESTION_PROMPTS[0] })).getByRole('radio', { name: label }) as HTMLInputElement
const saveState = () => screen.getByTestId('save-status').getAttribute('data-state')

/** The question the page asks before it lets an unsaved answer go. */
async function leaveQuestion(): Promise<HTMLElement> {
  const titles = await screen.findAllByText(take.leave.unsaved.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}

describe('TakeExamScreen — leaving with unsaved answers', () => {
  it('asks before a browser «back» drops an answer the server has not got — staying keeps it, leaving flushes it with keepalive and submits nothing', async () => {
    const state = { failing: true }
    const calls = serve(state)
    const { router } = renderScreen()
    await screen.findByTestId('question-card')

    fireEvent.click(option('ثمانية'))
    await waitFor(() => expect(saveState()).toBe('retrying'))
    expect(unloadWouldPrompt()).toBe(true)

    await goBack(router)
    const question = await leaveQuestion()
    expect(within(question).getByText(take.leave.unsaved.content)).toBeInTheDocument()
    expect(blockerStates(router)).toContain('blocked')
    expect(router.state.location.pathname).toBe('/take-exam/current')

    // «البقاء في الاختبار»: nothing is lost, the page is still there.
    fireEvent.click(within(question).getByText(take.leave.unsaved.cancel).closest('button')!)
    await waitFor(() => expect(blockerStates(router)).not.toContain('blocked'))
    expect(router.state.location.pathname).toBe('/take-exam/current')
    expect(option('ثمانية').checked).toBe(true)

    // «مغادرة على أي حال»: the page goes — after one more try to send the answer, marked to outlive it.
    const before = calls.length
    await goBack(router)
    const again = await leaveQuestion()
    fireEvent.click(within(again).getByText(take.leave.unsaved.ok).closest('button')!)
    await waitFor(() => expect(router.state.location.pathname).toBe('/my-exams'))
    const flushed = calls.slice(before).filter((call) => call.method === 'PUT')
    expect(flushed).toHaveLength(1)
    expect(flushed[0]!.keepalive).toBe(true)
    expect(flushed[0]!.answers).toEqual([{ examQuestionId: QUESTION_IDS[0], optionId: OPTION_IDS.first[1] }])
    // Leaving never submits.
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
    expect(unloadWouldPrompt()).toBe(false)
  })

  it('lets the learner leave without a question once everything is saved', async () => {
    const calls = serve({ failing: false })
    const { router } = renderScreen()
    await screen.findByTestId('question-card')
    fireEvent.click(option('ثمانية'))
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    expect(router.state.location.pathname).toBe('/my-exams')
    expect(screen.queryByText(take.leave.unsaved.title)).not.toBeInTheDocument()
    // Nothing was unsaved: nothing more was sent, and nothing was submitted.
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })
})
