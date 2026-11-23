import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MyClassList } from '../api/enrollments'
import type { MyLessonList } from '../api/myLessons'
import { ar } from '../i18n/ar'
import { ENROLLMENT_IDS, makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAcademy } from '../test/academy'
import { LESSON_LEARNER_PERMISSIONS } from '../test/lessons'
import { LocationProbe } from '../test/LocationProbe'
import { CHILD_ONE, CHILD_TWO, SELF_STUDENT, makeMyLesson, makeMyLessonList } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyClassLessonsPage } from './MyClassLessonsPage'

const own = makeMyClassItem({ student: SELF_STUDENT })
const CLASS_ID = own.class.id
const childOne = makeMyClassItem({ relation: 'child', student: CHILD_ONE })
const childTwo = makeMyClassItem({ enrollmentId: ENROLLMENT_IDS[1], relation: 'child', student: CHILD_TWO })

function mockApi(classes: MyClassList | Response, lessons: MyLessonList = makeMyLessonList([makeMyLesson()])) {
  const queries: URLSearchParams[] = []
  mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (parsed.pathname === '/api/me/classes') return classes instanceof Response ? classes : jsonResponse(200, classes)
    if (parsed.pathname === '/api/me/lessons') {
      queries.push(parsed.searchParams)
      return jsonResponse(200, lessons)
    }
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return { queries }
}

function renderPage(roles: string[], route = `/my-classes/${CLASS_ID}`) {
  return renderWithProviders(<MyClassLessonsPage />, {
    auth: makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role: roles.includes('guardian') ? 'guardian' : 'student', roles, permissions: LESSON_LEARNER_PERMISSIONS }) }),
    route,
    path: '/my-classes/:classId',
    routes: { '/my-classes': <LocationProbe /> },
  })
}

describe('MyClassLessonsPage (J-F62)', () => {
  it('shows every lesson of the chosen class under its name, without the class column or filter', async () => {
    const api = mockApi(makeMyClassList([own]))
    renderPage(['student'])

    expect(await screen.findByRole('heading', { name: own.class.name.ar })).toBeInTheDocument()
    expect(await screen.findByText('المتغيرات وأنواع البيانات')).toBeInTheDocument()
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ classId: CLASS_ID, order: 'asc', limit: '20' })
    // Inside the header row only: a table with `scroll.x` repeats every title in its hidden measure row.
    const header = within(screen.getByRole('table').querySelector<HTMLElement>('.ant-table-thead')!)
    expect(header.queryByText(ar.lessons.columns.class)).not.toBeInTheDocument()
    expect(header.getByText(ar.myLessons.columns.attendance)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.myLessons.filters.class)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.myLessons.filters.student)).not.toBeInTheDocument()
    expect(screen.getByText(ar.myLessons.views.all)).toBeInTheDocument()
  })

  it('keeps the class when the view changes', async () => {
    const api = mockApi(makeMyClassList([own]))
    renderPage(['student'])
    await screen.findByText('المتغيرات وأنواع البيانات')

    fireEvent.click(screen.getByText(ar.myLessons.views.past))
    await waitFor(() => expect(api.queries).toHaveLength(2))
    expect(api.queries[1]!.get('classId')).toBe(CLASS_ID)
    expect(api.queries[1]!.get('order')).toBe('desc')
  })

  it('opens a guardian on the child whose row they chose, offering only this class’s students', async () => {
    const api = mockApi(makeMyClassList([childOne, childTwo]))
    renderPage(['guardian'], `/my-classes/${CLASS_ID}?student=${CHILD_TWO.id}`)

    await screen.findByText('المتغيرات وأنواع البيانات')
    expect(api.queries[0]!.get('studentId')).toBe(CHILD_TWO.id)
    expect(screen.getByLabelText(ar.myLessons.filters.student)).toBeInTheDocument()
  })

  it('ignores a student who is not in the class', async () => {
    const api = mockApi(makeMyClassList([childOne, childTwo]))
    renderPage(['guardian'], `/my-classes/${CLASS_ID}?student=someone-else`)

    await screen.findByText('المتغيرات وأنواع البيانات')
    expect(api.queries[0]!.has('studentId')).toBe(false)
  })

  it('says so for a class the caller does not own, asks for no lesson and leads back', async () => {
    const api = mockApi(makeMyClassList([own]))
    renderPage(['student'], '/my-classes/another-class')

    expect(await screen.findByText(ar.myClasses.classLessons.notFound)).toBeInTheDocument()
    expect(api.queries).toHaveLength(0)
    fireEvent.click(screen.getByText(ar.myClasses.classLessons.back))
    expect(await screen.findByTestId('location')).toHaveTextContent('/my-classes')
  })

  it('offers a retry when «my classes» cannot be read', async () => {
    const api = mockApi(jsonResponse(500, { statusCode: 500, message: 'boom' }))
    renderPage(['student'])

    expect(await screen.findByRole('button', { name: ar.myClasses.refresh })).toBeInTheDocument()
    expect(screen.queryByText(ar.myClasses.classLessons.notFound)).not.toBeInTheDocument()
    expect(api.queries).toHaveLength(0)
  })
})
