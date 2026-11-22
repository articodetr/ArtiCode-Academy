import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Course } from '../api/courses'
import { ar } from '../i18n/ar'
import { COURSE_ID, COURSE_MANAGER_PERMISSIONS, COURSE_READER_PERMISSIONS, makeCourse, makeLevel } from '../test/courses'
import { makeCurriculum } from '../test/curriculum'
import { jsonResponse, mockFetch } from '../test/http'
import { makeFeePlan } from '../test/payments'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CourseDrawer } from './CourseDrawer'

interface Call {
  method: string
  url: string
  body: unknown
}

/** GET returns `detail()` (re-read on every call), writes answer with `writes[method]`. */
function mockCourseApi(detail: () => Course, writes: Partial<Record<string, Response>> = {}) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET') return jsonResponse(200, url.endsWith('/curriculum') ? makeCurriculum() : detail())
    return writes[method] ?? jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

function renderDrawer(permissions: string[]) {
  const onUpdated = vi.fn()
  const onDeleted = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<CourseDrawer courseId={COURSE_ID} levels={[makeLevel()]} onClose={onClose} onUpdated={onUpdated} onDeleted={onDeleted} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/courses',
  })
  return { onUpdated, onDeleted, onClose }
}

async function chooseAction(label: string) {
  fireEvent.click(screen.getByText(ar.courses.actions.menu).closest('button')!)
  fireEvent.click(await screen.findByText(label, { selector: '.ant-dropdown-menu-title-content' }))
}

function confirmDialog(hint: string): HTMLElement {
  return screen.getByText(hint).closest('[role="dialog"]') as HTMLElement
}

describe('CourseDrawer', () => {
  it('shows a reader the course read-only: details, no edit button, no actions menu', async () => {
    mockCourseApi(() => makeCourse({ status: 'published', summary: { ar: 'ملخص الدورة' } }))
    renderDrawer(COURSE_READER_PERMISSIONS)

    expect(await screen.findByText('ملخص الدورة')).toBeInTheDocument()
    expect(screen.getByText('PY-101')).toBeInTheDocument()
    expect(screen.getByText('مبتدئ (BEG)')).toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.courses.actions.menu)).not.toBeInTheDocument()
  })

  it('edits with the smallest PATCH and hands the saved course back', async () => {
    let current = makeCourse()
    const calls = mockCourseApi(() => current, { PATCH: jsonResponse(200, makeCourse({ name: { ar: 'أساسيات بايثون', en: 'Python 3' }, updatedAt: '2026-11-02T10:00:00.000Z' })) })
    const { onUpdated } = renderDrawer(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    const english = await screen.findByLabelText(ar.courses.fields.nameEn)
    await userEvent.clear(english)
    await userEvent.type(english, 'Python 3')
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1))
    expect(calls.filter((call) => call.method === 'PATCH')).toEqual([
      { method: 'PATCH', url: `/api/courses/${COURSE_ID}`, body: { name: { ar: 'أساسيات بايثون', en: 'Python 3' } } },
    ])
    current = onUpdated.mock.calls[0]![0] as Course
    expect(await screen.findByText(ar.courses.drawer.saved)).toBeInTheDocument()
  })

  it('saves nothing and sends nothing when the form did not change', async () => {
    const calls = mockCourseApi(() => makeCourse())
    renderDrawer(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')
    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    fireEvent.click((await screen.findByText(ar.common.save)).closest('button')!)
    expect(await screen.findByText(ar.courses.drawer.nothingChanged)).toBeInTheDocument()
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('publishes a draft after confirmation (POST …/status) and offers only the allowed actions', async () => {
    const calls = mockCourseApi(() => makeCourse(), { POST: jsonResponse(200, makeCourse({ status: 'published' })) })
    const { onUpdated } = renderDrawer(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.courses.actions.menu).closest('button')!)
    expect(await screen.findByText(ar.courses.actions.publish, { selector: '.ant-dropdown-menu-title-content' })).toBeInTheDocument()
    expect(screen.getByText(ar.courses.actions.delete, { selector: '.ant-dropdown-menu-title-content' })).toBeInTheDocument()
    expect(screen.queryByText(ar.courses.actions.restore, { selector: '.ant-dropdown-menu-title-content' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.courses.actions.publish, { selector: '.ant-dropdown-menu-title-content' }))

    const dialog = confirmDialog(ar.courses.confirm.publish)
    fireEvent.click(within(dialog).getByText(ar.courses.actions.publish).closest('button')!)
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' })))
    expect(calls.filter((call) => call.method === 'POST')).toEqual([{ method: 'POST', url: `/api/courses/${COURSE_ID}/status`, body: { action: 'publish' } }])
  })

  it('deletes a draft after confirmation (DELETE) and reports it', async () => {
    const calls = mockCourseApi(() => makeCourse(), { DELETE: jsonResponse(204) })
    const { onDeleted, onClose } = renderDrawer(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    await chooseAction(ar.courses.actions.delete)
    const dialog = confirmDialog(ar.courses.confirm.delete)
    fireEvent.click(within(dialog).getByText(ar.courses.actions.delete).closest('button')!)
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(COURSE_ID))
    expect(onClose).toHaveBeenCalled()
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1)
  })

  it('reloads the course when the server answers invalid_transition (changed elsewhere)', async () => {
    let status: Course['status'] = 'draft'
    const calls = mockCourseApi(() => makeCourse({ status }), {
      POST: jsonResponse(409, { statusCode: 409, code: 'invalid_transition', from: 'archived', action: 'publish', allowed: ['restore'], message: 'no' }),
    })
    renderDrawer(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    await chooseAction(ar.courses.actions.publish)
    status = 'archived'
    const dialog = confirmDialog(ar.courses.confirm.publish)
    fireEvent.click(within(dialog).getByText(ar.courses.actions.publish).closest('button')!)
    expect(await within(dialog).findByText(ar.courses.errors.invalid_transition)).toBeInTheDocument()
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2))
  })

  it('starts every edit session from the stored course: a cancelled session leaves nothing behind (CH-0049)', async () => {
    mockCourseApi(() => makeCourse())
    renderDrawer(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    const english = await screen.findByLabelText(ar.courses.fields.nameEn)
    await userEvent.clear(english)
    await userEvent.type(english, 'Unsaved draft')
    fireEvent.click(screen.getByText(ar.common.cancel).closest('button')!)

    fireEvent.click((await screen.findByText(ar.common.edit)).closest('button')!)
    expect(await screen.findByLabelText(ar.courses.fields.nameEn)).toHaveValue('Python Basics')
  })

  it('shows the curriculum tab (MOD-20): its levels and lessons, read-only for a teacher of the course (canManage false), read only once it opens', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      return jsonResponse(200, url.endsWith('/curriculum') ? makeCurriculum({ canManage: false }) : makeCourse({ status: 'published' }))
    })
    renderDrawer(COURSE_READER_PERMISSIONS)
    await screen.findByText('PY-101')
    expect(urls).toEqual([`/api/courses/${COURSE_ID}`])

    fireEvent.click(screen.getByRole('tab', { name: ar.curriculum.tab }))
    expect(await screen.findByText('الشروط')).toBeInTheDocument()
    expect(screen.getByText(ar.curriculum.readOnly)).toBeInTheDocument()
    expect(screen.queryByText(ar.curriculum.save)).not.toBeInTheDocument()
    expect(urls).toEqual([`/api/courses/${COURSE_ID}`, `/api/courses/${COURSE_ID}/curriculum`])
  })

  it('words the length limit of a text field in its own message, not antd default text, and sends nothing (J-F23)', async () => {
    const calls = mockCourseApi(() => makeCourse())
    renderDrawer(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')
    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    fireEvent.change(await screen.findByLabelText(ar.courses.fields.summaryAr), { target: { value: 'م'.repeat(201) } })
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)

    expect(await screen.findByText('الحد الأقصى 200 حرفاً')).toBeInTheDocument()
    expect(ar.courses.validation.maxLength.replace('{{max}}', '200')).toBe('الحد الأقصى 200 حرفاً')
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })
})

describe('CourseDrawer — cover and price (MOD-19)', () => {
  const plan = makeFeePlan({ id: 'plan-1', name: { ar: 'رسوم الدورة الكاملة' }, total: 1000 })
  const classPlan = makeFeePlan({ id: 'plan-class', name: { ar: 'خطة فصل' }, class: { id: 'cls', code: 'PY-101-A', name: { ar: 'فصل' } } })

  /** As mockCourseApi, plus the fee plans of API-140. */
  function mockPricingApi(detail: () => Course, patch?: Response) {
    const calls: Call[] = []
    mockFetch((url, init) => {
      const method = init?.method ?? 'GET'
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (method === 'GET' && url.startsWith('/api/fee-plans')) return jsonResponse(200, { items: [plan, classPlan] })
      if (method === 'GET') return jsonResponse(200, url.endsWith('/curriculum') ? makeCurriculum() : detail())
      return patch ?? jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    })
    return calls
  }

  it('shows the price and the cover read-only, and keeps the price out of the form without fee_plans.manage', async () => {
    const calls = mockPricingApi(() =>
      makeCourse({ pricing: 'paid', coverImageUrl: 'https://cdn.example.org/py.jpg', enrollmentFeePlan: { id: 'plan-1', name: { ar: 'رسوم الدورة الكاملة' }, isActive: false, total: 1000, currency: 'SAR', installments: 2 } }),
    )
    renderDrawer(COURSE_MANAGER_PERMISSIONS)
    expect(await screen.findByText('رسوم الدورة الكاملة')).toBeInTheDocument()
    expect(screen.getByText(ar.courses.pricing.paid)).toBeInTheDocument()
    expect(screen.getByText('https://cdn.example.org/py.jpg')).toBeInTheDocument()
    expect(screen.getByText(ar.courses.pricing.planInactive)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    expect(await screen.findByText(ar.courses.hints.pricingReadOnly)).toBeInTheDocument()
    expect(screen.queryByText(ar.courses.fields.pricing, { selector: 'label' })).toBeNull()
    expect(calls.some((call) => call.url.startsWith('/api/fee-plans'))).toBe(false)
  })

  it('prices a free course with a fitting plan in the smallest PATCH, and refuses a bad cover URL before sending', async () => {
    const saved = makeCourse({ pricing: 'paid', enrollmentFeePlan: { id: 'plan-1', name: plan.name, isActive: true, total: 1000, currency: 'SAR', installments: 2 }, updatedAt: '2026-11-19T10:00:00.000Z' })
    const calls = mockPricingApi(() => makeCourse(), jsonResponse(200, saved))
    const { onUpdated } = renderDrawer([...COURSE_MANAGER_PERMISSIONS, 'fee_plans.manage'])
    await screen.findByText('PY-101')
    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)

    const cover = await screen.findByLabelText(ar.courses.fields.coverImageUrl)
    fireEvent.change(cover, { target: { value: 'cdn.example.org/py.jpg' } })
    fireEvent.click(screen.getByText(ar.courses.pricing.paid))
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.courses.validation.coverUrl)).toBeInTheDocument()
    expect(await screen.findByText(ar.courses.validation.feePlanRequired)).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0)

    fireEvent.change(cover, { target: { value: '' } })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.courses.fields.feePlan }))
    // The class plan does not fit a course and is not offered.
    await waitFor(() => expect(document.querySelectorAll('.ant-select-item-option')).toHaveLength(1))
    fireEvent.click(screen.getByText(/رسوم الدورة الكاملة/, { selector: '.ant-select-item-option-content' }))
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(saved))
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([{ enrollmentFeePlanId: 'plan-1' }])
  })

  it('says why no plan fits when the only plan prices one class, and names it (PORTAL-04)', async () => {
    mockFetch((url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url.startsWith('/api/fee-plans')) return jsonResponse(200, { items: [classPlan] })
      if (method === 'GET') return jsonResponse(200, url.endsWith('/curriculum') ? makeCurriculum() : makeCourse())
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    })
    renderDrawer([...COURSE_MANAGER_PERMISSIONS, 'fee_plans.manage'])
    await screen.findByText('PY-101')
    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    fireEvent.click(await screen.findByText(ar.courses.pricing.paid))

    const warning = await screen.findByTestId('course-no-fee-plans')
    expect(warning).toHaveTextContent(ar.courses.hints.noFeePlans)
    // The plan made for one class is recognised — and still not offered.
    expect(warning).toHaveTextContent('خطط مرتبطة بفصل واحد ولا تصلح رسوماً للدورة: «خطة فصل» (PY-101-A).')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.courses.fields.feePlan }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(document.querySelectorAll('.ant-select-item-option')).toHaveLength(0)
  })
})
