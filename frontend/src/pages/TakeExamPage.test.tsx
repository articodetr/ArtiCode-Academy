// MOD-09 phase 2 (OEX-T07) — the page a learner takes an online exam on:
// /take-exam/:attemptId against a mocked API-277..API-279. It proves the three
// rules of the page: the time is the server's; nothing about correctness is
// shown, computed or fetched before the server sends it; and answers are not
// lost quietly (they save themselves, a failed save retries, leaving asks
// first, the submit waits for the saves and happens once).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnswerEntry, MyAttempt, SaveAnswersResult } from '../api/myAttempts'
import { formatZonedDateTime } from '../assignments/assignments.format'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import {
  ATTEMPT_ID,
  ATTEMPT_ID_2,
  OPTION_IDS,
  QUESTION_IDS,
  QUESTION_PROMPTS,
  makeAnsweredQuestions,
  makeAttemptExam,
  makeAttemptQuestions,
  makeAttemptResult,
  makeAttemptSummary,
  makeFinishedAttempt,
  makeMyAttempt,
  makeReviewedQuestions,
  makeSaveResult,
} from '../test/myAttempts'
import { STUDENT_EXAM_PERMISSIONS } from '../test/myExams'
import { SELF_STUDENT } from '../test/myLessons'
import { unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { TakeExamPage } from './TakeExamPage'

const take = ar.takeExam
const [Q1, Q2, Q3] = QUESTION_IDS

type Answer<T> = T | Response

interface ServerOptions {
  /** API-277: one answer for every read, or a function of the read's number (0-based) — by attempt id when several are served. */
  attempt: Answer<MyAttempt> | ((read: number, attemptId: string) => Answer<MyAttempt> | Promise<Answer<MyAttempt>>)
  /** API-278: the answer to each save (0-based call number). Default: saved. */
  save?: (answers: AnswerEntry[], call: number) => Answer<SaveAnswersResult> | Promise<Answer<SaveAnswersResult>>
  /** API-279: the answer to each submit (0-based call number). Default: the fixture's finished attempt. */
  submit?: (call: number) => Answer<MyAttempt> | Promise<Answer<MyAttempt>>
}

interface Call {
  method: string
  path: string
  body: unknown
  keepalive: boolean
}

function respond<T>(answer: Answer<T>): Response {
  return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
}

/** Serves API-277..API-279 and records every request the page makes. */
function serve(options: ServerOptions) {
  const calls: Call[] = []
  let reads = 0
  let saves = 0
  let submits = 0
  mockFetch(async (url, init) => {
    const method = init?.method ?? 'GET'
    const path = new URL(url, 'http://localhost').pathname
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body, keepalive: init?.keepalive === true })
    const match = path.match(/^\/api\/me\/exam-attempts\/([^/]+)(\/answers|\/submit)?$/)
    if (!match) return jsonResponse(404, { statusCode: 404, message: 'not served' })
    const [, attemptId, action] = match
    if (method === 'GET' && !action) return respond(typeof options.attempt === 'function' ? await options.attempt(reads++, attemptId!) : options.attempt)
    if (method === 'PUT' && action === '/answers') {
      const answers = (body as { answers: AnswerEntry[] }).answers
      return respond(options.save ? await options.save(answers, saves++) : makeSaveResult())
    }
    if (method === 'POST' && action === '/submit') return respond(options.submit ? await options.submit(submits++) : makeFinishedAttempt())
    return jsonResponse(404, { statusCode: 404, message: 'not served' })
  })
  const of = (method: string, suffix: string) => calls.filter((call) => call.method === method && call.path.endsWith(suffix))
  return {
    calls,
    reads: () => calls.filter((call) => call.method === 'GET'),
    saves: () => of('PUT', '/answers'),
    submits: () => of('POST', '/submit'),
    /** The `answers` of each save, in order. */
    saved: () => of('PUT', '/answers').map((call) => (call.body as { answers: AnswerEntry[] }).answers),
  }
}

function refusal(status: number, code: string | undefined, details: Record<string, unknown> = {}) {
  return jsonResponse(status, { statusCode: status, ...(code ? { code } : {}), message: 'refused', ...details })
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function renderTake(attemptId: string = ATTEMPT_ID) {
  const auth = makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role: 'student', roles: ['student'], permissions: STUDENT_EXAM_PERMISSIONS }) })
  return renderWithProviders(<TakeExamPage />, {
    auth,
    route: `/take-exam/${attemptId}`,
    path: '/take-exam/:attemptId',
    routes: { '/my-exams': <LocationProbe /> },
  })
}

const group = (prompt: string) => screen.getByRole('radiogroup', { name: prompt })
const option = (prompt: string, label: string) => within(group(prompt)).getByRole('radio', { name: label }) as HTMLInputElement
const questionHeading = () => screen.getByRole('heading', { level: 2, name: /^(السؤال|Question) \d/ })
const headingOf = (number: number) => i18n.t('takeExam.question.heading', { number, total: 3 })
const saveState = () => screen.getByTestId('save-status').getAttribute('data-state')
const timerText = () => screen.getByRole('timer').textContent
const button = (label: string) => screen.getByText(label).closest('button') as HTMLButtonElement

/** The page with the attempt on screen. */
async function opened() {
  await screen.findByTestId('question-card')
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Every grading word of the finished view — none may be on screen while an attempt is in progress. */
const GRADING_WORDS = [take.answers.correct, take.answers.wrong, take.answers.correctAnswer, take.answers.yourChoice, take.answers.explanation, take.result.title, take.result.score, take.result.passed, take.result.failed]

afterEach(() => {
  setVisibility('visible')
  vi.useRealTimers()
})

describe('TakeExamPage — an attempt in progress', () => {
  it('shows the exam, the class, the attempt number, the server’s time left and the first unanswered question', async () => {
    const [first, second, third] = makeAttemptQuestions()
    const server = serve({ attempt: makeMyAttempt({ attemptNo: 2, questions: [{ ...first!, answer: { optionId: OPTION_IDS.first[1], value: null } }, second!, third!], remainingSeconds: 1754 }) })
    renderTake()
    await opened()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('اختبار قصير: أساسيات بايثون')
    expect(screen.getByText('PY-101-A')).toBeInTheDocument()
    expect(screen.getByTestId('attempt-number')).toHaveTextContent(i18n.t('takeExam.page.attemptNo', { number: 2 }))
    expect(screen.getByRole('timer', { name: take.timer.label })).toHaveTextContent('29:14')
    expect(screen.getByTestId('exam-timer')).toHaveAttribute('data-level', 'normal')
    // The first question is answered: the page opens on the second.
    expect(questionHeading()).toHaveTextContent(headingOf(2))
    expect(screen.getByText(i18n.t('takeExam.question.points', { points: 4 }))).toBeInTheDocument()
    expect(group(QUESTION_PROMPTS[1])).toBeInTheDocument()
    expect(within(group(QUESTION_PROMPTS[1])).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).checked)).toEqual([false, false, false])
    expect(saveState()).toBe('saved')
    expect(screen.getByText(take.save.saved)).toBeInTheDocument()
    expect(screen.getByText(take.page.leaveNote)).toBeInTheDocument()
    expect(screen.getByTestId('answered-progress')).toHaveTextContent(i18n.t('takeExam.navigator.progress', { answered: 1, total: 3 }))
    // The instructions are there to open.
    expect(screen.getByText(take.page.instructions)).toBeInTheDocument()
    expect(screen.getByText('أجب عن كل الأسئلة. لكل سؤال إجابة واحدة.')).toBeInTheDocument()
    // One read of the learner's own attempt, and nothing else.
    expect(server.calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /api/me/exam-attempts/${ATTEMPT_ID}`])
  })

  it('renders no grading and no correct-answer mark — not even when an answer carried a key it should not have', async () => {
    // What a server never sends for an attempt in progress: a review of every question and a result. The page must not show any of it.
    const leaky = makeMyAttempt({ questions: makeReviewedQuestions(), resultReleased: true, reviewReleased: true, result: makeAttemptResult() })
    const server = serve({ attempt: leaky })
    renderTake()
    await opened()

    for (let number = 1; number <= 3; number += 1) {
      fireEvent.click(screen.getByLabelText(new RegExp(`^السؤال ${number}،`)))
      expect(questionHeading()).toHaveTextContent(headingOf(number))
      for (const word of GRADING_WORDS) expect(screen.queryByText(word)).not.toBeInTheDocument()
      expect(screen.queryByTestId('correct-answer-mark')).not.toBeInTheDocument()
      expect(screen.queryByTestId('question-grade')).not.toBeInTheDocument()
      expect(screen.queryByText(/العامل \*\*/)).not.toBeInTheDocument() // the explanation of the first question
    }
    // Nothing of the finished view exists, and no number that could be a score.
    expect(screen.queryByTestId('attempt-result')).not.toBeInTheDocument()
    expect(screen.queryByTestId('attempt-review')).not.toBeInTheDocument()
    expect(screen.queryByTestId('finished-question')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('6 / 10')
    // The review step counts the learner's answers and marks none.
    fireEvent.click(screen.getByTestId('open-review'))
    for (const word of GRADING_WORDS) expect(screen.queryByText(word)).not.toBeInTheDocument()
    // «صحيح» / «خطأ» appear only as the two choices of a true/false question.
    fireEvent.click(screen.getByText(take.review.back).closest('button')!)
    fireEvent.click(screen.getByLabelText(/^السؤال 3،/))
    expect(within(group(QUESTION_PROMPTS[2])).getAllByRole('radio')).toHaveLength(2)
    expect(option(QUESTION_PROMPTS[2], take.question.trueOption).checked).toBe(true)

    // It never called a teacher route: only the learner's own attempt.
    expect(server.calls.length).toBeGreaterThan(0)
    for (const call of server.calls) {
      expect(call.path.startsWith('/api/me/exam-attempts/')).toBe(true)
      expect(call.path).not.toMatch(/^\/api\/exams\/|^\/api\/exam-attempts\/|\/questions/)
    }
  })

  it('saves a chosen answer by itself: ONE request with the whole answer — an option id, a JSON boolean, or neither to clear', async () => {
    const server = serve({ attempt: makeMyAttempt() })
    renderTake()
    await opened()

    // A choice question: `optionId`.
    fireEvent.click(option(QUESTION_PROMPTS[0], 'ثمانية'))
    expect(option(QUESTION_PROMPTS[0], 'ثمانية').checked).toBe(true) // on screen at once
    await waitFor(() => expect(server.saves()).toHaveLength(1))
    expect(server.saves()[0]).toMatchObject({ method: 'PUT', path: `/api/me/exam-attempts/${ATTEMPT_ID}/answers`, keepalive: false })
    expect(server.saved()[0]).toEqual([{ examQuestionId: Q1, optionId: OPTION_IDS.first[1] }])
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(screen.getByLabelText(i18n.t('takeExam.navigator.answered', { number: 1 }))).toBeInTheDocument()

    // A true/false question: `value`, a JSON boolean.
    fireEvent.click(screen.getByLabelText(i18n.t('takeExam.navigator.unanswered', { number: 3 })))
    fireEvent.click(option(QUESTION_PROMPTS[2], take.question.falseOption))
    await waitFor(() => expect(server.saves()).toHaveLength(2))
    expect(server.saved()[1]).toEqual([{ examQuestionId: Q3, value: false }])
    expect((server.saved()[1]![0] as AnswerEntry).value).toBe(false)

    // «مسح الإجابة»: an entry with neither field.
    await waitFor(() => expect(saveState()).toBe('saved'))
    fireEvent.click(button(take.question.clear))
    expect(option(QUESTION_PROMPTS[2], take.question.falseOption).checked).toBe(false)
    await waitFor(() => expect(server.saves()).toHaveLength(3))
    expect(server.saved()[2]).toEqual([{ examQuestionId: Q3 }])
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(server.saves()).toHaveLength(3)
    expect(server.submits()).toHaveLength(0)
  })

  it('coalesces quick changes: while one save is on its way the rest become a single request with the last answers', async () => {
    const gate = deferred<SaveAnswersResult>()
    const server = serve({ attempt: makeMyAttempt(), save: (_answers, call) => (call === 0 ? gate.promise : makeSaveResult()) })
    renderTake()
    await opened()

    fireEvent.click(option(QUESTION_PROMPTS[0], 'ستة'))
    await waitFor(() => expect(server.saves()).toHaveLength(1))
    expect(saveState()).toBe('saving')
    expect(screen.getByText(take.save.saving)).toBeInTheDocument()
    // Three more changes while the first request has not answered.
    fireEvent.click(option(QUESTION_PROMPTS[0], 'ثمانية'))
    fireEvent.click(option(QUESTION_PROMPTS[0], 'تسعة'))
    fireEvent.click(screen.getByLabelText(/^السؤال 2،/))
    fireEvent.click(option(QUESTION_PROMPTS[1], 'str'))
    expect(server.saves()).toHaveLength(1)

    await act(async () => {
      gate.resolve(makeSaveResult())
    })
    await waitFor(() => expect(server.saves()).toHaveLength(2))
    expect(server.saved()[0]).toEqual([{ examQuestionId: Q1, optionId: OPTION_IDS.first[0] }])
    expect(server.saved()[1]).toEqual([
      { examQuestionId: Q1, optionId: OPTION_IDS.first[2] },
      { examQuestionId: Q2, optionId: OPTION_IDS.second[1] },
    ])
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(server.saves()).toHaveLength(2)
  })

  it('keeps the answer of a failed save on screen, says so, guards a reload, and saves it on «retry»', async () => {
    const server = serve({ attempt: makeMyAttempt(), save: (_answers, call) => (call === 0 ? refusal(503, undefined) : makeSaveResult()) })
    renderTake()
    await opened()
    expect(unloadWouldPrompt()).toBe(false)

    fireEvent.click(option(QUESTION_PROMPTS[0], 'ثمانية'))
    await waitFor(() => expect(saveState()).toBe('retrying'))
    // The answer stays, the header and a notice say what happened, and the answers are said to be kept here.
    expect(option(QUESTION_PROMPTS[0], 'ثمانية').checked).toBe(true)
    const notice = screen.getByTestId('save-failure')
    expect(within(notice).getByText(take.save.retrying)).toBeInTheDocument()
    expect(notice).toHaveTextContent(ar.login.errors.server)
    expect(notice).toHaveTextContent(take.save.keptHere)
    // A reload or a tab close now gets the browser's own prompt.
    expect(unloadWouldPrompt()).toBe(true)

    fireEvent.click(within(notice).getByText(take.save.retry).closest('button')!)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(server.saved()).toEqual([[{ examQuestionId: Q1, optionId: OPTION_IDS.first[1] }], [{ examQuestionId: Q1, optionId: OPTION_IDS.first[1] }]])
    expect(screen.queryByTestId('save-failure')).not.toBeInTheDocument()
    expect(unloadWouldPrompt()).toBe(false)
  })

  it('retries a failed save by itself after a pause', async () => {
    vi.useFakeTimers()
    const server = serve({ attempt: makeMyAttempt(), save: (_answers, call) => (call === 0 ? refusal(500, undefined) : makeSaveResult()) })
    renderTake()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.click(option(QUESTION_PROMPTS[0], 'ثمانية'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(saveState()).toBe('retrying')
    expect(server.saves()).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_900)
    })
    expect(server.saves()).toHaveLength(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(server.saves()).toHaveLength(2)
    expect(saveState()).toBe('saved')
    expect(option(QUESTION_PROMPTS[0], 'ثمانية').checked).toBe(true)
  })

  it('shows the finished state with a clear notice when a save is refused as closed (409 attempt_closed)', async () => {
    let closed = false
    const server = serve({
      // After the refusal the attempt reads as the server closed it: with what was saved before, which is nothing here.
      attempt: () => (closed ? makeFinishedAttempt({ status: 'timed_out', questions: makeAttemptQuestions(), attempts: [makeAttemptSummary({ status: 'timed_out', submittedAt: '2026-11-20T08:00:00.000Z' })] }) : makeMyAttempt()),
      save: () => {
        closed = true
        return refusal(409, 'attempt_closed', { status: 'timed_out' })
      },
    })
    renderTake()
    await opened()
    fireEvent.click(option(QUESTION_PROMPTS[0], 'ثمانية'))

    const finished = await screen.findByTestId('attempt-finished')
    expect(within(finished).getByRole('heading', { level: 2 })).toHaveTextContent(take.finished.timedOutTitle)
    expect(screen.getByTestId('finished-status')).toHaveTextContent(take.finished.timedOut)
    expect(within(finished).getByText(take.finished.endedElsewhere)).toBeInTheDocument()
    // Honest about the answer that did not arrive.
    expect(screen.getByTestId('lost-answers')).toHaveTextContent(i18n.t('takeExam.answers.question', { number: 1 }))
    // No questions to answer any more, no timer, no further save, no submit by the page.
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(server.saves()).toHaveLength(1)
    expect(server.submits()).toHaveLength(0)
    expect(server.reads()).toHaveLength(2)
    expect(unloadWouldPrompt()).toBe(false)
  })

  it('reads the attempt again and says so when the server does not recognise the answers (400 answers_invalid)', async () => {
    let reads = 0
    const server = serve({
      attempt: () => (reads++ === 0 ? makeMyAttempt() : makeMyAttempt({ questions: makeAnsweredQuestions(), remainingSeconds: 1700 })),
      save: () => refusal(400, 'answers_invalid', { unknown: [Q2], duplicates: [], malformed: [] }),
    })
    renderTake()
    await opened()
    fireEvent.click(screen.getByLabelText(/^السؤال 2،/))
    fireEvent.click(option(QUESTION_PROMPTS[1], 'list'))

    expect(await screen.findByText(take.page.answersReset)).toBeInTheDocument()
    await waitFor(() => expect(server.reads()).toHaveLength(2))
    // The screen now shows what the server holds: the refused choice is gone, the saved ones are there.
    await waitFor(() => expect(option(QUESTION_PROMPTS[1], 'list').checked).toBe(false))
    fireEvent.click(screen.getByLabelText(/^السؤال 1،/))
    expect(option(QUESTION_PROMPTS[0], 'ثمانية').checked).toBe(true)
    expect(saveState()).toBe('saved')
    expect(server.saves()).toHaveLength(1)
  })

  it('moves between questions with «التالي» / «السابق» and the navigator, taking the focus to the new question’s heading', async () => {
    serve({ attempt: makeMyAttempt({ questions: makeAnsweredQuestions() }) })
    renderTake()
    await opened()
    // «ثمانية» and «صحيح» are answered: the page opens on the second question.
    expect(questionHeading()).toHaveTextContent(headingOf(2))
    expect(questionHeading()).not.toHaveFocus() // arriving does not steal the focus

    const navigator = screen.getByRole('navigation', { name: take.navigator.title })
    const marks = within(navigator)
      .getAllByRole('button')
      .map((entry) => [entry.getAttribute('aria-label'), entry.getAttribute('aria-current')])
    expect(marks).toEqual([
      [i18n.t('takeExam.navigator.answered', { number: 1 }), null],
      [i18n.t('takeExam.navigator.unanswered', { number: 2 }), 'true'],
      [i18n.t('takeExam.navigator.answered', { number: 3 }), null],
    ])

    fireEvent.click(button(take.question.next))
    expect(questionHeading()).toHaveTextContent(headingOf(3))
    expect(questionHeading()).toHaveFocus()
    expect(button(take.question.next)).toBeDisabled()
    expect(option(QUESTION_PROMPTS[2], take.question.trueOption).checked).toBe(true)

    fireEvent.click(button(take.question.previous))
    fireEvent.click(button(take.question.previous))
    expect(questionHeading()).toHaveTextContent(headingOf(1))
    expect(questionHeading()).toHaveFocus()
    expect(button(take.question.previous)).toBeDisabled()
    expect(option(QUESTION_PROMPTS[0], 'ثمانية').checked).toBe(true)

    fireEvent.click(within(navigator).getByLabelText(i18n.t('takeExam.navigator.answered', { number: 3 })))
    expect(questionHeading()).toHaveTextContent(headingOf(3))
    expect(questionHeading()).toHaveFocus()
    expect(within(navigator).getByLabelText(i18n.t('takeExam.navigator.answered', { number: 3 }))).toHaveAttribute('aria-current', 'true')
  })

  it('gives each question ONE radio group labelled by its prompt, with a name of its own for the arrow keys', async () => {
    serve({ attempt: makeMyAttempt() })
    renderTake()
    await opened()
    const radios = within(group(QUESTION_PROMPTS[0])).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.labels?.[0]?.textContent)).toEqual(['ستة', 'ثمانية', 'تسعة'])
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1)
    expect(radios[0]!.name).toContain(Q1)
    expect(within(screen.getByTestId('question-card')).getAllByRole('radiogroup')).toHaveLength(1)
    // Nothing chosen yet: «مسح الإجابة» is there but has nothing to clear.
    expect(button(take.question.clear)).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('TakeExamPage — review and submit', () => {
  it('lists the unanswered questions as buttons back to them, then asks once more before the one submit', async () => {
    const server = serve({ attempt: makeMyAttempt({ questions: makeAnsweredQuestions() }), submit: () => makeFinishedAttempt() })
    renderTake()
    await opened()

    fireEvent.click(screen.getByTestId('open-review'))
    const review = screen.getByTestId('review-panel')
    expect(within(review).getByRole('heading', { level: 2 })).toHaveTextContent(take.review.title)
    expect(within(review).getByRole('heading', { level: 2 })).toHaveFocus()
    expect(within(review).getByText(i18n.t('takeExam.review.summary', { answered: 2, total: 3 }))).toBeInTheDocument()
    expect(within(review).getByText(i18n.t('takeExam.review.unanswered', { count: 1 }))).toBeInTheDocument()

    // The unanswered question is one press away.
    fireEvent.click(within(review).getByText(i18n.t('takeExam.review.questionButton', { number: 2 })).closest('button')!)
    expect(questionHeading()).toHaveTextContent(headingOf(2))
    expect(questionHeading()).toHaveFocus()
    fireEvent.click(option(QUESTION_PROMPTS[1], 'str'))
    await waitFor(() => expect(saveState()).toBe('saved'))

    fireEvent.click(screen.getByTestId('open-review'))
    expect(screen.getByText(take.review.allAnswered)).toBeInTheDocument()

    // «تسليم الاختبار» asks first, and «ليس بعد» sends nothing.
    fireEvent.click(screen.getByTestId('submit-exam'))
    let dialog = (await screen.findAllByText(take.submit.confirmTitle)).at(-1)!.closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(take.submit.confirmFinal)).toBeInTheDocument()
    expect(within(dialog).getByText(take.review.allAnswered)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByText(take.submit.confirmCancel).closest('button')!)
    expect(server.submits()).toHaveLength(0)

    fireEvent.click(screen.getByTestId('submit-exam'))
    dialog = (await screen.findAllByText(take.submit.confirmTitle)).at(-1)!.closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(take.submit.confirmOk).closest('button')!)

    const finished = await screen.findByTestId('attempt-finished')
    expect(within(finished).getByRole('heading', { level: 2 })).toHaveTextContent(take.finished.submittedTitle)
    await waitFor(() => expect(within(finished).getByRole('heading', { level: 2 })).toHaveFocus())
    expect(server.submits()).toHaveLength(1)
    expect(server.submits()[0]).toMatchObject({ method: 'POST', path: `/api/me/exam-attempts/${ATTEMPT_ID}/submit`, body: undefined })
    // The attempt ended by the learner's own submit: no «closed elsewhere», nothing lost.
    expect(screen.queryByText(take.finished.endedElsewhere)).not.toBeInTheDocument()
    expect(screen.queryByTestId('lost-answers')).not.toBeInTheDocument()
  })

  it('says how many questions hold no answer in the final confirmation', async () => {
    serve({ attempt: makeMyAttempt() })
    renderTake()
    await opened()
    fireEvent.click(screen.getByTestId('open-review'))
    expect(screen.getByText(i18n.t('takeExam.review.unanswered', { count: 3 }))).toBeInTheDocument()
    expect(within(screen.getByTestId('review-panel')).getAllByRole('button', { name: /^السؤال \d$/ })).toHaveLength(3)
    fireEvent.click(screen.getByTestId('submit-exam'))
    const dialog = (await screen.findAllByText(take.submit.confirmTitle)).at(-1)!.closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(i18n.t('takeExam.submit.confirmUnanswered', { count: 3 }))).toBeInTheDocument()
  })

  it('waits for the save on its way before it submits, and submits once', async () => {
    const gate = deferred<SaveAnswersResult>()
    const server = serve({ attempt: makeMyAttempt(), save: () => gate.promise, submit: () => makeFinishedAttempt() })
    renderTake()
    await opened()
    fireEvent.click(option(QUESTION_PROMPTS[0], 'ثمانية'))
    await waitFor(() => expect(server.saves()).toHaveLength(1))

    fireEvent.click(screen.getByTestId('open-review'))
    fireEvent.click(screen.getByTestId('submit-exam'))
    const dialog = (await screen.findAllByText(take.submit.confirmTitle)).at(-1)!.closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(take.submit.confirmOk).closest('button')!)

    // The answers are locked and the page says what it waits for; nothing is submitted yet.
    expect(await screen.findByText(take.review.waitingSave)).toBeInTheDocument()
    expect(screen.getByTestId('submit-exam')).toHaveClass('ant-btn-loading')
    expect(server.submits()).toHaveLength(0)

    await act(async () => {
      gate.resolve(makeSaveResult())
    })
    await screen.findByTestId('attempt-finished')
    expect(server.submits()).toHaveLength(1)
    expect(server.saves()).toHaveLength(1)
  })

  it('does not submit over an answer that could not be saved — it says so and keeps the attempt open', async () => {
    const server = serve({ attempt: makeMyAttempt(), save: () => refusal(503, undefined) })
    renderTake()
    await opened()
    fireEvent.click(option(QUESTION_PROMPTS[0], 'ثمانية'))
    await waitFor(() => expect(saveState()).toBe('retrying'))

    fireEvent.click(screen.getByTestId('open-review'))
    expect(screen.getByText(take.review.unsavedWarning)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('submit-exam'))
    const dialog = (await screen.findAllByText(take.submit.confirmTitle)).at(-1)!.closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(take.submit.confirmOk).closest('button')!)

    expect(await screen.findByTestId('submit-failure')).toHaveTextContent(take.submit.unsavedBlocked)
    expect(server.submits()).toHaveLength(0)
    expect(screen.queryByTestId('attempt-finished')).not.toBeInTheDocument()
    // Still answering: the choice is there and can be changed.
    fireEvent.click(screen.getByText(take.review.back).closest('button')!)
    expect(option(QUESTION_PROMPTS[0], 'ثمانية').checked).toBe(true)
    expect(option(QUESTION_PROMPTS[0], 'ثمانية')).toBeEnabled()
  })

  it('reports a submit that failed and lets it be repeated', async () => {
    const server = serve({ attempt: makeMyAttempt(), submit: (call) => (call === 0 ? refusal(502, undefined) : makeFinishedAttempt()) })
    renderTake()
    await opened()
    const submit = async () => {
      fireEvent.click(screen.getByTestId('submit-exam'))
      const dialog = (await screen.findAllByText(take.submit.confirmTitle)).at(-1)!.closest('[role="dialog"]') as HTMLElement
      fireEvent.click(within(dialog).getByText(take.submit.confirmOk).closest('button')!)
    }
    fireEvent.click(screen.getByTestId('open-review'))
    await submit()
    const failure = await screen.findByTestId('submit-failure')
    expect(failure).toHaveTextContent(take.submit.failed)
    expect(failure).toHaveTextContent(ar.login.errors.server)
    expect(screen.queryByTestId('attempt-finished')).not.toBeInTheDocument()
    expect(server.submits()).toHaveLength(1)

    // Still on the review, with the button ready again: the same submit is safe to repeat.
    await waitFor(() => expect(screen.getByTestId('submit-exam')).not.toHaveClass('ant-btn-loading'))
    await submit()
    await screen.findByTestId('attempt-finished')
    expect(server.submits()).toHaveLength(2)
  })
})

describe('TakeExamPage — the server’s clock', () => {
  it('counts the server’s seconds down on the monotonic clock, whatever the device’s date says, with a warning under five minutes and a stronger one under one', async () => {
    vi.useFakeTimers()
    // The device believes it is a day after the deadline (`expiresAt` 2026-11-20T08:00Z): the timer must not care.
    vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'))
    // A server with a clock of its own: 302 seconds at the first read, less by what has passed at every later one.
    const startedAt = performance.now()
    const server = serve({ attempt: () => makeMyAttempt({ remainingSeconds: Math.max(0, Math.ceil((302_000 - (performance.now() - startedAt)) / 1000)) }) })
    renderTake()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(timerText()).toBe('05:02')
    expect(screen.getByTestId('exam-timer')).toHaveAttribute('data-level', 'normal')
    expect(screen.getByTestId('exam-timer-spoken')).toHaveTextContent(i18n.t('takeExam.timer.spoken', { count: 6 }))
    expect(screen.getByTestId('exam-timer-spoken')).toHaveAttribute('aria-live', 'polite')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(timerText()).toBe('05:00')
    expect(screen.getByTestId('exam-timer-spoken')).toHaveTextContent(i18n.t('takeExam.timer.spoken', { count: 5 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(timerText()).toBe('04:59')
    expect(screen.getByTestId('exam-timer')).toHaveAttribute('data-level', 'warning')

    // The device's date is set back by a week in the middle of the exam: nothing changes on screen —
    expect(server.reads()).toHaveLength(1)
    vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(timerText()).toBe('04:58')
    // — and, the device's clocks no longer agreeing, the page asked the server for the time left again.
    expect(server.reads()).toHaveLength(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000 - 1_000)
    })
    expect(timerText()).toBe('00:59')
    expect(screen.getByTestId('exam-timer')).toHaveAttribute('data-level', 'critical')
    expect(screen.getByTestId('exam-timer-spoken')).toHaveTextContent(i18n.t('takeExam.timer.spoken', { count: 1 }))
    expect(screen.getByTestId('question-card')).toBeInTheDocument()
  })

  it('re-synchronises from a save’s answer', async () => {
    vi.useFakeTimers()
    serve({ attempt: makeMyAttempt({ remainingSeconds: 1800 }), save: () => makeSaveResult({ remainingSeconds: 900 }) })
    renderTake()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(timerText()).toBe('30:00')
    fireEvent.click(option(QUESTION_PROMPTS[0], 'ثمانية'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // The server says fifteen minutes are left: that is what the timer shows.
    expect(timerText()).toBe('15:00')
  })

  it('when the time reaches zero: stops taking answers, submits ONCE and shows the finished state with «انتهى الوقت»', async () => {
    vi.useFakeTimers()
    const server = serve({
      attempt: makeMyAttempt({ remainingSeconds: 3 }),
      submit: () => makeFinishedAttempt({ status: 'timed_out', submittedAt: '2026-11-20T08:00:00.000Z', questions: makeAttemptQuestions() }),
    })
    renderTake()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(timerText()).toBe('00:03')
    expect(screen.getByTestId('exam-timer')).toHaveAttribute('data-level', 'critical')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_750)
    })
    expect(server.submits()).toHaveLength(0)
    expect(screen.getByTestId('question-card')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    // The answers are gone from the screen and the one submit went out.
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument()
    expect(server.submits()).toHaveLength(1)
    const finished = screen.getByTestId('attempt-finished')
    expect(within(finished).getByRole('heading', { level: 2 })).toHaveTextContent(take.finished.timedOutTitle)
    expect(within(finished).getByRole('heading', { level: 2 })).toHaveFocus()
    expect(screen.getByTestId('finished-status')).toHaveTextContent(take.finished.timedOut)

    // Later ticks change nothing: still one submit, no save, no further read.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(server.submits()).toHaveLength(1)
    expect(server.saves()).toHaveLength(0)
    expect(server.reads()).toHaveLength(1)
  })

  it('flushes the last answer before the submit when the time runs out, and says «انتهى الوقت» even when the server counts it as submitted', async () => {
    vi.useFakeTimers()
    const server = serve({ attempt: makeMyAttempt({ remainingSeconds: 2 }), save: () => makeSaveResult({ remainingSeconds: 1 }), submit: () => makeFinishedAttempt() })
    renderTake()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.click(option(QUESTION_PROMPTS[0], 'ثمانية'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(server.calls.map((call) => `${call.method} ${call.path.split('/').at(-1)}`)).toEqual([`GET ${ATTEMPT_ID}`, 'PUT answers', 'POST submit'])
    const finished = screen.getByTestId('attempt-finished')
    expect(within(finished).getByRole('heading', { level: 2 })).toHaveTextContent(take.finished.timedOutTitle)
    expect(within(finished).getByText(take.finished.endedByClock)).toBeInTheDocument()
  })

  it('submits once and shows the result when the attempt comes back with its time already up', async () => {
    const server = serve({
      attempt: makeMyAttempt({ timeUp: true, remainingSeconds: 0, questions: makeAnsweredQuestions() }),
      submit: () => makeFinishedAttempt({ status: 'timed_out', resultReleased: true, result: makeAttemptResult({ score: 6 }) }),
    })
    renderTake()
    const finished = await screen.findByTestId('attempt-finished')
    expect(within(finished).getByRole('heading', { level: 2 })).toHaveTextContent(take.finished.timedOutTitle)
    expect(screen.getByTestId('result-score')).toHaveTextContent('6 / 10')
    expect(server.submits()).toHaveLength(1)
    expect(server.saves()).toHaveLength(0)
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument()
  })

  it('reads the attempt again when the submit at the end of the time fails, and waits with «تحديث» while the server has not closed it', async () => {
    let submits = 0
    const server = serve({
      attempt: makeMyAttempt({ timeUp: true, remainingSeconds: 0 }),
      submit: () => (submits++ === 0 ? refusal(503, undefined) : makeFinishedAttempt({ status: 'timed_out' })),
    })
    renderTake()
    const stalled = await screen.findByTestId('attempt-stalled')
    expect(within(stalled).getByRole('heading', { level: 2 })).toHaveTextContent(take.timeUp.stalledTitle)
    expect(within(stalled).getByText(take.timeUp.stalledText)).toBeInTheDocument()
    expect(server.submits()).toHaveLength(1)
    expect(server.reads()).toHaveLength(2)

    fireEvent.click(within(stalled).getByText(take.timeUp.refresh).closest('button')!)
    const finished = await screen.findByTestId('attempt-finished')
    expect(within(finished).getByRole('heading', { level: 2 })).toHaveTextContent(take.finished.timedOutTitle)
    expect(server.submits()).toHaveLength(2)
  })

  it('sends what is unsaved once more with keepalive when the tab is hidden, and reads the server’s time again when it is shown', async () => {
    vi.useFakeTimers()
    const gate = deferred<SaveAnswersResult>()
    let reads = 0
    const [first, second, third] = makeAttemptQuestions()
    // The second read: twenty minutes on, with the answer the first save stored.
    const later = makeMyAttempt({ remainingSeconds: 600, questions: [{ ...first!, answer: { optionId: OPTION_IDS.first[1], value: null } }, second!, third!] })
    const server = serve({
      attempt: () => (reads++ === 0 ? makeMyAttempt({ remainingSeconds: 1800 }) : later),
      save: (_answers, call) => (call === 0 ? gate.promise : makeSaveResult({ remainingSeconds: 1795 })),
    })
    renderTake()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => setVisibility('hidden'))
    expect(server.saves()).toHaveLength(0) // nothing unsaved: nothing to flush

    fireEvent.click(option(QUESTION_PROMPTS[0], 'ثمانية'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(server.saves()).toHaveLength(1)
    await act(async () => {
      setVisibility('hidden')
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(server.saves()).toHaveLength(2)
    expect(server.saves()[1]!.keepalive).toBe(true)
    expect(server.saved()[1]).toEqual([{ examQuestionId: Q1, optionId: OPTION_IDS.first[1] }])
    expect(server.submits()).toHaveLength(0) // leaving never submits

    // Twenty minutes later (the server says so — the tab's timers were asleep) the learner comes back.
    await act(async () => {
      gate.resolve(makeSaveResult({ remainingSeconds: 1798 }))
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await act(async () => {
      setVisibility('visible')
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(server.reads()).toHaveLength(2)
    expect(timerText()).toBe('10:00')
    expect(option(QUESTION_PROMPTS[0], 'ثمانية').checked).toBe(true)
  })
})

describe('TakeExamPage — a finished attempt', () => {
  it('shows no result and no number while the server has not released one, and nothing about correct answers', async () => {
    const server = serve({ attempt: makeFinishedAttempt() })
    renderTake()
    const finished = await screen.findByTestId('attempt-finished')

    expect(within(finished).getByRole('heading', { level: 2 })).toHaveTextContent(take.finished.submittedTitle)
    expect(screen.getByTestId('finished-status')).toHaveTextContent(i18n.t('takeExam.finished.submittedAt', { date: formatZonedDateTime('2026-11-20T07:50:00.000Z', 'Asia/Riyadh', 'ar') }))
    expect(screen.getByTestId('result-awaiting')).toHaveTextContent(take.result.awaiting)
    expect(screen.queryByTestId('result-score')).not.toBeInTheDocument()
    expect(screen.queryByTestId('result-correct')).not.toBeInTheDocument()
    expect(screen.queryByTestId('result-pass')).not.toBeInTheDocument()
    expect(screen.getByTestId('attempt-result')).not.toHaveTextContent(/\d/)
    // The learner's own answers are there; no grading, no key, and — the exam does not reveal answers — no promise of one.
    expect(screen.getByTestId('attempt-answers')).toBeInTheDocument()
    expect(screen.queryByTestId('attempt-review')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('finished-question')).toHaveLength(3)
    expect(screen.getAllByText(take.answers.yourChoice)).toHaveLength(2)
    expect(screen.getByText(take.answers.notAnswered)).toBeInTheDocument()
    for (const word of [take.answers.correct, take.answers.wrong, take.answers.correctAnswer, take.answers.explanation]) expect(screen.queryByText(word)).not.toBeInTheDocument()
    expect(screen.queryByTestId('correct-answer-mark')).not.toBeInTheDocument()
    expect(screen.queryByTestId('question-grade')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-pending')).not.toBeInTheDocument()
    // A finished attempt is read, never written: no timer, nothing to choose, no save, no submit.
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(within(finished).queryByRole('radio')).not.toBeInTheDocument()
    expect(server.calls.map((call) => call.method)).toEqual(['GET'])
    expect(within(finished).getByRole('link', { name: take.page.back })).toHaveAttribute('href', '/my-exams')
  })

  it('shows the released result as the server sent it: the score, the correct answers, the pass tag and which attempt counts', async () => {
    serve({
      attempt: makeFinishedAttempt({
        attemptNo: 2,
        id: ATTEMPT_ID_2,
        exam: makeAttemptExam({ attemptsAllowed: 2, resultsRelease: 'on_submit' }),
        resultReleased: true,
        result: makeAttemptResult({ score: 6, correctCount: 2, isPass: true, counted: false }),
        attempts: [
          makeAttemptSummary({ status: 'submitted', submittedAt: '2026-11-20T07:40:00.000Z', score: 8 }),
          makeAttemptSummary({ id: ATTEMPT_ID_2, attemptNo: 2, status: 'submitted', submittedAt: '2026-11-20T07:50:00.000Z', score: 6 }),
        ],
      }),
    })
    renderTake(ATTEMPT_ID_2)
    await screen.findByTestId('attempt-finished')

    expect(screen.getByTestId('result-score')).toHaveTextContent('6 / 10')
    expect(screen.getByTestId('result-score').querySelector('bdi')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByTestId('result-correct')).toHaveTextContent('2 / 3')
    expect(screen.getByTestId('result-pass')).toHaveTextContent(take.result.passed)
    expect(screen.getByText(take.result.notCounted)).toBeInTheDocument()
    expect(screen.queryByTestId('result-awaiting')).not.toBeInTheDocument()

    // The other attempt is one link away; this one is marked, not linked.
    const attempts = screen.getByTestId('attempts-list')
    expect(within(attempts).getByText('8 / 10')).toBeInTheDocument()
    expect(within(attempts).getByText(take.attempts.current)).toBeInTheDocument()
    expect(within(attempts).getAllByRole('link')).toHaveLength(1)
    expect(within(attempts).getByRole('link', { name: i18n.t('takeExam.list.viewAttemptOf', { number: 1 }) })).toHaveAttribute('href', `/take-exam/${ATTEMPT_ID}`)
  })

  it('shows «below the pass score» as the server decided, and no pass tag at all when the exam names no pass score', async () => {
    serve({ attempt: makeFinishedAttempt({ resultReleased: true, result: makeAttemptResult({ score: 2, correctCount: 1, isPass: false }) }) })
    const first = renderTake()
    await screen.findByTestId('attempt-finished')
    expect(screen.getByTestId('result-pass')).toHaveTextContent(take.result.failed)
    // One attempt allowed and one made: nothing to say about which one counts.
    expect(screen.queryByText(take.result.counted)).not.toBeInTheDocument()
    expect(screen.queryByTestId('attempts-list')).not.toBeInTheDocument()
    first.unmount()

    serve({ attempt: makeFinishedAttempt({ exam: makeAttemptExam({ passScore: null }), resultReleased: true, result: makeAttemptResult({ isPass: null }) }) })
    renderTake()
    await screen.findByTestId('attempt-finished')
    expect(screen.getByTestId('result-score')).toHaveTextContent('6 / 10')
    expect(screen.queryByTestId('result-pass')).not.toBeInTheDocument()
    expect(screen.queryByText(take.result.passScore)).not.toBeInTheDocument()
  })

  it('shows the review only when the server sent it: right / wrong, the points earned, the correct answer and the explanation', async () => {
    serve({
      attempt: makeFinishedAttempt({
        exam: makeAttemptExam({ revealAnswers: true, resultsRelease: 'on_submit' }),
        questions: makeReviewedQuestions(),
        resultReleased: true,
        reviewReleased: true,
        result: makeAttemptResult(),
      }),
    })
    renderTake()
    await screen.findByTestId('attempt-finished')

    expect(screen.getByTestId('attempt-review')).toBeInTheDocument()
    expect(screen.getByText(take.answers.reviewTitle)).toBeInTheDocument()
    const [first, second, third] = screen.getAllByTestId('finished-question') as [HTMLElement, HTMLElement, HTMLElement]
    // Right: the learner's choice is the one the server named.
    expect(within(first).getByTestId('question-grade')).toHaveTextContent(take.answers.correct)
    expect(within(first).getByText('ثمانية').closest('li')).toHaveTextContent(take.answers.yourChoice)
    expect(within(first).getByTestId('correct-answer-mark').closest('li')).toHaveTextContent('ثمانية')
    expect(first).toHaveTextContent(`${take.answers.pointsAwarded} 4 / 4`)
    expect(within(first).getByText(take.answers.explanation)).toBeInTheDocument()
    expect(within(first).getByText('العامل ** هو الأُس: 2 × 2 × 2.')).toBeInTheDocument()
    // Unanswered: wrong, no points, and the correct option as the server named it.
    expect(within(second).getByTestId('question-grade')).toHaveTextContent(take.answers.wrong)
    expect(within(second).getByText(take.answers.notAnswered)).toBeInTheDocument()
    expect(within(second).getByTestId('correct-answer-mark').closest('li')).toHaveTextContent('str')
    expect(second).toHaveTextContent(`${take.answers.pointsAwarded} 0 / 4`)
    expect(within(second).queryByText(take.answers.explanation)).not.toBeInTheDocument()
    // True/false: the correct one of «صحيح» / «خطأ».
    expect(within(third).getByTestId('correct-answer-mark').closest('li')).toHaveTextContent(take.question.trueOption)
    expect(third).toHaveTextContent(`${take.answers.pointsAwarded} 2 / 2`)
    expect(screen.queryByTestId('review-pending')).not.toBeInTheDocument()
  })

  it('says when the correct answers will appear for an exam that reveals them later — and still marks nothing', async () => {
    const closesAt = '2026-11-20T09:00:00.000Z'
    serve({ attempt: makeFinishedAttempt({ exam: makeAttemptExam({ revealAnswers: true, resultsRelease: 'on_submit', closesAt }), resultReleased: true, result: makeAttemptResult() }) })
    const first = renderTake()
    await screen.findByTestId('attempt-finished')
    expect(screen.getByTestId('review-pending')).toHaveTextContent(i18n.t('takeExam.answers.pendingCloseAt', { date: formatZonedDateTime(closesAt, 'Asia/Riyadh', 'ar') }))
    expect(screen.queryByTestId('correct-answer-mark')).not.toBeInTheDocument()
    expect(screen.queryByTestId('question-grade')).not.toBeInTheDocument()
    first.unmount()

    // Results on publication: the answers wait for it too.
    serve({ attempt: makeFinishedAttempt({ exam: makeAttemptExam({ revealAnswers: true }) }) })
    renderTake()
    await screen.findByTestId('attempt-finished')
    expect(screen.getByTestId('review-pending')).toHaveTextContent(take.answers.pendingPublish)
    expect(screen.getByTestId('result-awaiting')).toBeInTheDocument()
  })

  it('opens another attempt of the exam from the list, from a clean state', async () => {
    const second = makeFinishedAttempt({
      id: ATTEMPT_ID_2,
      attemptNo: 2,
      status: 'timed_out',
      attempts: [makeAttemptSummary({ status: 'submitted', submittedAt: '2026-11-20T07:40:00.000Z' }), makeAttemptSummary({ id: ATTEMPT_ID_2, attemptNo: 2, status: 'timed_out', submittedAt: '2026-11-20T08:00:00.000Z' })],
    })
    const first = makeFinishedAttempt({ exam: makeAttemptExam({ attemptsAllowed: 2 }), attempts: second.attempts })
    const server = serve({ attempt: (_read, attemptId) => (attemptId === ATTEMPT_ID_2 ? second : first) })
    renderTake()
    await screen.findByTestId('attempt-finished')
    expect(screen.getByTestId('attempt-number')).toHaveTextContent(i18n.t('takeExam.page.attemptNo', { number: 1 }))

    fireEvent.click(screen.getByRole('link', { name: i18n.t('takeExam.list.viewAttemptOf', { number: 2 }) }))
    await waitFor(() => expect(screen.getByTestId('attempt-number')).toHaveTextContent(i18n.t('takeExam.page.attemptNo', { number: 2 })))
    expect(screen.getByTestId('finished-status')).toHaveTextContent(take.finished.timedOut)
    expect(server.reads().map((call) => call.path)).toEqual([`/api/me/exam-attempts/${ATTEMPT_ID}`, `/api/me/exam-attempts/${ATTEMPT_ID_2}`])
  })
})

describe('TakeExamPage — other states', () => {
  it('says plainly that an attempt is not the learner’s (404), with the way back — and asks nothing else', async () => {
    const server = serve({ attempt: refusal(404, 'attempt_not_found', { attemptId: ATTEMPT_ID }) })
    renderTake()
    const notice = await screen.findByTestId('attempt-not-found')
    expect(within(notice).getByRole('heading', { level: 2 })).toHaveTextContent(take.page.notFoundTitle)
    expect(within(notice).getByText(take.page.notFoundText)).toBeInTheDocument()
    fireEvent.click(within(notice).getByRole('link', { name: take.page.back }))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/my-exams')
    expect(server.calls).toHaveLength(1)
  })

  it('treats an id no attempt can have as not found', async () => {
    serve({ attempt: refusal(400, undefined, { message: 'Validation failed (uuid is expected)' }) })
    renderTake('not-an-id')
    expect(await screen.findByTestId('attempt-not-found')).toBeInTheDocument()
  })

  it('offers a retry when the attempt cannot be loaded', async () => {
    let reads = 0
    serve({ attempt: () => (reads++ === 0 ? refusal(500, undefined) : makeMyAttempt()) })
    renderTake()
    expect(screen.getByRole('status', { name: take.page.loading })).toBeInTheDocument()
    expect(await screen.findByText(take.page.loadFailed)).toBeInTheDocument()
    expect(screen.getByText(ar.login.errors.server)).toBeInTheDocument()
    fireEvent.click(button(take.page.retry))
    await opened()
    expect(screen.queryByText(take.page.loadFailed)).not.toBeInTheDocument()
  })

  it('reads in English as well, with the counted sentences worded for none and for one', async () => {
    await act(() => i18n.changeLanguage('en'))
    try {
      const [first, second, third] = makeAnsweredQuestions()
      const server = serve({ attempt: makeMyAttempt({ questions: [first!, { ...second!, answer: { optionId: OPTION_IDS.second[1], value: null } }, third!], remainingSeconds: 60 }) })
      renderTake()
      await opened()

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Quiz: Python basics')
      expect(screen.getByTestId('attempt-number')).toHaveTextContent('Attempt 1')
      expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('01:00')
      expect(screen.getByTestId('exam-timer-spoken')).toHaveTextContent('1 minute left')
      expect(questionHeading()).toHaveTextContent('Question 1 of 3')
      expect(screen.getByText('All answers saved')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Back to my exams' })).toHaveAttribute('href', '/my-exams')
      // «True» / «False» as the choices of the third question; the navigator names each button.
      fireEvent.click(screen.getByLabelText('Question 3, answered'))
      expect(option(QUESTION_PROMPTS[2], 'True').checked).toBe(true)

      // Every question is answered: the review and the final confirmation say so — never «0 questions…».
      fireEvent.click(screen.getByText('Review and submit').closest('button')!)
      expect(screen.getByText('You answered 3 of 3.')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('submit-exam'))
      const dialog = (await screen.findAllByText('Submit the exam?')).at(-1)!.closest('[role="dialog"]') as HTMLElement
      expect(within(dialog).getByText('You answered every question.')).toBeInTheDocument()
      expect(dialog).not.toHaveTextContent(/\b0 questions/)
      fireEvent.click(within(dialog).getByText('Yes, submit now').closest('button')!)
      const finished = await screen.findByTestId('attempt-finished')
      expect(within(finished).getByRole('heading', { level: 2 })).toHaveTextContent('Exam submitted')
      expect(screen.getByTestId('result-awaiting')).toHaveTextContent('Your result appears when the teacher publishes the results.')
      expect(server.submits()).toHaveLength(1)
    } finally {
      await act(() => i18n.changeLanguage('ar'))
    }
  })
})
