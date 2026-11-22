import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { COURSE_ID, makeCourse, makeCourseList } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { BANK_COURSE, QUESTION_TEACHER_PERMISSIONS } from '../test/questionBanks'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { BankCoursePicker } from './BankCoursePicker'

const OTHER_COURSE_ID = '0193a000-0000-7000-8000-00000000c002'
const other = makeCourse({ id: OTHER_COURSE_ID, code: 'JS-201', name: { ar: 'جافاسكربت المتقدمة', en: 'Advanced JavaScript' }, status: 'published' })

/** GET /api/courses answers `items` whatever the search; every query is recorded. */
function mockCourses(items = [other]) {
  const queries: URLSearchParams[] = []
  mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    queries.push(parsed.searchParams)
    return parsed.pathname === '/api/courses' ? jsonResponse(200, makeCourseList(items)) : jsonResponse(404, { statusCode: 404, message: 'not found' })
  })
  return { queries }
}

const auth = () => makeAuth({ user: makeUser({ permissions: QUESTION_TEACHER_PERMISSIONS }) })
const optionTexts = () => Array.from(document.querySelectorAll('.ant-select-item-option-content')).map((element) => element.textContent)
const open = () => fireEvent.mouseDown(screen.getByLabelText('course'))

describe('BankCoursePicker', () => {
  it('lists the courses the caller may read (API-042), by code and name', async () => {
    const { queries } = mockCourses()
    const onChange = vi.fn()
    renderWithProviders(<BankCoursePicker aria-label="course" onChange={onChange} />, { auth: auth() })

    open()
    await waitFor(() => expect(optionTexts()).toEqual(['JS-201 — جافاسكربت المتقدمة']))
    expect(Object.fromEntries(queries[0]!)).toEqual({ limit: '20' })
    fireEvent.click(screen.getByText('JS-201 — جافاسكربت المتقدمة', { selector: '.ant-select-item-option-content' }))
    expect(onChange).toHaveBeenCalledWith(OTHER_COURSE_ID)
  })

  it('puts the course a form starts from first, so it shows by name even when the first page does not hold it', async () => {
    mockCourses()
    renderWithProviders(<BankCoursePicker aria-label="course" value={COURSE_ID} initial={BANK_COURSE} />, { auth: auth() })

    // Never the raw id once the first page has arrived.
    expect(await screen.findByText('PY-101 — أساسيات بايثون')).toBeInTheDocument()
    open()
    await waitFor(() => expect(optionTexts()).toEqual(['PY-101 — أساسيات بايثون', 'JS-201 — جافاسكربت المتقدمة']))
  })

  it('does not repeat the starting course when the first page holds it', async () => {
    mockCourses([makeCourse({ status: 'published' }), other])
    renderWithProviders(<BankCoursePicker aria-label="course" value={COURSE_ID} initial={BANK_COURSE} />, { auth: auth() })

    await screen.findByText('PY-101 — أساسيات بايثون')
    open()
    await waitFor(() => expect(optionTexts()).toEqual(['PY-101 — أساسيات بايثون', 'JS-201 — جافاسكربت المتقدمة']))
  })

  it('offers «بلا دورة» before the courses in the list filter, and reports it as `none`', async () => {
    mockCourses()
    const onChange = vi.fn()
    renderWithProviders(<BankCoursePicker aria-label="course" withNoCourse onChange={onChange} />, { auth: auth() })

    open()
    await waitFor(() => expect(optionTexts()).toEqual([ar.questionBanks.banks.noCourse, 'JS-201 — جافاسكربت المتقدمة']))
    fireEvent.click(screen.getByText(ar.questionBanks.banks.noCourse, { selector: '.ant-select-item-option-content' }))
    expect(onChange).toHaveBeenCalledWith('none')
  })

  it('says when no course matches', async () => {
    mockCourses([])
    renderWithProviders(<BankCoursePicker aria-label="course" />, { auth: auth() })

    open()
    expect(await screen.findByText(ar.questionBanks.bankForm.noCourses)).toBeInTheDocument()
  })
})
