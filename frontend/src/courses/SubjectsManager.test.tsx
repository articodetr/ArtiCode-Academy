// PORTAL-04 — the «المواد» tab of the courses page (a mirror of LevelsManager.test.tsx): the list in order, create,
// the smallest PATCH, the order, delete — refused while a course uses the subject.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Subject } from '../api/subjects'
import { ar } from '../i18n/ar'
import { COURSE_MANAGER_PERMISSIONS } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { SUBJECT_IDS, THREE_SUBJECTS, makeSubject } from '../test/subjects'
import { SubjectsManager } from './SubjectsManager'
import { useSubjects } from './useSubjects'

interface Call {
  method: string
  url: string
  body: unknown
}

const sub = ar.courses.subjects

/** GET serves `current` (re-read on every call); writes answer with `writes(method, url, body)`. */
function mockSubjectsApi(initial: Subject[], writes: (method: string, url: string, body: unknown) => Response) {
  const state = { current: initial }
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (method === 'GET') return jsonResponse(200, { items: state.current })
    return writes(method, url, body)
  })
  return { calls, state }
}

function Harness() {
  const state = useSubjects()
  return <SubjectsManager state={state} />
}

function renderManager() {
  renderWithProviders(<Harness />, { auth: makeAuth({ user: makeUser({ permissions: COURSE_MANAGER_PERMISSIONS }) }), route: '/courses' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

const codesOnScreen = () => bodyRows().map((row) => within(row).getByText(/^(PROG|MATH|ART)$/).textContent)
const writesOf = (calls: Call[]) => calls.filter((call) => call.method !== 'GET')

describe('SubjectsManager (PORTAL-04)', () => {
  it('lists the subjects from GET /api/subjects in order with status and course counts; one in use cannot be deleted', async () => {
    const { calls } = mockSubjectsApi(THREE_SUBJECTS(), () => jsonResponse(500, {}))
    renderManager()

    expect(await screen.findByText('MATH')).toBeInTheDocument()
    expect(calls[0]).toEqual({ method: 'GET', url: '/api/subjects', body: undefined })
    expect(codesOnScreen()).toEqual(['PROG', 'MATH', 'ART'])
    const rows = bodyRows()
    expect(within(rows[0]!).getByText('البرمجة')).toBeInTheDocument()
    expect(within(rows[2]!).getByText(ar.labels.inactive)).toBeInTheDocument()
    expect(screen.getByLabelText(`${sub.delete}: PROG`)).toBeDisabled()
    expect(screen.getByLabelText(`${sub.delete}: MATH`)).toBeEnabled()
    expect(screen.getByLabelText(`${sub.moveUp}: PROG`)).toBeDisabled()
    expect(screen.getByLabelText(`${sub.moveDown}: ART`)).toBeDisabled()
  })

  it('creates a subject through the modal (POST with the normalised body) and appends the server row', async () => {
    const created = makeSubject({ id: '0193a000-0000-7000-8000-00000000a009', code: 'SCI', name: { ar: 'العلوم' }, sortOrder: 3, courseCount: 0 })
    const { calls } = mockSubjectsApi(THREE_SUBJECTS(), () => jsonResponse(201, created))
    renderManager()
    await screen.findByText('MATH')

    fireEvent.click(screen.getByText(sub.add).closest('button')!)
    const dialog = (await screen.findByText(sub.createTitle)).closest('[role="dialog"]') as HTMLElement
    // A subject has no description.
    expect(within(dialog).queryByLabelText(ar.courses.levels.fields.descriptionAr)).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(sub.fields.code), 'sci')
    await userEvent.type(within(dialog).getByLabelText(sub.fields.nameAr), 'العلوم')
    fireEvent.click(within(dialog).getByText(sub.create).closest('button')!)

    expect(await screen.findByText('SCI')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'POST', url: '/api/subjects', body: { code: 'SCI', name: { ar: 'العلوم' } } }])
    expect(bodyRows()).toHaveLength(4)
    expect(await screen.findByText('تم إنشاء المادة «العلوم»')).toBeInTheDocument()
  })

  it('edits with the smallest PATCH, and sends nothing when the form did not change', async () => {
    const subjects = THREE_SUBJECTS()
    const { calls } = mockSubjectsApi(subjects, (_method, _url, body) => jsonResponse(200, { ...subjects[1]!, ...(body as object), updatedAt: '2026-11-24T12:00:00.000Z' }))
    renderManager()
    await screen.findByText('MATH')

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: MATH`))
    let dialog = (await screen.findByText('تعديل المادة «الرياضيات»')).closest('[role="dialog"]') as HTMLElement
    const english = within(dialog).getByLabelText(sub.fields.nameEn)
    await userEvent.clear(english)
    await userEvent.type(english, 'Maths')
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(sub.saved)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', url: `/api/subjects/${SUBJECT_IDS[1]}`, body: { name: { ar: 'الرياضيات', en: 'Maths' } } }])

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: ART`))
    dialog = (await screen.findByText('تعديل المادة «الفنون»')).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(sub.nothingChanged)).toBeInTheDocument()
    expect(writesOf(calls)).toHaveLength(1)
  })

  it('shows a taken code on the code field and keeps the modal open', async () => {
    mockSubjectsApi(THREE_SUBJECTS(), () => jsonResponse(409, { statusCode: 409, code: 'subject_code_taken', subjectCode: 'MATH', message: 'taken' }))
    renderManager()
    await screen.findByText('MATH')

    fireEvent.click(screen.getByText(sub.add).closest('button')!)
    const dialog = (await screen.findByText(sub.createTitle)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(sub.fields.code), 'math')
    await userEvent.type(within(dialog).getByLabelText(sub.fields.nameAr), 'رياضيات')
    fireEvent.click(within(dialog).getByText(sub.create).closest('button')!)
    expect(await within(dialog).findByText(ar.courses.errors.subject_code_taken)).toBeInTheDocument()
  })

  it('moves a subject down by sending the complete new order and shows the order the server returns', async () => {
    const [prog, math, art] = THREE_SUBJECTS()
    const { calls } = mockSubjectsApi([prog!, math!, art!], () => jsonResponse(200, { items: [math!, prog!, art!] }))
    renderManager()
    await screen.findByText('MATH')

    fireEvent.click(screen.getByLabelText(`${sub.moveDown}: PROG`))
    await waitFor(() => expect(writesOf(calls)).toEqual([{ method: 'PUT', url: '/api/subjects/order', body: { subjectIds: [SUBJECT_IDS[1], SUBJECT_IDS[0], SUBJECT_IDS[2]] } }]))
    await waitFor(() => expect(codesOnScreen()).toEqual(['MATH', 'PROG', 'ART']))
    expect(await screen.findByText(sub.reordered)).toBeInTheDocument()
  })

  it('deletes an unused subject after confirmation and drops its row', async () => {
    const { calls } = mockSubjectsApi(THREE_SUBJECTS(), () => jsonResponse(204))
    renderManager()
    await screen.findByText('MATH')

    fireEvent.click(screen.getByLabelText(`${sub.delete}: MATH`))
    const popup = (await screen.findByText('حذف المادة «الرياضيات» نهائياً؟')).closest('.ant-popover') as HTMLElement
    fireEvent.click(within(popup).getByText(sub.delete).closest('button')!)

    await waitFor(() => expect(screen.queryByText('MATH')).not.toBeInTheDocument())
    expect(writesOf(calls)).toEqual([{ method: 'DELETE', url: `/api/subjects/${SUBJECT_IDS[1]}`, body: undefined }])
    expect(await screen.findByText(sub.deleted)).toBeInTheDocument()
  })

  it('shows the subject_in_use refusal with its count when the local count was stale, then reloads the list', async () => {
    const { calls, state } = mockSubjectsApi(THREE_SUBJECTS(), () => jsonResponse(409, { statusCode: 409, code: 'subject_in_use', courseCount: 2, message: 'in use' }))
    renderManager()
    await screen.findByText('MATH')
    state.current = THREE_SUBJECTS().map((subject) => (subject.code === 'MATH' ? { ...subject, courseCount: 2 } : subject))

    fireEvent.click(screen.getByLabelText(`${sub.delete}: MATH`))
    const popup = (await screen.findByText('حذف المادة «الرياضيات» نهائياً؟')).closest('.ant-popover') as HTMLElement
    fireEvent.click(within(popup).getByText(sub.delete).closest('button')!)

    // The count in its Arabic plural form: 2 → «دورتان».
    expect(await screen.findByText('لا تُحذف هذه المادة: تستخدمها دورتان. عطّلها بدلاً من ذلك.')).toBeInTheDocument()
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2))
    await waitFor(() => expect(screen.getByLabelText(`${sub.delete}: MATH`)).toBeDisabled())
  })
})
