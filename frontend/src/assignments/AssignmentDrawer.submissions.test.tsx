// The submissions tab of the assignment drawer (J-F41): the roster is read only
// when its tab opens; a review in the panel re-reads the roster and the
// assignment, so the drawer's counts and the list row (onUpdated) follow the
// server — the review's answer (API-111) carries the attempt only.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Assignment } from '../api/assignments'
import type { SubmissionRoster } from '../api/submissions'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { ASSIGNMENT_ID, ASSIGNMENT_TEACHER_PERMISSIONS, makeAssignment } from '../test/assignments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { SUBMISSION_IDS, makeGradedSubmission, makeSubmission, makeSubmissionRoster, makeSubmissionSummary, rosterOfFour } from '../test/submissions'
import { AssignmentDrawer } from './AssignmentDrawer'

const ROSTER_URL = `/api/assignments/${ASSIGNMENT_ID}/submissions`
const ASSIGNMENT_URL = `/api/assignments/${ASSIGNMENT_ID}`
const SUBMISSION_URL = `/api/submissions/${SUBMISSION_IDS[0]}`

interface ServerState {
  assignment: Assignment | Response
  roster: SubmissionRoster | Response
}

/** A small server: the assignment, its roster, Sara's submission and its review; every request is recorded. */
function mockServer(state: ServerState, onReview?: (body: unknown) => void) {
  const calls: Array<{ method: string; url: string; body: unknown }> = []
  const answer = (value: unknown) => (value instanceof Response ? value : jsonResponse(200, value))
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
    if (url === '/api/academy') return jsonResponse(200, makeAcademy())
    calls.push({ method, url, body })
    if (method === 'GET' && url === ASSIGNMENT_URL) return answer(state.assignment)
    if (method === 'GET' && url === ROSTER_URL) return answer(state.roster)
    if (method === 'GET' && url === SUBMISSION_URL) return jsonResponse(200, makeSubmission())
    if (method === 'POST' && url === `${SUBMISSION_URL}/review`) {
      onReview?.(body)
      return jsonResponse(200, makeGradedSubmission({ feedback: null }))
    }
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

function renderDrawer() {
  const onUpdated = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<AssignmentDrawer assignmentId={ASSIGNMENT_ID} onClose={onClose} onUpdated={onUpdated} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: ASSIGNMENT_TEACHER_PERMISSIONS }) }),
    route: '/assignments',
  })
  return { onUpdated, onClose }
}

/** Escape as the browser sends it: the drawers listen on the window (rc portal stack — only the top one reacts). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })

// Text and label queries, never getByRole with a name: in the whole drawer the accessible-name computation costs
// seconds per call in jsdom (KI-044).
const tabOf = (label: string) => screen.getByText(label).closest('[role="tab"]') as HTMLElement
const openSubmissionsTab = () => fireEvent.click(tabOf(ar.assignments.drawer.tabs.submissions))
const gets = (calls: Array<{ method: string; url: string }>, url: string) => calls.filter((call) => call.method === 'GET' && call.url === url)

describe('AssignmentDrawer — submissions tab (J-F41)', () => {
  it('reads the roster only when its tab opens, and goes back to the details to edit', async () => {
    const calls = mockServer({ assignment: makeAssignment({ status: 'open', maxAttempts: 2 }), roster: makeSubmissionRoster() })
    renderDrawer()
    await screen.findByText('حلّ تمارين الصفحة 12')
    expect(tabOf(ar.assignments.drawer.tabs.details)).toHaveAttribute('aria-selected', 'true')
    expect(gets(calls, ROSTER_URL)).toEqual([])

    openSubmissionsTab()
    expect(await screen.findByText('سارة الطالبة')).toBeInTheDocument()
    expect(gets(calls, ROSTER_URL)).toHaveLength(1)

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    expect(await screen.findByLabelText(ar.assignments.fields.titleAr)).toBeInTheDocument()
    expect(tabOf(ar.assignments.drawer.tabs.details)).toHaveAttribute('aria-selected', 'true')
  })

  it('after a grade, re-reads the roster and the assignment: the counts above the tabs and the list row follow the server', async () => {
    const state: ServerState = {
      assignment: makeAssignment({ status: 'open', maxAttempts: 2, submissions: { students: 3, submitted: 1, graded: 1, returned: 1 } }),
      roster: makeSubmissionRoster(),
    }
    const reviewed = makeAssignment({ status: 'open', maxAttempts: 2, submissions: { students: 3, submitted: 0, graded: 2, returned: 1 } })
    const calls = mockServer(state, () => {
      // The server after the grade.
      state.assignment = reviewed
      const [sara, ...others] = rosterOfFour()
      state.roster = makeSubmissionRoster({ items: [{ ...sara!, latest: makeSubmissionSummary({ status: 'graded', score: 17.5, gradedAt: '2026-11-21T09:00:00.000Z' }), lastGradedScore: 17.5 }, ...others] })
    })
    const { onUpdated } = renderDrawer()
    await screen.findByText('حلّ تمارين الصفحة 12')
    const counts = screen.getByTestId('assignment-submissions')
    expect(within(counts).getByText('بانتظار التصحيح: 1')).toBeInTheDocument()

    openSubmissionsTab()
    const sara = (await screen.findByText('سارة الطالبة')).closest('tr') as HTMLElement
    fireEvent.click(within(sara).getByLabelText(`${ar.assignments.roster.review}: سارة الطالبة`))
    await screen.findByTestId('submission-text')
    await userEvent.type(screen.getByLabelText('الدرجة (من 20)'), '17.5')
    fireEvent.click(screen.getByText(ar.assignments.review.form.submit.grade).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(reviewed))
    expect(within(screen.getByTestId('assignment-submissions')).getByText('بانتظار التصحيح: 0')).toBeInTheDocument()
    expect(within(screen.getByTestId('assignment-submissions')).getByText('مصحَّح: 2')).toBeInTheDocument()
    await waitFor(() => expect(gets(calls, ROSTER_URL)).toHaveLength(2))
    expect(gets(calls, ASSIGNMENT_URL)).toHaveLength(2)
    // The roster sits in the drawer; the panel (its own portal) names the student too.
    const roster = screen.getByTestId('assignment-roster')
    await waitFor(() => expect(within(within(roster).getByText('سارة الطالبة').closest('tr') as HTMLElement).getByText('17.5 / 20')).toBeInTheDocument())
  })

  it('Escape reaches the review panel, not the drawer below it: it closes an untouched panel, and keeps a typed feedback (the panel mask too)', async () => {
    // rc-util's useId answers the fixed 'test-id' under NODE_ENV=test, and rc-portal's Escape stack is deduplicated by
    // that id — it would hold the drawer alone. With real ids, as in a browser, the top-most portal (the panel) hears
    // Escape; nothing else here depends on NODE_ENV (React's build is chosen at import).
    vi.stubEnv('NODE_ENV', 'development')
    try {
      const calls = mockServer({ assignment: makeAssignment({ status: 'open', maxAttempts: 2 }), roster: makeSubmissionRoster() })
      const { onClose } = renderDrawer()
      await screen.findByText('حلّ تمارين الصفحة 12')
      openSubmissionsTab()
      const sara = (await screen.findByText('سارة الطالبة')).closest('tr') as HTMLElement
      const openPanel = async () => {
        fireEvent.click(within(sara).getByLabelText(`${ar.assignments.roster.review}: سارة الطالبة`))
        await screen.findByTestId('submission-text')
      }

      // Untouched: Escape closes the panel alone.
      await openPanel()
      pressEscape()
      await waitFor(() => expect(screen.queryByTestId('submission-text')).not.toBeInTheDocument())
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByTestId('assignment-roster')).toBeInTheDocument()

      // A typed feedback: Escape and the panel's mask (the top one — it covers the drawer) do nothing at all.
      await openPanel()
      await userEvent.type(screen.getByLabelText(ar.assignments.review.form.feedback), 'ملاحظة لم تُحفظ')
      pressEscape()
      pressEscape()
      const masks = document.querySelectorAll<HTMLElement>('.ant-drawer-mask')
      fireEvent.click(masks[masks.length - 1]!)
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByTestId('submission-text')).toBeInTheDocument()
      expect(screen.getByLabelText(ar.assignments.review.form.feedback)).toHaveValue('ملاحظة لم تُحفظ')
      expect(screen.queryByText(ar.assignments.review.discard.title)).not.toBeInTheDocument()
      expect(calls.filter((call) => call.method === 'POST')).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('re-reads the assignment when its roster answers 404, and shows that the assignment is out of reach', async () => {
    const state: ServerState = {
      assignment: makeAssignment({ status: 'open' }),
      roster: jsonResponse(404, { statusCode: 404, code: 'assignment_not_found', assignmentId: ASSIGNMENT_ID, message: 'No assignment' }),
    }
    const calls = mockServer(state)
    renderDrawer()
    await screen.findByText('حلّ تمارين الصفحة 12')
    state.assignment = jsonResponse(404, { statusCode: 404, code: 'assignment_not_found', assignmentId: ASSIGNMENT_ID, message: 'No assignment' })
    openSubmissionsTab()
    await waitFor(() => expect(gets(calls, ASSIGNMENT_URL)).toHaveLength(2))
    await waitFor(() => expect(screen.queryByText(ar.assignments.drawer.tabs.submissions)).not.toBeInTheDocument())
    expect(screen.getByText(ar.assignments.errors.assignment_not_found)).toBeInTheDocument()
  })
})
