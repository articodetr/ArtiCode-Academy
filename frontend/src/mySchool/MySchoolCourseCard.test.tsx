// PORTAL-04 — a «My School» course card names the school subject the course teaches (API-229 `course.subject`),
// never the course's difficulty level, and shows nothing in its place when the course has no subject.
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { LEARNING_ENROLLMENT_IDS, LEARNING_SUBJECT, makeChildCourse, makeLearningCourse } from './mySchool.fixtures'
import { MySchoolCourseCard } from './MySchoolCourseCard'

const LEVEL = { id: '0195a000-0000-7000-8000-00000000a201', name: { ar: 'مبتدئ', en: 'Beginner' } }

function renderCard(item: ReturnType<typeof makeLearningCourse>) {
  return renderWithProviders(<MySchoolCourseCard item={item} />, {
    auth: makeAuth({ user: makeUser({ id: 'student-1', role: 'student', roles: ['student'], permissions: ['courses.read'] }) }),
    route: '/my-school',
    path: '/my-school',
  })
}

const card = (enrollmentId: string) => within(screen.getByTestId(`course-card-${enrollmentId}`))

describe('MySchoolCourseCard', () => {
  it('names the course’s school subject beside its code, never its difficulty level', () => {
    const base = makeLearningCourse()
    renderCard(makeLearningCourse({ course: { ...base.course, level: LEVEL, subject: LEARNING_SUBJECT } }))

    const python = card(LEARNING_ENROLLMENT_IDS[0])
    expect(python.getByTestId('course-subject')).toHaveTextContent('البرمجة')
    expect(python.getByText('PY-101')).toBeInTheDocument()
    expect(python.queryByText('مبتدئ')).toBeNull()
  })

  it('shows no subject and no level when the course has no subject', () => {
    const base = makeLearningCourse()
    renderCard(makeLearningCourse({ course: { ...base.course, level: LEVEL, subject: null } }))

    const python = card(LEARNING_ENROLLMENT_IDS[0])
    expect(python.queryByTestId('course-subject')).toBeNull()
    expect(python.queryByText('مبتدئ')).toBeNull()
  })

  it('names the subject on a guardian’s card about a child too', () => {
    const base = makeChildCourse()
    renderCard(makeChildCourse({ course: { ...base.course, subject: { id: LEARNING_SUBJECT.id, name: { ar: 'اللغة العربية وآدابها' } } } }))

    expect(card(LEARNING_ENROLLMENT_IDS[2]).getByTestId('course-subject')).toHaveTextContent('اللغة العربية وآدابها')
  })
})
