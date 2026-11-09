import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Assignment } from '../api/assignments'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { ASSIGNMENT_ADMIN_PERMISSIONS, ASSIGNMENT_ID, ASSIGNMENT_READER_PERMISSIONS, LINKED_LESSON, makeAssignment } from '../test/assignments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLesson, makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { AssignmentDrawer } from './AssignmentDrawer'
import { formatZonedDateTime, formatZonedDay } from './assignments.format'
import { instantIn } from './assignments.zone'

interface Call {
  method: string
  url: string
  body: unknown
}

type Respond = (method: string, body: unknown) => Response | undefined

/**
 * GET /api/assignments/:id answers `detail()` (re-read on every call); a write answers what `respond` returns. The
 * academy and the class's lessons (the edit form's lesson select) answer too; `calls` records the assignment requests.
 */
function mockAssignmentApi(detail: () => Assignment, respond: Respond = () => undefined) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (parsed.pathname === '/api/lessons') return jsonResponse(200, makeLessonList([{ ...makeLesson(), timeZone: 'Asia/Riyadh' } as ReturnType<typeof makeLesson>]))
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url: parsed.pathname, body })
    if (method === 'GET') return jsonResponse(200, detail())
    return respond(method, body) ?? jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

function renderDrawer(permissions: string[] = ASSIGNMENT_ADMIN_PERMISSIONS) {
  const onUpdated = vi.fn()
  const onDeleted = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<AssignmentDrawer assignmentId={ASSIGNMENT_ID} onClose={onClose} onUpdated={onUpdated} onDeleted={onDeleted} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/assignments',
  })
  return { onUpdated, onDeleted, onClose }
}

async function openMenu() {
  fireEvent.click(screen.getByText(ar.assignments.actions.menu).closest('button')!)
  return screen.findAllByRole('menuitem')
}

async function chooseAction(label: string) {
  fireEvent.click(screen.getByText(ar.assignments.actions.menu).closest('button')!)
  fireEvent.click(await screen.findByText(label, { selector: '.ant-dropdown-menu-title-content' }))
}

async function openEdit() {
  fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
  return screen.findByLabelText(ar.assignments.fields.titleAr)
}

function save() {
  fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
}

const patches = (calls: Call[]) => calls.filter((call) => call.method === 'PATCH')
const reads = (calls: Call[]) => calls.filter((call) => call.method === 'GET')

describe('AssignmentDrawer', () => {
  it('shows a reader the assignment read-only: class, course, lesson, due date in its zone, rules, instructions and the submission counts; no edit, no actions', async () => {
    const assignment = makeAssignment({
      status: 'open',
      lesson: LINKED_LESSON,
      allowLate: true,
      latePenaltyPercent: 10,
      maxAttempts: 2,
      publishedAt: '2026-11-09T09:00:00.000Z',
      submissions: { students: 14, submitted: 6, graded: 7, returned: 1 },
    })
    mockAssignmentApi(() => assignment)
    renderDrawer(ASSIGNMENT_READER_PERMISSIONS)

    expect(await screen.findByText('حلّ تمارين الصفحة 12')).toBeInTheDocument()
    expect(screen.getByText('PY-101-A')).toBeInTheDocument()
    expect(screen.getByText(/أساسيات بايثون/)).toBeInTheDocument()
    expect(screen.getByText(`${formatZonedDay(LINKED_LESSON.startsAt, 'Asia/Riyadh', 'ar')} — المتغيرات وأنواع البيانات`)).toBeInTheDocument()
    // The due date in the assignment's zone (D-R41), named because it is neither the CI runner's nor this machine's zone.
    expect(screen.getByText(formatZonedDateTime('2026-11-20T20:59:00.000Z', 'Asia/Riyadh', 'ar'))).toBeInTheDocument()
    expect(screen.getByText('Asia/Riyadh')).toBeInTheDocument()
    expect(screen.getByText('مقبول بخصم 10%')).toBeInTheDocument()
    const counts = screen.getByTestId('assignment-submissions')
    expect(within(counts).getByText('سلّم 14 من 18')).toBeInTheDocument()
    expect(within(counts).getByText('بانتظار التصحيح: 6')).toBeInTheDocument()
    expect(within(counts).getByText('مصحَّح: 7')).toBeInTheDocument()
    expect(within(counts).getByText('مُعاد للتعديل: 1')).toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.assignments.actions.menu)).not.toBeInTheDocument()
  })

  it('says "not found or not in a class assigned to you" when the server answers 404', async () => {
    mockFetch((url) =>
      url.startsWith('/api/academy') ? jsonResponse(200, makeAcademy()) : jsonResponse(404, { statusCode: 404, code: 'assignment_not_found', assignmentId: ASSIGNMENT_ID, message: 'No assignment' }),
    )
    renderDrawer()
    expect(await screen.findByText(ar.assignments.errors.assignment_not_found)).toBeInTheDocument()
  })

  it('offers publish and delete for a draft, close for an open assignment and reopen for a closed one', async () => {
    let current = makeAssignment({ status: 'draft' })
    mockAssignmentApi(() => current)
    const { unmount } = renderWithProviders(<AssignmentDrawer assignmentId={ASSIGNMENT_ID} onClose={vi.fn()} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
      auth: makeAuth({ user: makeUser({ permissions: ASSIGNMENT_ADMIN_PERMISSIONS }) }),
    })
    await screen.findByText('PY-101-A')
    expect((await openMenu()).map((item) => item.textContent)).toEqual([ar.assignments.actions.publish, ar.assignments.actions.delete])
    unmount()

    current = makeAssignment({ status: 'open' })
    renderDrawer()
    await screen.findByText('PY-101-A')
    expect((await openMenu()).map((item) => item.textContent)).toEqual([ar.assignments.actions.close])
  })

  it('shows a closed assignment without its edit button, with the reopen action and the hint', async () => {
    mockAssignmentApi(() => makeAssignment({ status: 'closed', publishedAt: '2026-11-09T09:00:00.000Z', closedAt: '2026-11-21T09:00:00.000Z' }))
    renderDrawer()
    expect(await screen.findByText(ar.assignments.drawer.closedHint)).toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect((await openMenu()).map((item) => item.textContent)).toEqual([ar.assignments.actions.reopen])
  })

  it('keeps only close for an open assignment of a completed class, with the warning and no edit', async () => {
    mockAssignmentApi(() => makeAssignment({ status: 'open', class: { ...makeAssignment().class, status: 'completed' } }))
    renderDrawer()
    expect(await screen.findByText(ar.assignments.drawer.classClosed)).toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect((await openMenu()).map((item) => item.textContent)).toEqual([ar.assignments.actions.close])
  })

  it('publishes with the reason (POST /status) and hands the open assignment back', async () => {
    const published = makeAssignment({ status: 'open', publishedAt: '2026-11-09T10:00:00.000Z', updatedAt: '2026-11-09T10:00:00.000Z' })
    const calls = mockAssignmentApi(
      () => makeAssignment(),
      (method) => (method === 'POST' ? jsonResponse(200, published) : undefined),
    )
    const { onUpdated } = renderDrawer()
    await screen.findByText('PY-101-A')
    await chooseAction(ar.assignments.actions.publish)
    const dialog = screen.getByText(ar.assignments.confirm.publish).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.confirm.reason), ' جاهز للنشر ')
    fireEvent.click(within(dialog).getByText(ar.assignments.actions.publish, { selector: 'button span' }).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(published))
    expect(calls.filter((call) => call.method === 'POST')).toEqual([{ method: 'POST', url: `/api/assignments/${ASSIGNMENT_ID}/status`, body: { action: 'publish', reason: 'جاهز للنشر' } }])
    expect(await screen.findByText(ar.assignments.done.publish)).toBeInTheDocument()
  })

  it('deletes a draft (DELETE), reports it and closes', async () => {
    const calls = mockAssignmentApi(
      () => makeAssignment(),
      (method) => (method === 'DELETE' ? jsonResponse(204) : undefined),
    )
    const { onDeleted, onClose } = renderDrawer()
    await screen.findByText('PY-101-A')
    await chooseAction(ar.assignments.actions.delete)
    const dialog = screen.getByText(ar.assignments.confirm.delete).closest('[role="dialog"]') as HTMLElement
    // No reason field for a deletion: DELETE carries no body.
    expect(within(dialog).queryByLabelText(ar.assignments.confirm.reason)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByText(ar.assignments.actions.delete, { selector: 'button span' }).closest('button')!)

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(ASSIGNMENT_ID))
    expect(onClose).toHaveBeenCalled()
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([{ method: 'DELETE', url: `/api/assignments/${ASSIGNMENT_ID}`, body: undefined }])
  })

  it('re-reads the assignment when an action meets a status changed elsewhere (invalid_transition)', async () => {
    const calls = mockAssignmentApi(
      () => makeAssignment({ status: 'open' }),
      (method) =>
        method === 'POST' ? jsonResponse(409, { statusCode: 409, code: 'invalid_transition', from: 'closed', action: 'close', allowed: ['reopen'], message: 'Not allowed' }) : undefined,
    )
    renderDrawer()
    await screen.findByText('PY-101-A')
    await chooseAction(ar.assignments.actions.close)
    const dialog = screen.getByText(ar.assignments.confirm.close).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.assignments.actions.close, { selector: 'button span' }).closest('button')!)
    expect(await within(dialog).findByText(ar.assignments.errors.invalid_transition)).toBeInTheDocument()
    await waitFor(() => expect(reads(calls)).toHaveLength(2))
  })

  it('edits with the smallest PATCH: a new title and a cleared weight; the drawer shows the server answer', async () => {
    const saved = makeAssignment({ title: { ar: 'الحلقات المتداخلة', en: 'Loop exercises' }, weight: null, updatedAt: '2026-11-09T11:00:00.000Z' })
    const calls = mockAssignmentApi(
      () => makeAssignment(),
      (method) => (method === 'PATCH' ? jsonResponse(200, saved) : undefined),
    )
    const { onUpdated } = renderDrawer()
    await screen.findByText('PY-101-A')
    const title = await openEdit()
    await userEvent.clear(title)
    await userEvent.type(title, 'الحلقات المتداخلة')
    await userEvent.clear(screen.getByLabelText(ar.assignments.fields.weight))
    save()

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(saved))
    expect(patches(calls)).toEqual([{ method: 'PATCH', url: `/api/assignments/${ASSIGNMENT_ID}`, body: { title: { ar: 'الحلقات المتداخلة', en: 'Loop exercises' }, weight: null } }])
    expect(await screen.findByText(ar.assignments.drawer.saved)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.assignments.fields.titleAr)).not.toBeInTheDocument()
  })

  it('sends nothing when nothing changed', async () => {
    const calls = mockAssignmentApi(() => makeAssignment())
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    save()
    expect(await screen.findByText(ar.assignments.drawer.nothingChanged)).toBeInTheDocument()
    expect(patches(calls)).toEqual([])
  })

  it('types the due date in the assignment zone, named in the hint, and sends that instant', async () => {
    const calls = mockAssignmentApi(
      () => makeAssignment(),
      (method) => (method === 'PATCH' ? jsonResponse(200, makeAssignment({ dueAt: '2026-11-25T15:00:00.000Z', updatedAt: '2026-11-09T11:00:00.000Z' })) : undefined),
    )
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    expect(screen.getByLabelText(ar.assignments.fields.dueDate)).toHaveValue('2026-11-20')
    expect(screen.getByLabelText(ar.assignments.fields.dueTime)).toHaveValue('23:59')
    const hint = await screen.findByTestId('assignment-due-zone')
    expect(hint).toHaveTextContent(ar.assignments.zone.assignment)
    expect(hint).toHaveTextContent('Asia/Riyadh')
    fireEvent.change(screen.getByLabelText(ar.assignments.fields.dueDate), { target: { value: '2026-11-25' } })
    fireEvent.change(screen.getByLabelText(ar.assignments.fields.dueTime), { target: { value: '18:00' } })
    save()
    await waitFor(() => expect(patches(calls)).toHaveLength(1))
    expect(patches(calls)[0]!.body).toEqual({ dueAt: instantIn('2026-11-25', '18:00', 'Asia/Riyadh') })
    expect(patches(calls)[0]!.body).toEqual({ dueAt: '2026-11-25T15:00:00.000Z' })
  })

  it('locks the grading rules once a submission exists: those inputs are read-only with the reason, the title still edits', async () => {
    mockAssignmentApi(() => makeAssignment({ status: 'open', submissions: { students: 1, submitted: 1, graded: 0, returned: 0 } }))
    renderDrawer()
    await screen.findByText('PY-101-A')
    const title = await openEdit()
    expect(screen.getByText(ar.assignments.hints.gradingLocked)).toBeInTheDocument()
    expect(screen.getByLabelText(ar.assignments.fields.maxScore)).toBeDisabled()
    expect(screen.getByLabelText(ar.assignments.fields.maxAttempts)).toBeDisabled()
    expect(screen.getByLabelText(ar.assignments.fields.latePenaltyPercent)).toBeDisabled()
    expect(screen.getByLabelText(ar.assignments.fields.allowLate)).toBeDisabled()
    expect(title).toBeEnabled()
    expect(screen.getByLabelText(ar.assignments.fields.weight)).toBeEnabled()
  })

  it('maps assignment_locked onto the form: the stored score returns with the reason, the other change stays, and the re-read locks the rules', async () => {
    let current = makeAssignment({ status: 'open' })
    const calls = mockAssignmentApi(
      () => current,
      (method) => {
        if (method !== 'PATCH') return undefined
        // A student submitted meanwhile.
        current = makeAssignment({ status: 'open', submissions: { students: 1, submitted: 1, graded: 0, returned: 0 } })
        return jsonResponse(409, { statusCode: 409, code: 'assignment_locked', status: 'open', fields: ['maxScore'], submissionCount: 1, message: 'Locked' })
      },
    )
    renderDrawer()
    await screen.findByText('PY-101-A')
    const title = await openEdit()
    await userEvent.clear(title)
    await userEvent.type(title, 'الحلقات المتداخلة')
    const score = screen.getByLabelText(ar.assignments.fields.maxScore)
    await userEvent.clear(score)
    await userEvent.type(score, '25')
    save()

    expect(await screen.findByText(ar.assignments.validation.lockedAfterSubmission)).toBeInTheDocument()
    expect(patches(calls)).toEqual([{ method: 'PATCH', url: `/api/assignments/${ASSIGNMENT_ID}`, body: { title: { ar: 'الحلقات المتداخلة', en: 'Loop exercises' }, maxScore: 25 } }])
    expect(screen.getByLabelText(ar.assignments.fields.maxScore)).toHaveValue('20')
    expect(screen.getByLabelText(ar.assignments.fields.titleAr)).toHaveValue('الحلقات المتداخلة')
    await waitFor(() => expect(reads(calls)).toHaveLength(2))
    await waitFor(() => expect(screen.getByLabelText(ar.assignments.fields.maxScore)).toBeDisabled())
  })

  it('closes the form and re-reads when the class was completed meanwhile (class_closed)', async () => {
    const calls = mockAssignmentApi(
      () => makeAssignment(),
      (method) => (method === 'PATCH' ? jsonResponse(409, { statusCode: 409, code: 'class_closed', classId: 'c-1', status: 'completed', message: 'Closed' }) : undefined),
    )
    renderDrawer()
    await screen.findByText('PY-101-A')
    const title = await openEdit()
    await userEvent.type(title, '!')
    save()
    expect(await screen.findByText(ar.assignments.errors.class_closed)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText(ar.assignments.fields.titleAr)).not.toBeInTheDocument())
    await waitFor(() => expect(reads(calls)).toHaveLength(2))
  })
})
