// The «تقدّم التعلّم» tab of the class drawer (MOD-20, D-R137). In its own file so the drawer's other test files stay
// untouched; the tab itself is tested in learningProgress/ClassLearningProgressTab.test.tsx.
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { CLASS_ID, CLASS_READER_PERMISSIONS, TEACHER_IDS, makeClass } from '../test/classes'
import { ROSTER_MANAGER_PERMISSIONS, ROSTER_TEACHER_PERMISSIONS } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeClassLearningProgress } from '../test/learningProgress'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ClassDrawer } from './ClassDrawer'

/** The class detail and its learning progress; every URL is recorded. */
function mockDrawerApi() {
  const urls: string[] = []
  mockFetch((url) => {
    urls.push(url)
    if (url === `/api/classes/${CLASS_ID}/learning-progress`) return jsonResponse(200, makeClassLearningProgress())
    if (url === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass({ status: 'running', enrolledCount: 3 }))
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return { urls }
}

function renderDrawer(permissions: string[], userId = 'user-1') {
  renderWithProviders(<ClassDrawer classId={CLASS_ID} onClose={vi.fn()} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ id: userId, permissions }) }),
    route: '/classes',
  })
}

const tabNames = () => [...document.querySelectorAll('.ant-tabs-tab')].map((tab) => tab.textContent ?? '')

describe('ClassDrawer — learning progress tab (MOD-20)', () => {
  it('shows the tab right after the students tab to an enrollment manager, and reads API-235 only once it opens', async () => {
    const { urls } = mockDrawerApi()
    renderDrawer(ROSTER_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101-A')

    const names = tabNames()
    expect(names[names.indexOf('الطلاب (3)') + 1]).toBe(ar.learningProgress.tab)
    expect(urls).toEqual([`/api/classes/${CLASS_ID}`])
    fireEvent.click(screen.getByRole('tab', { name: ar.learningProgress.tab }))
    expect(await screen.findByTestId('class-learning-progress')).toBeInTheDocument()
    expect(await screen.findByText('سارة')).toBeInTheDocument()
    expect(urls).toEqual([`/api/classes/${CLASS_ID}`, `/api/classes/${CLASS_ID}/learning-progress`])
  })

  it('shows it to the class teacher holding enrollments.read, never to a reader who may not read the roster', async () => {
    mockDrawerApi()
    renderDrawer(ROSTER_TEACHER_PERMISSIONS, TEACHER_IDS[0])
    await screen.findByText('PY-101-A')
    expect(tabNames()).toContain(ar.learningProgress.tab)
  })

  it('has no tab for a reader without the roster rule', async () => {
    const { urls } = mockDrawerApi()
    renderDrawer(CLASS_READER_PERMISSIONS, TEACHER_IDS[0])
    await screen.findByText('PY-101-A')
    expect(tabNames()).not.toContain(ar.learningProgress.tab)
    expect(urls).toEqual([`/api/classes/${CLASS_ID}`])
  })
})
