import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Syllabus } from '../api/syllabus'
import { ar } from '../i18n/ar'
import { COURSE_ID, COURSE_MANAGER_PERMISSIONS, COURSE_READER_PERMISSIONS, SYLLABUS_ITEM_IDS, THREE_ITEMS, makeSyllabus, makeSyllabusItem } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { SyllabusTab } from './SyllabusTab'

interface Call {
  method: string
  body: unknown
}

/** GET serves `state.current`; PUT answers with `put(body)`. */
function mockSyllabusApi(initial: Syllabus, put: (body: unknown) => Response = () => jsonResponse(500, {})) {
  const state = { current: initial }
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, body })
    expect(url).toBe(`/api/courses/${COURSE_ID}/syllabus`)
    return method === 'GET' ? jsonResponse(200, state.current) : put(body)
  })
  return { calls, state }
}

function renderTab(canManage: boolean) {
  renderWithProviders(<SyllabusTab courseId={COURSE_ID} canManage={canManage} />, {
    auth: makeAuth({ user: makeUser({ permissions: canManage ? COURSE_MANAGER_PERMISSIONS : COURSE_READER_PERMISSIONS }) }),
    route: '/courses',
  })
}

const puts = (calls: Call[]) => calls.filter((call) => call.method === 'PUT')
const editorCards = () => screen.getAllByTestId('syllabus-item-editor')

async function startEditing() {
  fireEvent.click((await screen.findByText(ar.courses.syllabus.edit)).closest('button')!)
  await screen.findAllByTestId('syllabus-item-editor')
}

describe('SyllabusTab (MOD-04-T06)', () => {
  it('shows a reader the ordered items with description and estimate, the total, and no edit button (AC3)', async () => {
    mockSyllabusApi(makeSyllabus())
    renderTab(false)

    expect(await screen.findByText('3 بند · 105 دقيقة تقديرياً')).toBeInTheDocument()
    const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows.map((row) => row.textContent)).toEqual(['1المتغيرات45 دقيقة', '2الشروطif و else60 دقيقة', '3الحلقات—'])
    expect(screen.queryByText(ar.courses.syllabus.edit)).not.toBeInTheDocument()
  })

  it('tells a manager how to start an empty syllabus', async () => {
    mockSyllabusApi(makeSyllabus([]))
    renderTab(true)
    expect(await screen.findByText(ar.courses.syllabus.emptyManager)).toBeInTheDocument()
  })

  it('saves edits, moves, removals and a new item in ONE PUT with the complete ordered list, then shows the server answer (AC1)', async () => {
    const answer = makeSyllabus([
      makeSyllabusItem({ id: SYLLABUS_ITEM_IDS[2], title: { ar: 'الحلقات', en: 'Loops', tr: 'Döngüler' }, estimatedMinutes: null }),
      makeSyllabusItem({ id: SYLLABUS_ITEM_IDS[1], sortOrder: 1, title: { ar: 'الشروط المتقدمة' }, estimatedMinutes: 60 }),
      makeSyllabusItem({ id: '0193a000-0000-7000-8000-00000000d009', sortOrder: 2, title: { ar: 'الدوال' }, estimatedMinutes: 30 }),
    ])
    const { calls } = mockSyllabusApi(makeSyllabus(), () => jsonResponse(200, answer))
    renderTab(true)
    await startEditing()

    // Rename item 2, drop its description, move item 3 to the top, remove «المتغيرات», add «الدوال» (30 min).
    const title2 = within(editorCards()[1]!).getByLabelText(ar.courses.syllabus.fields.titleAr)
    await userEvent.clear(title2)
    await userEvent.type(title2, 'الشروط المتقدمة')
    await userEvent.clear(within(editorCards()[1]!).getByLabelText(ar.courses.syllabus.fields.descriptionAr))
    fireEvent.click(screen.getByLabelText(`${ar.courses.syllabus.moveUp} 3`))
    fireEvent.click(screen.getByLabelText(`${ar.courses.syllabus.moveUp} 2`))
    fireEvent.click(screen.getByLabelText(`${ar.courses.syllabus.remove} 2`))
    fireEvent.click(screen.getByText(ar.courses.syllabus.add).closest('button')!)
    const added = editorCards()[2]!
    await userEvent.type(within(added).getByLabelText(ar.courses.syllabus.fields.titleAr), 'الدوال')
    await userEvent.type(within(added).getByLabelText(ar.courses.syllabus.fields.estimatedMinutes), '30')
    fireEvent.click(screen.getByText(ar.courses.syllabus.save).closest('button')!)

    expect(await screen.findByText(ar.courses.syllabus.saved)).toBeInTheDocument()
    expect(puts(calls)).toEqual([
      {
        method: 'PUT',
        body: {
          items: [
            { id: SYLLABUS_ITEM_IDS[2], title: { ar: 'الحلقات', en: 'Loops', tr: 'Döngüler' } },
            { id: SYLLABUS_ITEM_IDS[1], title: { ar: 'الشروط المتقدمة' }, estimatedMinutes: 60 },
            { title: { ar: 'الدوال' }, estimatedMinutes: 30 },
          ],
        },
      },
    ])
    expect(screen.getByText('الدوال')).toBeInTheDocument()
    expect(screen.queryByTestId('syllabus-item-editor')).not.toBeInTheDocument()
  })

  it('sends nothing when the list did not change, and refuses locally an item without an Arabic title', async () => {
    const { calls } = mockSyllabusApi(makeSyllabus())
    renderTab(true)
    await startEditing()
    fireEvent.click(screen.getByText(ar.courses.syllabus.save).closest('button')!)
    expect(await screen.findByText(ar.courses.syllabus.nothingChanged)).toBeInTheDocument()

    await startEditing()
    fireEvent.click(screen.getByText(ar.courses.syllabus.add).closest('button')!)
    await userEvent.type(within(editorCards()[3]!).getByLabelText(ar.courses.syllabus.fields.titleEn), 'English only')
    fireEvent.click(screen.getByText(ar.courses.syllabus.save).closest('button')!)
    expect(await screen.findByText(ar.courses.syllabus.validation.titleArRequired)).toBeInTheDocument()
    expect(puts(calls)).toEqual([])
  })

  it('starts every edit session from the stored syllabus (a cancelled session leaves nothing behind)', async () => {
    mockSyllabusApi(makeSyllabus())
    renderTab(true)
    await startEditing()
    const title = within(editorCards()[0]!).getByLabelText(ar.courses.syllabus.fields.titleAr)
    await userEvent.clear(title)
    await userEvent.type(title, 'مسودة لم تُحفظ')
    fireEvent.click(screen.getByText(ar.common.cancel).closest('button')!)

    await startEditing()
    expect(within(editorCards()[0]!).getByLabelText(ar.courses.syllabus.fields.titleAr)).toHaveValue('المتغيرات')
    expect(editorCards()).toHaveLength(3)
  })

  it('reloads the syllabus and leaves the editor when the server answers syllabus_invalid (changed elsewhere)', async () => {
    const { calls, state } = mockSyllabusApi(makeSyllabus(), () =>
      jsonResponse(400, { statusCode: 400, code: 'syllabus_invalid', unknown: [SYLLABUS_ITEM_IDS[0]], duplicates: [], message: 'invalid' }),
    )
    renderTab(true)
    await startEditing()
    state.current = makeSyllabus(THREE_ITEMS().slice(1))
    fireEvent.click(screen.getByLabelText(`${ar.courses.syllabus.moveDown} 1`))
    fireEvent.click(screen.getByText(ar.courses.syllabus.save).closest('button')!)

    expect(await screen.findByText(ar.courses.errors.syllabus_invalid)).toBeInTheDocument()
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2))
    expect(await screen.findByText('2 بند · 60 دقيقة تقديرياً')).toBeInTheDocument()
    expect(screen.queryByTestId('syllabus-item-editor')).not.toBeInTheDocument()
  })

  it('words the length limit of an item title in its own message and sends nothing (J-F23)', async () => {
    const { calls } = mockSyllabusApi(makeSyllabus())
    renderTab(true)
    await startEditing()
    fireEvent.change(within(editorCards()[0]!).getByLabelText(ar.courses.syllabus.fields.titleAr), { target: { value: 'ع'.repeat(201) } })
    fireEvent.click(screen.getByText(ar.courses.syllabus.save).closest('button')!)

    expect(await within(editorCards()[0]!).findByText('الحد الأقصى 200 حرفاً')).toBeInTheDocument()
    expect(puts(calls)).toEqual([])
  })
})
