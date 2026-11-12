// The «grades» tab of the class drawer (J-F49 — MOD-09-T08 part c). In its own file so the drawer's other test files
// stay untouched; the tab itself is tested in grades/ClassGradebookTab.test.tsx.
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { CLASS_ID, CLASS_MANAGER_PERMISSIONS, makeClass } from '../test/classes'
import { GRADEBOOK_READER_PERMISSIONS, GRADEBOOK_TEACHER_PERMISSIONS, fullGradebook } from '../test/gradebook'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ClassDrawer } from './ClassDrawer'

function mockDrawerApi() {
  const paths: string[] = []
  mockFetch((url, init) => {
    const path = new URL(url, 'http://localhost').pathname
    paths.push(`${init?.method ?? 'GET'} ${path}`)
    if ((init?.method ?? 'GET') !== 'GET') return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    if (path === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass({ status: 'running', enrolledCount: 3 }))
    if (path === `/api/classes/${CLASS_ID}/gradebook`) return jsonResponse(200, fullGradebook())
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return paths
}

function renderDrawer(permissions: string[]) {
  renderWithProviders(<ClassDrawer classId={CLASS_ID} onClose={vi.fn()} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/classes',
  })
}

describe('ClassDrawer — grades tab (J-F49)', () => {
  it('offers the tab to a teacher holding grades.read_all and grades.manage, reading the gradebook only once it opens', async () => {
    const paths = mockDrawerApi()
    renderDrawer(GRADEBOOK_TEACHER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(paths).not.toContain(`GET /api/classes/${CLASS_ID}/gradebook`)

    fireEvent.click(screen.getByRole('tab', { name: ar.gradebook.tab }))
    const tab = await screen.findByTestId('class-gradebook')
    expect(await within(tab).findByText('سارة الطالبة')).toBeInTheDocument()
    expect(within(tab).getByText(ar.gradebook.finalize.actionAgain).closest('button')).toBeInTheDocument()
    expect(paths.filter((path) => path === `GET /api/classes/${CLASS_ID}/gradebook`)).toHaveLength(1)
  })

  it('shows a reader of every class the tab read-only', async () => {
    mockDrawerApi()
    renderDrawer(GRADEBOOK_READER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    fireEvent.click(screen.getByRole('tab', { name: ar.gradebook.tab }))
    const tab = await screen.findByTestId('class-gradebook')
    expect(await within(tab).findByText(ar.gradebook.readOnly)).toBeInTheDocument()
    expect(within(tab).queryByText(ar.gradebook.finalize.actionAgain)).not.toBeInTheDocument()
  })

  it('has no grades tab without grades.read_all (staff by seed) and never reads the gradebook', async () => {
    const paths = mockDrawerApi()
    renderDrawer(CLASS_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.getByRole('tab', { name: ar.classSchedule.tab })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.gradebook.tab })).not.toBeInTheDocument()
    expect(paths.some((path) => path.endsWith('/gradebook'))).toBe(false)
  })
})
