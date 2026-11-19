// MOD-20 — the «تقدّم التعلّم» tab of the class drawer (ClassLearningProgressTab, TEST-252) on API-235: one row per
// student with the server's progress, last activity and last lesson; sorted by progress; empty, 404 and error states.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { CLASS_ID } from '../test/classes'
import { ROSTER_TEACHER_PERMISSIONS } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeClassLearningProgress, makeLearningStudent, makeProgressCounts } from '../test/learningProgress'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ClassLearningProgressTab } from './ClassLearningProgressTab'

function renderTab() {
  renderWithProviders(<ClassLearningProgressTab cls={{ id: CLASS_ID }} />, {
    auth: makeAuth({ user: makeUser({ permissions: ROSTER_TEACHER_PERMISSIONS }) }),
    route: '/classes',
  })
}

const studentNames = () => [...document.querySelectorAll('.ant-table-tbody tr.ant-table-row')].map((row) => row.querySelector('td')?.textContent ?? '')

describe('ClassLearningProgressTab (MOD-20)', () => {
  it('shows every student with the server’s progress, «n of m», last activity and last lesson, read-only', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      return jsonResponse(200, makeClassLearningProgress())
    })
    renderTab()

    const tab = await screen.findByTestId('class-learning-progress')
    expect(within(tab).getByText('الدروس المنشورة: 10 · المطلوبة منها: 8')).toBeInTheDocument()
    expect(studentNames()).toEqual(['عمر خالد', 'سارة', 'يوسف'])
    const [omar, sara, yusuf] = [...tab.querySelectorAll<HTMLElement>('tr.ant-table-row')]
    expect(within(omar!).getByText('4 من 8')).toBeInTheDocument()
    expect(within(omar!).getByText('الشروط')).toBeInTheDocument()
    expect(within(omar!).getByText('50%')).toBeInTheDocument()
    expect(within(sara!).getByText(ar.learningProgress.complete)).toBeInTheDocument()
    expect(within(sara!).getByText('المشروع الختامي')).toBeInTheDocument()
    expect(within(yusuf!).getByText(ar.learningProgress.never)).toBeInTheDocument()
    // Read-only: no field to type in.
    expect(tab.querySelectorAll('input, textarea')).toHaveLength(0)
    expect(urls).toEqual([`/api/classes/${CLASS_ID}/learning-progress`])
  })

  it('sorts by progress, highest first, then lowest first', async () => {
    mockFetch(() =>
      jsonResponse(
        200,
        makeClassLearningProgress({
          students: [
            makeLearningStudent(),
            makeLearningStudent({ enrollmentId: 'e-2', student: { ...makeLearningStudent().student, id: 's-2', fullName: 'ليلى' }, progress: makeProgressCounts({ percent: 75, completedRequired: 6 }) }),
            makeLearningStudent({ enrollmentId: 'e-3', student: { ...makeLearningStudent().student, id: 's-3', fullName: 'زيد' }, progress: makeProgressCounts({ percent: 0, completedRequired: 0 }) }),
          ],
        }),
      ),
    )
    renderTab()
    await screen.findByTestId('class-learning-progress')
    expect(studentNames()).toEqual(['عمر خالد', 'ليلى', 'زيد'])

    const header = screen.getByText(ar.learningProgress.columns.progress, { selector: '.ant-table-thead *' })
    fireEvent.click(header)
    await waitFor(() => expect(studentNames()).toEqual(['ليلى', 'عمر خالد', 'زيد']))
    fireEvent.click(header)
    await waitFor(() => expect(studentNames()).toEqual(['زيد', 'عمر خالد', 'ليلى']))
  })

  it('says «no required lessons» when the server has no percent, and shows the empty class', async () => {
    let body = makeClassLearningProgress({ totals: { lessons: 2, required: 0 }, students: [makeLearningStudent({ progress: makeProgressCounts({ required: 0, completedRequired: 0, percent: null }) })] })
    mockFetch(() => jsonResponse(200, body))
    const { unmount } = renderWithProviders(<ClassLearningProgressTab cls={{ id: CLASS_ID }} />, { auth: makeAuth({ user: makeUser({ permissions: ROSTER_TEACHER_PERMISSIONS }) }) })
    expect(await screen.findByText(ar.learningProgress.noRequired)).toBeInTheDocument()
    unmount()

    body = makeClassLearningProgress({ students: [] })
    renderTab()
    expect(await screen.findByText(ar.learningProgress.empty)).toBeInTheDocument()
  })

  it('words a 404 as not available, and offers a retry after any other failure', async () => {
    mockFetch(() => jsonResponse(404, { statusCode: 404, error: 'Not Found', code: 'class_not_found', message: 'no' }))
    const { unmount } = renderWithProviders(<ClassLearningProgressTab cls={{ id: CLASS_ID }} />, { auth: makeAuth({ user: makeUser({ permissions: ROSTER_TEACHER_PERMISSIONS }) }) })
    expect(await screen.findByText(ar.learningProgress.notAvailable)).toBeInTheDocument()
    unmount()

    let failing = true
    mockFetch(() => (failing ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makeClassLearningProgress())))
    renderTab()
    expect(await screen.findByText(ar.learningProgress.loadError)).toBeInTheDocument()
    failing = false
    fireEvent.click(screen.getByText(ar.learningProgress.retry).closest('button')!)
    expect(await screen.findByTestId('class-learning-progress')).toBeInTheDocument()
  })
})
