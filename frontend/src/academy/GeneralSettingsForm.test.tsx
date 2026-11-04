import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Academy, AcademySettings } from '../api/academy'
import { ar } from '../i18n/ar'
import { SETTINGS_MANAGER_PERMISSIONS, SETTINGS_READER_PERMISSIONS, makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { GeneralSettingsForm } from './GeneralSettingsForm'

interface Options {
  academy?: Academy | Response
  /** Answers PATCH; default: echoes the academy merged with the body and a newer updatedAt. */
  write?: (body: Record<string, unknown>) => Response
}

/** Serves GET /api/academy and records every PATCH body. */
function mockAcademyApi({ academy = makeAcademy(), write }: Options = {}) {
  const writes: Record<string, unknown>[] = []
  let gets = 0
  const fetchMock = mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (url !== '/api/academy') return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
    if (method === 'GET') {
      gets += 1
      return academy instanceof Response ? academy : jsonResponse(200, academy)
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    writes.push(body)
    if (write) return write(body)
    const base = academy instanceof Response ? makeAcademy() : academy
    const settings = mergeSettings(base.settings, body.settings as { scheduling?: Record<string, unknown> } | undefined)
    return jsonResponse(200, { ...base, ...body, settings, updatedAt: '2026-10-31T10:00:00.000Z' })
  })
  return { writes, fetchMock, gets: () => gets }
}

/** What the server does with `settings` of a PATCH: key by key, `null` clears (days already sorted by the form). */
function mergeSettings(current: AcademySettings, patch: { scheduling?: Record<string, unknown> } | undefined): AcademySettings {
  return { scheduling: { ...current.scheduling, ...(patch?.scheduling ?? {}) } as AcademySettings['scheduling'] }
}

/** The Form.Item whose label has that text (the select shows its value inside it). */
const fieldOf = (label: string) => screen.getByText(label).closest('.ant-form-item') as HTMLElement

/** Opens an antd Select and clicks the option with that text (the options live in a portal). */
function pickOption(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  const item = [...document.querySelectorAll('.ant-select-item-option-content')].find((node) => node.textContent === option)
  if (!item) throw new Error(`option ${option} not found`)
  fireEvent.click(item)
}

/** A working-day checkbox, looked up inside its own field (the select's options carry the same day names). */
const dayBox = (name: string) => within(fieldOf(ar.settings.scheduling.workingDays)).getByLabelText(name) as HTMLInputElement
const checkedDays = () =>
  Object.values(ar.settings.weekdays).filter((name) => dayBox(name).checked)
const dayOrder = () => [...fieldOf(ar.settings.scheduling.workingDays).querySelectorAll('.ant-checkbox-wrapper')].map((node) => node.textContent)

function renderForm(permissions: string[] = SETTINGS_MANAGER_PERMISSIONS) {
  return renderWithProviders(<GeneralSettingsForm />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/settings' })
}

const saveButton = () => screen.getByText(ar.common.save).closest('button') as HTMLElement

// Plain DOM events on the inputs: these flows exercise state and requests, not pointer semantics.
describe('GeneralSettingsForm', () => {
  it('loads GET /api/academy and shows the server values in the form (AC1)', async () => {
    const api = mockAcademyApi()
    renderForm()

    expect(await screen.findByLabelText(ar.settings.academyNameAr)).toHaveValue('أكاديمية آرتي كود')
    expect(screen.getByLabelText(ar.settings.academyNameEn)).toHaveValue('ArtiCode Academy')
    expect(screen.getByLabelText(ar.settings.slug)).toHaveValue('articode')
    expect(screen.getByLabelText(ar.settings.timezone)).toHaveValue('Asia/Riyadh')
    expect(screen.getByLabelText(ar.settings.currency)).toHaveValue('SAR')
    expect(screen.getByLabelText(ar.settings.contactEmail)).toHaveValue('info@articode.test')
    expect(screen.getByLabelText(ar.settings.contactPhone)).toHaveValue('')
    expect(screen.getByText(/آخر تعديل:/)).toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
    expect(api.gets()).toBe(1)
    expect(api.writes).toEqual([])
  })

  it('shows the fields read-only without a save button to a viewer lacking academy.settings.manage (AC2)', async () => {
    mockAcademyApi()
    renderForm(SETTINGS_READER_PERMISSIONS)

    expect(await screen.findByLabelText(ar.settings.academyNameAr)).toBeDisabled()
    expect(screen.getByText(ar.settings.readOnlyHint)).toBeInTheDocument()
    expect(screen.getByLabelText(ar.settings.currency)).toBeDisabled()
    expect(screen.queryByText(ar.common.save)).not.toBeInTheDocument()
  })

  it('saves nothing and says so when the form still holds the loaded values (AC3)', async () => {
    const api = mockAcademyApi()
    renderForm()

    await screen.findByLabelText(ar.settings.academyNameAr)
    fireEvent.click(saveButton())

    expect(await screen.findByText(ar.settings.nothingChanged)).toBeInTheDocument()
    expect(api.writes).toEqual([])
  })

  it('sends the smallest PATCH (whole name, upper-cased currency, null for a cleared field) and shows the response (AC4)', async () => {
    const api = mockAcademyApi()
    renderForm()

    const nameEn = await screen.findByLabelText(ar.settings.academyNameEn)
    fireEvent.change(nameEn, { target: { value: 'ArtiCode' } })
    fireEvent.change(screen.getByLabelText(ar.settings.currency), { target: { value: 'try' } })
    fireEvent.change(screen.getByLabelText(ar.settings.contactEmail), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(ar.settings.contactPhone), { target: { value: '+966500000000' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({
      name: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode' },
      currency: 'TRY',
      contactEmail: null,
      contactPhone: '+966500000000',
    })
    expect(await screen.findByText(ar.settings.saved)).toBeInTheDocument()
    // The remounted form shows what the server returned.
    await waitFor(() => expect(screen.getByLabelText(ar.settings.currency)).toHaveValue('TRY'))
    expect(screen.getByLabelText(ar.settings.contactEmail)).toHaveValue('')
    expect(api.gets()).toBe(1)
  })

  it('refuses an unknown time zone and a non-ISO currency locally, before any request (AC6)', async () => {
    const api = mockAcademyApi()
    renderForm()

    const timezone = await screen.findByLabelText(ar.settings.timezone)
    await userEvent.clear(timezone)
    await userEvent.type(timezone, 'Mars/Olympus')
    fireEvent.change(screen.getByLabelText(ar.settings.currency), { target: { value: 'S4' } })
    fireEvent.click(saveButton())

    expect(await screen.findByText(ar.settings.validation.timezone)).toBeInTheDocument()
    expect(await screen.findByText(ar.settings.validation.currency)).toBeInTheDocument()
    expect(api.writes).toEqual([])
  })

  it('shows the server code of a refused save (403) and keeps the edited values (AC5)', async () => {
    const api = mockAcademyApi({
      write: () => jsonResponse(403, { statusCode: 403, error: 'Forbidden', code: 'permission_denied', message: 'denied', missing: ['academy.settings.manage'] }),
    })
    renderForm()

    const nameEn = await screen.findByLabelText(ar.settings.academyNameEn)
    fireEvent.change(nameEn, { target: { value: 'Renamed' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(await screen.findByText('ليست لديك الصلاحية اللازمة لهذا الإجراء (academy.settings.manage)')).toBeInTheDocument()
    expect(screen.getByLabelText(ar.settings.academyNameEn)).toHaveValue('Renamed')
  })

  it('shows the load failure by its code with a retry button that re-reads the academy (AC1/AC5)', async () => {
    let attempt = 0
    const academy = makeAcademy()
    mockFetch(() => {
      attempt += 1
      return attempt === 1
        ? jsonResponse(503, { statusCode: 503, error: 'Service Unavailable', code: 'academy_not_configured', message: 'seed' })
        : jsonResponse(200, academy)
    })
    renderForm()

    expect(await screen.findByText(ar.settings.loadFailed)).toBeInTheDocument()
    expect(screen.getByText(ar.settings.errors.academy_not_configured)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.settings.academyNameAr)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.settings.retry).closest('button') as HTMLElement)
    expect(await screen.findByLabelText(ar.settings.academyNameAr)).toHaveValue('أكاديمية آرتي كود')
    expect(screen.queryByText(ar.settings.loadFailed)).not.toBeInTheDocument()
    expect(attempt).toBe(2)
  })
})

describe('GeneralSettingsForm — weekly schedule (J-F02)', () => {
  const { sun, mon, tue, wed, thu, fri, sat } = ar.settings.weekdays

  it('shows the stored first day in the select and the working days checked, ordered from that first day', async () => {
    mockAcademyApi({ academy: makeAcademy({ settings: { scheduling: { weekStartsOn: 6, workingDays: [0, 1, 2, 3, 4] } } }) })
    renderForm()

    await screen.findByLabelText(ar.settings.academyNameAr)
    expect(within(fieldOf(ar.settings.scheduling.weekStartsOn)).getByText(sat)).toBeInTheDocument()
    expect(checkedDays()).toEqual([sun, mon, tue, wed, thu])
    expect(dayOrder()).toEqual([sat, sun, mon, tue, wed, thu, fri])
  })

  it('saves both keys in one PATCH under settings.scheduling (days sorted) and shows what the server returned', async () => {
    const api = mockAcademyApi()
    renderForm()

    await screen.findByLabelText(ar.settings.academyNameAr)
    expect(within(fieldOf(ar.settings.scheduling.weekStartsOn)).getByText(ar.settings.scheduling.notSet)).toBeInTheDocument()
    expect(checkedDays()).toEqual([])
    expect(dayOrder()[0]).toBe(sun)

    pickOption(ar.settings.scheduling.weekStartsOn, sat)
    await waitFor(() => expect(dayOrder()[0]).toBe(sat))
    for (const day of [thu, sun, mon]) fireEvent.click(dayBox(day))
    fireEvent.click(saveButton())

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({ settings: { scheduling: { weekStartsOn: 6, workingDays: [0, 1, 4] } } })
    expect(await screen.findByText(ar.settings.saved)).toBeInTheDocument()
    // The remounted form shows the saved schedule.
    await waitFor(() => expect(checkedDays()).toEqual([sun, mon, thu]))
    expect(dayOrder()[0]).toBe(sat)
    expect(api.gets()).toBe(1)
  })

  it('clears the working days with null when every day is unchecked, and leaves the first day out of the body', async () => {
    const api = mockAcademyApi({ academy: makeAcademy({ settings: { scheduling: { weekStartsOn: 0, workingDays: [0, 1] } } }) })
    renderForm()

    await screen.findByLabelText(ar.settings.academyNameAr)
    fireEvent.click(dayBox(sun))
    fireEvent.click(dayBox(mon))
    fireEvent.click(saveButton())

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({ settings: { scheduling: { workingDays: null } } })
  })

  it('shows the schedule read-only to a viewer without academy.settings.manage', async () => {
    mockAcademyApi({ academy: makeAcademy({ settings: { scheduling: { weekStartsOn: 6, workingDays: [0] } } }) })
    renderForm(SETTINGS_READER_PERMISSIONS)

    await screen.findByLabelText(ar.settings.academyNameAr)
    expect(dayBox(sun)).toBeChecked()
    expect(dayBox(sun)).toBeDisabled()
    expect(dayBox(sat)).toBeDisabled()
    expect(screen.getByLabelText(ar.settings.scheduling.weekStartsOn)).toBeDisabled()
  })
})
