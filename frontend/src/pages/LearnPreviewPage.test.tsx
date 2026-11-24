// TEST-263 (LRN-T06, D-R144) — «معاينة كطالب»: the course player as a learner
// sees it, built from the author's curriculum (API-226) alone — published
// lessons only, the drafts too behind «إظهار المسودّات» (tagged), every level
// open with its release rule stated (D-R145), a fixed banner, the completion
// button disabled, and no learner API (API-229..234) ever called; a caller
// who may not read the curriculum (404) is told who the preview is for.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Curriculum, CurriculumItem, CurriculumSection } from '../api/curriculum'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { LearnPreviewPage } from './LearnPreviewPage'

function lesson(id: string, title: string, overrides: Partial<CurriculumItem> = {}): CurriculumItem {
  const value = {
    id,
    sortOrder: 0,
    title: { ar: title },
    description: null,
    estimatedMinutes: null,
    kind: 'text' as const,
    content: { body: { ar: `نص ${title}` } },
    resources: [],
    isRequired: true,
    isPublished: true,
    completionMode: 'manual' as const,
    durationSeconds: null,
    progressCount: 0,
    sessionCount: 0,
    updatedAt: '2026-11-19T10:00:00.000Z',
  }
  return { ...value, ...overrides } as CurriculumItem
}

function level(id: string, number: number, items: CurriculumItem[], overrides: Partial<CurriculumSection> = {}): CurriculumSection {
  const value = { id, number, sortOrder: number - 1, title: null, description: null, releaseAfterDays: null, items }
  return { ...value, ...overrides } as CurriculumSection
}

/**
 * «المستوى الأول — أساسيات»: p1 published, p2 a draft; level 2 (opens 14 days
 * after the class starts): p3 published; level 3: only the draft p4.
 */
function makeCurriculum(): Curriculum {
  return {
    courseId: 'c1',
    courseCode: 'PY-101',
    canManage: true,
    sections: [
      level('s1', 1, [lesson('p1', 'مقدمة'), lesson('p2', 'مسودة الفيديو', { isPublished: false })], { title: { ar: 'أساسيات' } }),
      level('s2', 2, [lesson('p3', 'التمارين')], { releaseAfterDays: 14 }),
      level('s3', 3, [lesson('p4', 'درس قيد الكتابة', { isPublished: false })]),
    ],
    looseItems: [],
  }
}

function serve(curriculum: Curriculum | Response) {
  const paths: string[] = []
  mockFetch((url, init) => {
    const path = new URL(url, 'http://localhost').pathname
    paths.push(`${init?.method ?? 'GET'} ${path}`)
    if (path === '/api/academy') return jsonResponse(200, makeAcademy())
    if (path === '/api/courses/c1/curriculum') return curriculum instanceof Response ? curriculum.clone() : jsonResponse(200, curriculum)
    return jsonResponse(404, {})
  })
  return {
    paths,
    /** Every request but the brand's read of the academy (API-035). */
    requested: () => [...new Set(paths.filter((entry) => entry !== 'GET /api/academy'))],
  }
}

const teacher = () => makeAuth({ user: makeUser({ id: 'te-1', role: 'teacher', roles: ['teacher'], permissions: ['courses.read'] }) })

function renderPreview(route = '/learn/c1/preview') {
  return renderWithProviders(<LearnPreviewPage />, {
    auth: teacher(),
    route,
    path: route.split('?')[0]!.split('/').filter(Boolean).length > 3 ? '/learn/:courseId/preview/:itemId' : '/learn/:courseId/preview',
    routes: {
      [route.split('?')[0]!.split('/').filter(Boolean).length > 3 ? '/learn/:courseId/preview' : '/learn/:courseId/preview/:itemId']: <LearnPreviewPage />,
      '/courses': <LocationProbe />,
    },
  })
}

const curriculumNav = () => within(screen.getByRole('navigation', { name: 'محتوى الدورة' }))
const lessonHeading = () => screen.getByRole('heading', { level: 1 })
const banner = () => within(screen.getByTestId('learn-preview-banner'))

describe('LearnPreviewPage — «معاينة كطالب» (TEST-263)', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('shows the published lessons only, under a fixed banner, and records nothing', async () => {
    const server = serve(makeCurriculum())
    renderPreview()

    await waitFor(() => expect(lessonHeading()).toHaveTextContent('مقدمة'))
    expect(banner().getByText('معاينة كطالب — لا يُحفظ تقدّم')).toBeInTheDocument()
    expect(banner().getByRole('switch', { name: 'إظهار المسودّات' })).toHaveAttribute('aria-checked', 'false')

    const nav = curriculumNav()
    expect(nav.getByText('المستوى الأول — أساسيات')).toBeInTheDocument()
    // Every level is open in the preview; its release rule is stated beside it.
    const second = nav.getByText('المستوى الثاني').closest('button')!
    expect(second).toHaveTextContent('يُفتح بعد 14 يوماً من بدء الفصل')
    expect(nav.queryByRole('img', { name: 'مستوى مقفل حتى موعد فتحه' })).not.toBeInTheDocument()
    // The drafts — and the level that holds only drafts — are not shown.
    expect(nav.queryByText('مسودة الفيديو')).not.toBeInTheDocument()
    expect(nav.queryByText('المستوى الثالث')).not.toBeInTheDocument()
    expect(nav.getByText('مقدمة').closest('a')).toHaveAttribute('href', '/learn/c1/preview/p1')

    // No completion button (AHMED-TT-1): a lesson completes by its video, never by a click.
    expect(screen.queryByText('تحديد كمكتمل')).not.toBeInTheDocument()

    // «Next» steps to the next shown lesson, across the level boundary.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'التنقل بين الدروس' })).getByText('التالي').closest('button')!)
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('التمارين'))

    // Only the curriculum was read: no visit, no playback, no completion, no workspace.
    expect(server.requested()).toEqual(['GET /api/courses/c1/curriculum'])
    expect(server.paths.some((entry) => entry.includes('/api/me/learning'))).toBe(false)
  })

  it('shows the drafts too, tagged, when «إظهار المسودّات» is on — and goes back to a shown lesson when it is off again', async () => {
    const server = serve(makeCurriculum())
    renderPreview()
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('مقدمة'))

    fireEvent.click(banner().getByRole('switch', { name: 'إظهار المسودّات' }))
    const nav = curriculumNav()
    await waitFor(() => expect(nav.getByText('مسودة الفيديو')).toBeInTheDocument())
    const draft = nav.getByText('مسودة الفيديو').closest('a')!
    expect(draft).toHaveTextContent('مسودّة')
    expect(draft).toHaveAttribute('href', '/learn/c1/preview/p2?drafts=1')
    expect(nav.getByText('المستوى الثالث').closest('button')).toHaveAttribute('aria-expanded', 'false')
    // A published lesson carries no draft tag.
    expect(nav.getByText('مقدمة').closest('a')).not.toHaveTextContent('مسودّة')

    fireEvent.click(draft)
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('مسودة الفيديو'))
    expect(screen.getByRole('article').querySelector('.learn-lesson__meta')).toHaveTextContent('مسودّة')

    // Hiding the drafts again leaves the draft lesson for the first shown one.
    fireEvent.click(banner().getByRole('switch', { name: 'إظهار المسودّات' }))
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('مقدمة'))
    expect(curriculumNav().queryByText('مسودة الفيديو')).not.toBeInTheDocument()
    expect(server.requested()).toEqual(['GET /api/courses/c1/curriculum'])
  })

  it('opens a draft lesson named in the address when the drafts are on', async () => {
    serve(makeCurriculum())
    renderPreview('/learn/c1/preview/p4?drafts=1')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('درس قيد الكتابة'))
    expect(curriculumNav().getByText('المستوى الثالث').closest('button')).toHaveAttribute('aria-expanded', 'true')
  })

  it('says who the preview is for when the curriculum cannot be read (404)', async () => {
    const server = serve(jsonResponse(404, { statusCode: 404, code: 'course_not_found', message: 'No course with this id' }))
    renderPreview()

    expect(await screen.findByRole('heading', { name: 'المعاينة متاحة لمن يدير الدورة أو يدرّسها' })).toBeInTheDocument()
    expect(screen.getByTestId('learn-preview-banner')).toBeInTheDocument()
    fireEvent.click(screen.getByText('العودة إلى الدورات', { selector: '.ant-btn span' }).closest('button')!)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/courses'))
    expect(server.requested()).toEqual(['GET /api/courses/c1/curriculum'])
  })

  it('tells the author when no lesson is published yet', async () => {
    const curriculum = makeCurriculum()
    curriculum.sections = curriculum.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, isPublished: false })) }))
    serve(curriculum)
    renderPreview()
    expect(await screen.findByText('لا دروس منشورة في هذه الدورة بعد. فعّل «إظهار المسودّات» لمعاينة الدروس غير المنشورة.')).toBeInTheDocument()
  })
})
