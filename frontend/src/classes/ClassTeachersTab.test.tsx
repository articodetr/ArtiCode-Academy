import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AcademyClass } from '../api/classes'
import { ar } from '../i18n/ar'
import { CLASS_ADMIN_PERMISSIONS, CLASS_ID, CLASS_MANAGER_PERMISSIONS, TEACHER_IDS, makeClass, makeClassTeacher, makeTeacherCandidate } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeUserList } from '../test/users'
import { ClassTeachersTab } from './ClassTeachersTab'

const mona = makeTeacherCandidate()
const suspended = makeTeacherCandidate({ id: TEACHER_IDS[2], fullName: 'سامي الموقوف', status: 'suspended' })
const khaled = makeTeacherCandidate({ id: TEACHER_IDS[0], fullName: 'خالد المعلم' })

/** The teacher search answers with Mona, Sami (suspended) and Khaled (already the lead); PUT answers with `put`. */
function mockTeachersApi(put: Response = jsonResponse(200, makeClass())) {
  const puts: unknown[] = []
  const searches: URLSearchParams[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/users') {
      searches.push(parsed.searchParams)
      return jsonResponse(200, makeUserList([mona, suspended, khaled]))
    }
    if (init?.method === 'PUT') {
      puts.push({ url, body: JSON.parse(String(init.body)) })
      return put
    }
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return { puts, searches }
}

function renderTab(permissions: string[], cls: AcademyClass = makeClass()) {
  const onUpdated = vi.fn()
  renderWithProviders(<ClassTeachersTab cls={cls} onUpdated={onUpdated} />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/classes' })
  return { onUpdated }
}

async function openSearch() {
  fireEvent.click(screen.getByText(ar.classes.teachers.edit).closest('button')!)
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: ar.classes.teachers.add }))
}

function option(name: string): HTMLElement {
  return screen.getByText(name, { selector: '.ant-select-item-option-content' }).closest('.ant-select-item-option') as HTMLElement
}

/** Holds the class as ClassDrawer does: after a save the tab shows what the server returned. */
function StatefulTab({ initial }: { initial: AcademyClass }) {
  const [cls, setCls] = useState(initial)
  return <ClassTeachersTab cls={cls} onUpdated={setCls} />
}

describe('ClassTeachersTab', () => {
  it('lists the teachers lead first for everyone; only classes.teachers.assign gets the edit button', async () => {
    renderTab(CLASS_MANAGER_PERMISSIONS, makeClass({ teachers: [makeClassTeacher(), makeClassTeacher({ userId: TEACHER_IDS[1], fullName: 'منى المساعدة', role: 'assistant' })] }))
    expect(screen.getByText('خالد المعلم')).toBeInTheDocument()
    expect(screen.getByText(ar.classes.teacherRoles.lead)).toBeInTheDocument()
    expect(screen.getByText(ar.classes.teacherRoles.assistant)).toBeInTheDocument()
    expect(screen.queryByText(ar.classes.teachers.edit)).not.toBeInTheDocument()
  })

  it('disables the edit button and explains why when the assigner cannot search users', () => {
    renderTab(['classes.read', 'classes.teachers.assign'])
    expect(screen.getByText(ar.classes.teachers.edit).closest('button')).toBeDisabled()
    expect(screen.getByText(ar.classes.teachers.searchNeedsUsersRead)).toBeInTheDocument()
  })

  it('adds a teacher found by the search as an assistant and saves the whole list in ONE PUT', async () => {
    const api = mockTeachersApi(jsonResponse(200, makeClass({ teachers: [makeClassTeacher(), makeClassTeacher({ userId: mona.id, fullName: mona.fullName, role: 'assistant' })] })))
    const { onUpdated } = renderTab(CLASS_ADMIN_PERMISSIONS)

    await openSearch()
    await waitFor(() => expect(option('منى المساعدة')).toBeInTheDocument())
    expect(Object.fromEntries(api.searches[0]!)).toEqual({ role: 'teacher', limit: '10' })
    // Mirrors of the server rules: an ineligible account and the current lead are offered disabled.
    expect(option('سامي الموقوف')).toHaveClass('ant-select-item-option-disabled')
    expect(option('خالد المعلم')).toHaveClass('ant-select-item-option-disabled')
    fireEvent.click(screen.getByText('منى المساعدة', { selector: '.ant-select-item-option-content' }))

    expect(await screen.findByRole('combobox', { name: `${ar.classes.teachers.role}: منى المساعدة` })).toBeInTheDocument()
    // The search starts empty again for the next teacher.
    expect(screen.getByText(ar.classes.teachers.searchPlaceholder)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.classes.teachers.save).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1))
    expect(api.puts).toEqual([
      {
        url: `/api/classes/${CLASS_ID}/teachers`,
        body: {
          teachers: [
            { userId: TEACHER_IDS[0], role: 'lead' },
            { userId: mona.id, role: 'assistant' },
          ],
        },
      },
    ])
    expect(await screen.findByText(ar.classes.teachers.saved)).toBeInTheDocument()
  })

  it('blocks saving with two leads, and sends nothing when the list did not change', async () => {
    const api = mockTeachersApi()
    renderTab(CLASS_ADMIN_PERMISSIONS, makeClass({ teachers: [makeClassTeacher(), makeClassTeacher({ userId: mona.id, fullName: mona.fullName, role: 'assistant' })] }))

    fireEvent.click(screen.getByText(ar.classes.teachers.edit).closest('button')!)
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: `${ar.classes.teachers.role}: منى المساعدة` }))
    fireEvent.click(await screen.findByText(ar.classes.teacherRoles.lead, { selector: '.ant-select-item-option-content' }))
    expect(await screen.findByText(ar.classes.teachers.oneLead)).toBeInTheDocument()
    expect(screen.getByText(ar.classes.teachers.save).closest('button')).toBeDisabled()

    fireEvent.click(screen.getByText(ar.common.cancel).closest('button')!)
    fireEvent.click(screen.getByText(ar.classes.teachers.edit).closest('button')!)
    fireEvent.click((await screen.findByText(ar.classes.teachers.save)).closest('button')!)
    expect(await screen.findByText(ar.classes.teachers.nothingChanged)).toBeInTheDocument()
    expect(api.puts).toEqual([])
  })

  it('removes a teacher and names the teacher in a server refusal', async () => {
    const api = mockTeachersApi(jsonResponse(422, { statusCode: 422, code: 'user_not_eligible', userId: TEACHER_IDS[0], status: 'suspended', message: 'no' }))
    const { onUpdated } = renderTab(CLASS_ADMIN_PERMISSIONS, makeClass({ teachers: [makeClassTeacher(), makeClassTeacher({ userId: mona.id, fullName: mona.fullName, role: 'assistant' })] }))

    fireEvent.click(screen.getByText(ar.classes.teachers.edit).closest('button')!)
    fireEvent.click(await screen.findByLabelText(`${ar.classes.teachers.remove}: منى المساعدة`))
    expect(screen.queryByRole('combobox', { name: `${ar.classes.teachers.role}: منى المساعدة` })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.classes.teachers.save).closest('button')!)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('حساب «خالد المعلم» ليس مدعواً ولا نشطاً.')).toBeInTheDocument()
    expect(api.puts).toEqual([{ url: `/api/classes/${CLASS_ID}/teachers`, body: { teachers: [{ userId: TEACHER_IDS[0], role: 'lead' }] } }])
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('names an added teacher by the full name the server lists, so the row keeps its name after the save (PR #26 note 6)', async () => {
    const titled = makeTeacherCandidate({ displayName: 'أ. منى' })
    const saved = makeClass({ teachers: [makeClassTeacher(), makeClassTeacher({ userId: titled.id, fullName: titled.fullName, role: 'assistant' })] })
    mockFetch((url, init) => {
      if (new URL(url, 'http://localhost').pathname === '/api/users') return jsonResponse(200, makeUserList([titled]))
      if (init?.method === 'PUT') return jsonResponse(200, saved)
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    })
    renderWithProviders(<StatefulTab initial={makeClass()} />, { auth: makeAuth({ user: makeUser({ permissions: CLASS_ADMIN_PERMISSIONS }) }), route: '/classes' })

    // The search shows the display name, as API-012 returns it…
    await openSearch()
    await waitFor(() => expect(option('أ. منى')).toBeInTheDocument())
    fireEvent.click(screen.getByText('أ. منى', { selector: '.ant-select-item-option-content' }))

    // …the draft row the full name, as API-056 will after the save.
    expect(await screen.findByRole('combobox', { name: `${ar.classes.teachers.role}: منى المساعدة` })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: `${ar.classes.teachers.role}: أ. منى` })).not.toBeInTheDocument()
    expect(screen.getByText('منى المساعدة')).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.classes.teachers.save).closest('button')!)

    expect(await screen.findByText(ar.classes.teachers.saved)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(ar.classes.teachers.save)).not.toBeInTheDocument())
    expect(screen.getByText('منى المساعدة')).toBeInTheDocument()
    expect(screen.getByText(ar.classes.teacherRoles.assistant)).toBeInTheDocument()
  })
})
