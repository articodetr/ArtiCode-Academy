import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Assignment } from '../api/assignments'
import type { SubmissionRoster } from '../api/submissions'
import { ar } from '../i18n/ar'
import { ASSIGNMENT_ID, ASSIGNMENT_READER_PERMISSIONS, ASSIGNMENT_TEACHER_PERMISSIONS, makeAssignment } from '../test/assignments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeRosterItem, makeRosterStudent, makeSubmissionRoster, makeSubmissionSummary, rosterOfFour } from '../test/submissions'
import { AssignmentSubmissionsTab } from './AssignmentSubmissionsTab'
import { formatZonedDateTime } from './assignments.format'

const ZONE = 'Asia/Riyadh'

/** GET of the roster answers `roster()` (re-read on every call); every request is recorded. */
function mockRosterApi(roster: () => SubmissionRoster | Response) {
  const urls: string[] = []
  mockFetch((url) => {
    urls.push(url)
    if (url === `/api/assignments/${ASSIGNMENT_ID}/submissions`) {
      const answer = roster()
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return urls
}

function renderTab(permissions: string[] = ASSIGNMENT_TEACHER_PERMISSIONS, assignment: Assignment = makeAssignment({ status: 'open', maxAttempts: 2 })) {
  const onReviewed = vi.fn()
  const onAssignmentStale = vi.fn()
  renderWithProviders(<AssignmentSubmissionsTab assignment={assignment} onReviewed={onReviewed} onAssignmentStale={onAssignmentStale} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/assignments',
  })
  return { onReviewed, onAssignmentStale }
}

const findRow = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

async function chooseFilter(label: string) {
  fireEvent.mouseDown(screen.getByLabelText(ar.assignments.roster.filter))
  fireEvent.click(await screen.findByText(label, { selector: '.ant-select-item-option-content' }))
}

describe('AssignmentSubmissionsTab', () => {
  it('shows one row per student: the latest state, its time in the assignment zone with the server late mark, the score and the attempts against the allowance', async () => {
    mockRosterApi(() => makeSubmissionRoster())
    renderTab()

    const sara = await findRow('سارة الطالبة')
    expect(within(sara).getByText(ar.assignments.submissionStatus.submitted)).toBeInTheDocument()
    expect(within(sara).getByText(formatZonedDateTime('2026-11-18T07:30:00.000Z', ZONE, 'ar'))).toBeInTheDocument()
    expect(within(sara).getByText('المحاولة 1')).toBeInTheDocument()
    expect(within(sara).queryByText(ar.assignments.roster.late)).not.toBeInTheDocument()
    expect(within(sara).getByText('1 / 2')).toBeInTheDocument()

    const yousef = row('يوسف الطالب')
    expect(within(yousef).getByText('يوسف')).toBeInTheDocument()
    expect(within(yousef).getByText(ar.assignments.submissionStatus.graded)).toBeInTheDocument()
    expect(within(yousef).getByText(ar.assignments.roster.late)).toBeInTheDocument()
    expect(within(yousef).getByText('17.5 / 20')).toBeInTheDocument()

    // Withdrawn after submitting: still listed, with the enrollment tag; the last grade is an earlier attempt's.
    const layla = row('ليلى المنسحبة')
    expect(within(layla).getByText(ar.labels.withdrawn)).toBeInTheDocument()
    expect(within(layla).getByText(ar.assignments.submissionStatus.returned)).toBeInTheDocument()
    expect(within(layla).getByText('المحاولة 2')).toBeInTheDocument()
    expect(within(layla).getByText(/آخر درجة/)).toHaveTextContent('آخر درجة: 12 / 20')
    expect(within(layla).getByText('2 / 3')).toBeInTheDocument()

    const omar = row('عمر الخريج')
    expect(within(omar).getByText(ar.labels.completed)).toBeInTheDocument()
    expect(within(omar).getByText(ar.assignments.submissionStatus.none)).toBeInTheDocument()
    expect(within(omar).getByText('0 / 2')).toBeInTheDocument()
    expect(omar.querySelector('button')).toBeNull()

    // A teacher reviews: one button per student with an attempt (label queries — getByRole with a name is slow in jsdom, KI-044).
    expect(within(sara).getByLabelText(`${ar.assignments.roster.review}: سارة الطالبة`).closest('button')).toBeInTheDocument()
    expect(screen.getAllByLabelText(new RegExp(`^${ar.assignments.roster.review}: `))).toHaveLength(3)

    // The zone is named once (neither the CI runner's nor this machine's), with the server's attempt rule.
    expect(screen.getByTestId('roster-zone')).toHaveTextContent(`${ar.assignments.roster.zone} (${ZONE})`)
    expect(screen.getByText('لكل طالب 2 محاولة، ومحاولة إضافية عن كل تسليم يُعاد للتعديل')).toBeInTheDocument()
  })

  it('takes lateness from the server only: an attempt after the due date that the server did not mark shows no late tag', async () => {
    mockRosterApi(() =>
      makeSubmissionRoster({ items: [makeRosterItem({ latest: makeSubmissionSummary({ submittedAt: '2026-11-25T10:00:00.000Z', isLate: false }) })] }),
    )
    renderTab()
    const sara = await findRow('سارة الطالبة')
    expect(within(sara).getByText(formatZonedDateTime('2026-11-25T10:00:00.000Z', ZONE, 'ar'))).toBeInTheDocument()
    expect(within(sara).queryByText(ar.assignments.roster.late)).not.toBeInTheDocument()
  })

  it('offers «view» instead of «review» to a reader without assignments.grade', async () => {
    mockRosterApi(() => makeSubmissionRoster())
    renderTab(ASSIGNMENT_READER_PERMISSIONS)
    const sara = await findRow('سارة الطالبة')
    expect(within(sara).getByLabelText(`${ar.assignments.roster.view}: سارة الطالبة`)).toBeInTheDocument()
    expect(screen.queryAllByLabelText(new RegExp(`^${ar.assignments.roster.review}: `))).toEqual([])
  })

  it('filters the loaded roster locally by the latest state — awaiting review, not submitted, late — and says how many are shown', async () => {
    const urls = mockRosterApi(() => makeSubmissionRoster())
    renderTab()
    await findRow('سارة الطالبة')
    expect(screen.getByText(ar.assignments.roster.filterLocal)).toBeInTheDocument()

    await chooseFilter(ar.assignments.roster.filters.awaiting)
    await waitFor(() => expect(screen.queryByText('يوسف الطالب')).not.toBeInTheDocument())
    expect(screen.getByText('سارة الطالبة')).toBeInTheDocument()
    expect(screen.getByText('يُعرض 1 من 4')).toBeInTheDocument()

    await chooseFilter(ar.assignments.roster.filters.notSubmitted)
    expect(await screen.findByText('عمر الخريج')).toBeInTheDocument()
    expect(screen.queryByText('سارة الطالبة')).not.toBeInTheDocument()

    await chooseFilter(ar.assignments.roster.filters.late)
    expect(await screen.findByText('يوسف الطالب')).toBeInTheDocument()
    expect(screen.queryByText('عمر الخريج')).not.toBeInTheDocument()
    // No second request: the filter never reaches the server (API-108 takes none).
    expect(urls).toEqual([`/api/assignments/${ASSIGNMENT_ID}/submissions`])
  })

  it('says when the class has no students yet, and when the filter keeps none', async () => {
    let roster = makeSubmissionRoster({ items: [] })
    mockRosterApi(() => roster)
    renderTab()
    expect(await screen.findByText(ar.assignments.roster.empty)).toBeInTheDocument()

    roster = makeSubmissionRoster({ items: [rosterOfFour()[0]!] })
    fireEvent.click(screen.getByText(ar.assignments.roster.reload).closest('button')!)
    await findRow('سارة الطالبة')
    await chooseFilter(ar.assignments.roster.filters.graded)
    expect(await screen.findByText(ar.assignments.roster.emptyFiltered)).toBeInTheDocument()
  })

  it('shows a failed read with a retry, then the roster', async () => {
    let fail = true
    mockRosterApi(() => (fail ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : makeSubmissionRoster()))
    renderTab()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ar.login.errors.server)
    fail = false
    fireEvent.click(within(alert).getByText(ar.assignments.refresh).closest('button')!)
    expect(await screen.findByText('سارة الطالبة')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('asks the drawer to re-read the assignment when the roster answers 404', async () => {
    mockRosterApi(() => jsonResponse(404, { statusCode: 404, code: 'assignment_not_found', assignmentId: ASSIGNMENT_ID, message: 'No assignment' }))
    const { onAssignmentStale } = renderTab()
    expect(await screen.findByText(ar.assignments.errors.assignment_not_found)).toBeInTheDocument()
    await waitFor(() => expect(onAssignmentStale).toHaveBeenCalledTimes(1))
  })

  it('says a draft takes no submission before it is published', async () => {
    mockRosterApi(() => makeSubmissionRoster({ items: [makeRosterItem({ student: makeRosterStudent(), attempts: 0, latest: null })] }))
    renderTab(ASSIGNMENT_TEACHER_PERMISSIONS, makeAssignment())
    expect(await screen.findByText(ar.assignments.roster.draft)).toBeInTheDocument()
    expect(within(await findRow('سارة الطالبة')).getByText(ar.assignments.submissionStatus.none)).toBeInTheDocument()
  })
})
