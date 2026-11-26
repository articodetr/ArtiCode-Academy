// TEST-198 (J-F75, CH-0382): the three buttons of a lesson card on the class page — «تعديل» opens the lesson drawer
// on its edit form, «حذف» deletes after a confirmation, «إضافة اختبار» opens the exam form with this lesson chosen —
// greyed out with a reason when the lesson refuses them, absent in a closed class or without their keys, and never
// opening the card's drawer by themselves.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ClassStatus } from '../api/classes'
import type { Lesson } from '../api/lessons'
import { ar } from '../i18n/ar'
import { LessonDrawer } from '../lessons/LessonDrawer'
import { makeAcademy } from '../test/academy'
import { CLASS_ID, makeClass } from '../test/classes'
import { makeExam } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { EMPTY_ATTENDANCE, makeLesson, makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ClassLessonsTab } from './ClassLessonsTab'

const TEACHER = ['classes.read', 'lessons.read', 'lessons.manage', 'attendance.read', 'attendance.record', 'exams.read', 'exams.manage', 'exams.grade']

const scheduled = makeLesson({ id: 'l-scheduled', title: { ar: 'مقدمة في البرمجة' } })
const completed = makeLesson({ id: 'l-completed', title: { ar: 'البرمجة' }, status: 'completed', attendance: { ...EMPTY_ATTENDANCE, recorded: 3, present: 3 } })
const cancelled = makeLesson({ id: 'l-cancelled', title: { ar: 'درس ملغى' }, status: 'cancelled' })
const attended = makeLesson({ id: 'l-attended', title: { ar: 'درس سُجّل حضوره' }, attendance: { ...EMPTY_ATTENDANCE, recorded: 2, present: 2 } })

interface Call {
  method: string
  path: string
  body: unknown
}

function mockTabApi(lessons: Lesson[] = [scheduled, completed, cancelled, attended]) {
  const calls: Call[] = []
  let current = [...lessons]
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname, search } = new URL(url, 'http://localhost')
    calls.push({ method, path: pathname + search, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined })
    if (pathname === '/api/lessons' && method === 'GET') return jsonResponse(200, makeLessonList(current))
    if (pathname.startsWith('/api/lessons/')) {
      const id = decodeURIComponent(pathname.slice('/api/lessons/'.length))
      const lesson = current.find((item) => item.id === id)
      if (!lesson) return jsonResponse(404, { statusCode: 404, code: 'lesson_not_found', message: 'gone' })
      if (method === 'DELETE') {
        current = current.filter((item) => item.id !== id)
        return jsonResponse(204)
      }
      return jsonResponse(200, lesson)
    }
    if (pathname === `/api/classes/${CLASS_ID}` && method === 'GET') return jsonResponse(200, makeClass({ status: 'running' }))
    if (pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (pathname === `/api/classes/${CLASS_ID}/exams` && method === 'POST') return jsonResponse(201, makeExam({ id: 'new-exam', title: { ar: 'اختبار الدرس' } }))
    if (pathname === '/api/exams/new-exam') return jsonResponse(200, makeExam({ id: 'new-exam', title: { ar: 'اختبار الدرس' } }))
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${method} ${pathname}` })
  })
  return { calls }
}

function renderTab({ permissions = TEACHER, status = 'running', onExamsChanged }: { permissions?: string[]; status?: ClassStatus; onExamsChanged?: () => void } = {}) {
  return renderWithProviders(<ClassLessonsTab cls={makeClass({ status })} onExamsChanged={onExamsChanged} />, {
    auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions }) }),
  })
}

const card = (id: string) => screen.getByTestId(`class-lesson-${id}`)
const cardButton = (id: string, label: string) => within(card(id)).queryByText(label)?.closest('button') ?? null

describe('ClassLessonsTab — the buttons of a lesson card (J-F75)', () => {
  it('gives every lesson of an open class «تعديل», «حذف» and «إضافة اختبار», greying out what the lesson refuses with its reason', async () => {
    mockTabApi()
    renderTab()
    await screen.findByText('مقدمة في البرمجة')
    const { edit, delete: remove, addExam } = ar.classPage.lessons
    expect(cardButton('l-scheduled', edit)).toBeEnabled()
    expect(cardButton('l-scheduled', remove)).toBeEnabled()
    expect(cardButton('l-scheduled', addExam)).toBeEnabled()
    // A completed lesson is still edited (its time and room are locked inside the form) and still gets an exam.
    expect(cardButton('l-completed', edit)).toBeEnabled()
    expect(cardButton('l-completed', remove)).toBeDisabled()
    expect(cardButton('l-completed', addExam)).toBeEnabled()
    expect(cardButton('l-cancelled', edit)).toBeDisabled()
    expect(cardButton('l-cancelled', remove)).toBeDisabled()
    expect(cardButton('l-attended', remove)).toBeDisabled()

    fireEvent.mouseEnter(cardButton('l-completed', remove)!.parentElement!)
    expect(await screen.findByText(ar.classPage.lessons.deleteCompleted)).toBeInTheDocument()
    fireEvent.mouseEnter(cardButton('l-attended', remove)!.parentElement!)
    expect(await screen.findByText(ar.classPage.lessons.deleteHasAttendance)).toBeInTheDocument()
    fireEvent.mouseEnter(cardButton('l-cancelled', edit)!.parentElement!)
    expect(await screen.findByText(ar.classPage.lessons.editCancelled)).toBeInTheDocument()
  })

  it('shows no button in a closed class, and to each reader only the buttons of the keys they hold', async () => {
    mockTabApi()
    const { unmount } = renderTab({ status: 'completed' })
    await screen.findByText('مقدمة في البرمجة')
    expect(screen.queryByTestId('class-lesson-actions-l-scheduled')).toBeNull()
    unmount()

    renderTab({ permissions: ['classes.read', 'lessons.read'] })
    await screen.findByText('مقدمة في البرمجة')
    expect(screen.queryByTestId('class-lesson-actions-l-scheduled')).toBeNull()
  })

  it('gives a reader who manages exams but not lessons «إضافة اختبار» alone', async () => {
    mockTabApi()
    renderTab({ permissions: ['classes.read', 'lessons.read', 'exams.read', 'exams.manage'] })
    await screen.findByText('مقدمة في البرمجة')
    expect(cardButton('l-scheduled', ar.classPage.lessons.addExam)).toBeEnabled()
    expect(cardButton('l-scheduled', ar.classPage.lessons.edit)).toBeNull()
    expect(cardButton('l-scheduled', ar.classPage.lessons.delete)).toBeNull()
  })

  it('deletes a scheduled lesson after a confirmation and reads the list again, without opening the lesson drawer', async () => {
    const { calls } = mockTabApi()
    renderTab()
    await screen.findByText('مقدمة في البرمجة')
    fireEvent.click(cardButton('l-scheduled', ar.classPage.lessons.delete)!)
    const titles = await screen.findAllByText('حذف الدرس «مقدمة في البرمجة»؟')
    const dialog = titles[0]!.closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(ar.classPage.lessons.deleteConfirmContent)).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    fireEvent.click(within(dialog).getByText(ar.classPage.lessons.delete).closest('button')!)
    expect(await screen.findByText(ar.lessons.done.delete)).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual(['/api/lessons/l-scheduled'])
    await waitFor(() => expect(screen.queryByTestId('class-lesson-l-scheduled')).toBeNull())
    expect(calls.filter((call) => call.method === 'GET' && call.path.startsWith('/api/lessons?'))).toHaveLength(2)
    // The card's own drawer never read its lesson.
    expect(calls.some((call) => call.method === 'GET' && call.path === '/api/lessons/l-scheduled')).toBe(false)
  })

  it('opens the lesson drawer on its edit form with «تعديل», and on its details with a click on the card', async () => {
    mockTabApi()
    const { unmount } = renderTab()
    await screen.findByText('مقدمة في البرمجة')
    fireEvent.click(cardButton('l-scheduled', ar.classPage.lessons.edit)!)
    expect(await screen.findByLabelText(ar.lessons.fields.titleAr)).toHaveValue('مقدمة في البرمجة')
    expect(screen.getByText(ar.common.save)).toBeInTheDocument()
    unmount()

    mockTabApi()
    renderTab()
    await screen.findByText('مقدمة في البرمجة')
    fireEvent.click(card('l-scheduled'))
    // The drawer's header offers the lesson's actions; the form stays closed.
    expect(await screen.findByText(ar.lessons.actions.menu)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.lessons.fields.titleAr)).toBeNull()
  })

  it('adds an exam to the lesson: the form opens with the class fixed and the lesson chosen, the body carries it, and the new exam opens', async () => {
    const { calls } = mockTabApi()
    const onExamsChanged = vi.fn()
    renderTab({ onExamsChanged })
    await screen.findByText('مقدمة في البرمجة')
    fireEvent.click(cardButton('l-scheduled', ar.classPage.lessons.addExam)!)
    const dialog = (await screen.findByText(ar.exams.create.title)).closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(/سيُضاف إلى الفصل/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(ar.exams.fields.class)).toBeNull()
    const lessonField = within(dialog).getByLabelText(ar.exams.fields.lesson).closest('.ant-select') as HTMLElement
    expect(within(lessonField).getByText(/مقدمة في البرمجة/)).toBeInTheDocument()

    fireEvent.mouseDown(within(dialog).getByLabelText(ar.exams.fields.type))
    fireEvent.click(await screen.findByText(ar.exams.types.quiz, { selector: '.ant-select-item-option-content' }))
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.titleAr), 'اختبار الدرس')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.maxScore), '10')
    fireEvent.click(within(dialog).getByText(ar.exams.create.submit).closest('button')!)

    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1))
    expect(calls.find((call) => call.method === 'POST')).toMatchObject({ path: `/api/classes/${CLASS_ID}/exams`, body: { lessonId: 'l-scheduled', type: 'quiz', maxScore: 10, title: { ar: 'اختبار الدرس' } } })
    expect(await screen.findByText('أُنشئ الاختبار «اختبار الدرس» مسودةً')).toBeInTheDocument()
    expect(onExamsChanged).toHaveBeenCalled()
    await waitFor(() => expect(calls.some((call) => call.path === '/api/exams/new-exam')).toBe(true))
  })
})

describe('LessonDrawer — startEditing (J-F75)', () => {
  it('opens a lesson that may not be edited (cancelled) on its details', async () => {
    mockTabApi()
    renderWithProviders(<LessonDrawer lessonId="l-cancelled" startEditing onClose={vi.fn()} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
      auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions: TEACHER }) }),
    })
    expect((await screen.findAllByText('درس ملغى')).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText(ar.lessons.fields.titleAr)).toBeNull()
  })
})
