// MOD-20 — the «المنهج» tab of the course drawer (CurriculumTab, TEST-252): the levels and lessons of API-226, the
// editor's edits saved as ONE PUT (API-227) only when something differs, the lessons learners have progress on
// (no delete; a 409 lesson_has_progress puts them back), the read-only view of a teacher and the 404 of anyone else.
// LRN-T06 (TEST-264): a new lesson is an unpublished draft (D-R144), «نشر المستوى»/«نشر الكل» then ONE PUT with the
// flags, a level's releaseAfterDays in the body (D-R145), the sessions tag (D-R143), the preview link off while dirty.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Curriculum, CurriculumInput } from '../api/curriculum'
import { ar } from '../i18n/ar'
import { COURSE_ID, COURSE_MANAGER_PERMISSIONS } from '../test/courses'
import { ITEM_IDS, SECTION_IDS, makeCurriculum } from '../test/curriculum'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CurriculumTab } from './CurriculumTab'

interface Call {
  method: string
  url: string
  body: unknown
}

/** GET answers `current()`; a PUT answers `put(body)` (by default the curriculum the server would hold). */
function mockCurriculumApi(current: () => Curriculum | Response, put?: (body: CurriculumInput) => Response) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (method === 'GET') {
      const answer = current()
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    if (method === 'PUT' && put) return put(body as CurriculumInput)
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

function renderTab() {
  const onUnsavedChange = vi.fn()
  renderWithProviders(<CurriculumTab courseId={COURSE_ID} onUnsavedChange={onUnsavedChange} />, {
    auth: makeAuth({ user: makeUser({ permissions: COURSE_MANAGER_PERMISSIONS }) }),
    route: '/courses',
  })
  return { onUnsavedChange }
}

const levels = () => screen.getAllByTestId('curriculum-level')
/** A level heading (the move-to selects show the same names). */
/** A save re-renders the whole editor from the server's answer: slower than findBy's 1 s default in jsdom. */
const SLOW = { timeout: 8000 }
const HEADING = { selector: '.ant-card-head-title, .ant-card-head-title *' }
const lessonsOf = (container: HTMLElement) => within(container).getAllByTestId('curriculum-lesson')
const saveButton = () => screen.getByText(ar.curriculum.save).closest('button')!
const puts = (calls: Call[]) => calls.filter((call) => call.method === 'PUT')
const lastReport = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[0]

describe('CurriculumTab (MOD-20)', () => {
  it('shows the levels with their ordinal names, their lessons and the lessons outside the levels; nothing to save yet', async () => {
    const calls = mockCurriculumApi(() => makeCurriculum())
    const { onUnsavedChange } = renderTab()

    expect(await screen.findByText('المستوى الأول — البداية', HEADING)).toBeInTheDocument()
    expect(screen.getByText('المستوى الثاني', HEADING)).toBeInTheDocument()
    const loose = screen.getByTestId('curriculum-loose')
    expect(within(loose).getByText(ar.curriculum.loose.title)).toBeInTheDocument()
    const [first, second] = levels()
    expect(lessonsOf(first!).map((row) => within(row).getByLabelText<HTMLInputElement>(ar.curriculum.lesson.fields.titleAr).value)).toEqual(['المتغيرات', 'الشروط'])
    // Numbered in learning order across the levels; the video lesson shows its kind and length.
    expect(within(lessonsOf(second!)[0]!).getByText('الدرس 3')).toBeInTheDocument()
    expect(within(lessonsOf(second!)[0]!).getByText(ar.curriculum.kinds.video)).toBeInTheDocument()
    expect(within(lessonsOf(second!)[0]!).getByText('3:32')).toBeInTheDocument()
    expect(within(lessonsOf(loose)[0]!).getByText(ar.curriculum.lesson.unpublished)).toBeInTheDocument()
    expect(screen.getByText('مستويان · 4 دروس')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(calls).toEqual([{ method: 'GET', url: `/api/courses/${COURSE_ID}/curriculum`, body: undefined }])
    expect(lastReport(onUnsavedChange)).toBe(false)
  })

  it('adds a level and a lesson in it and saves the whole structure in ONE PUT with the exact body', async () => {
    const calls = mockCurriculumApi(
      () => makeCurriculum(),
      () => jsonResponse(200, makeCurriculum()),
    )
    const { onUnsavedChange } = renderTab()
    await screen.findByText('المستوى الأول — البداية', HEADING)

    fireEvent.click(screen.getByText(ar.curriculum.level.add).closest('button')!)
    const third = levels()[2]!
    expect(within(third).getByText('المستوى الثالث', HEADING)).toBeInTheDocument()
    fireEvent.change(within(third).getByLabelText(ar.curriculum.level.fields.titleAr), { target: { value: 'المتقدم' } })
    fireEvent.click(within(third).getByText(ar.curriculum.lesson.add).closest('button')!)
    const row = lessonsOf(levels()[2]!)[0]!
    expect(within(row).getByText(ar.curriculum.lesson.contentNeedsSave)).toBeInTheDocument()
    fireEvent.change(within(row).getByLabelText(ar.curriculum.lesson.fields.titleAr), { target: { value: 'الدوال' } })
    fireEvent.change(within(row).getByLabelText(ar.curriculum.lesson.fields.estimatedMinutes), { target: { value: '20' } })
    fireEvent.click(within(row).getByLabelText(ar.curriculum.lesson.fields.required))
    expect(lastReport(onUnsavedChange)).toBe(true)

    fireEvent.click(saveButton())
    expect(await screen.findByText(ar.curriculum.saved, undefined, SLOW)).toBeInTheDocument()
    expect(puts(calls)).toHaveLength(1)
    expect(puts(calls)[0]).toEqual({
      method: 'PUT',
      url: `/api/courses/${COURSE_ID}/curriculum`,
      body: {
        sections: [
          {
            id: SECTION_IDS[0],
            title: { ar: 'البداية', en: 'Start' },
            items: [
              { id: ITEM_IDS[0], title: { ar: 'المتغيرات', en: 'Variables' }, estimatedMinutes: 45, isRequired: true, isPublished: true },
              { id: ITEM_IDS[1], title: { ar: 'الشروط' }, description: { ar: 'if و else' }, estimatedMinutes: 60, isRequired: true, isPublished: true },
            ],
          },
          { id: SECTION_IDS[1], items: [{ id: ITEM_IDS[2], title: { ar: 'الحلقات', en: 'Loops', tr: 'Döngüler' }, isRequired: true, isPublished: true }] },
          // A new lesson starts as an unpublished draft (D-R144).
          { title: { ar: 'المتقدم' }, items: [{ title: { ar: 'الدوال' }, estimatedMinutes: 20, isRequired: false, isPublished: false }] },
        ],
        looseItems: [{ id: ITEM_IDS[3], title: { ar: 'مراجعة' }, isRequired: false, isPublished: false }],
      },
    })
    // The editor now shows the server's answer: nothing left to save.
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(lastReport(onUnsavedChange)).toBe(false)
  })

  it('reorders lessons and levels and moves a lesson to another level; the body follows the new order', async () => {
    const calls = mockCurriculumApi(
      () => makeCurriculum(),
      () => jsonResponse(200, makeCurriculum()),
    )
    renderTab()
    await screen.findByText('المستوى الأول — البداية', HEADING)

    fireEvent.click(within(lessonsOf(levels()[0]!)[1]!).getByLabelText(ar.curriculum.lesson.moveUp))
    fireEvent.click(within(levels()[1]!).getByLabelText(ar.curriculum.level.moveUp))
    // A level is named by its place: the moved one is «المستوى الأول» now, «البداية» the second.
    expect(within(levels()[0]!).getByText('المستوى الأول', HEADING)).toBeInTheDocument()
    expect(within(levels()[1]!).getByText('المستوى الثاني — البداية', HEADING)).toBeInTheDocument()
    // The lesson outside the levels goes to the (now first) level «المستوى الأول».
    const loose = lessonsOf(screen.getByTestId('curriculum-loose'))[0]!
    fireEvent.mouseDown(within(loose).getByRole('combobox'))
    const options = await screen.findAllByText('المستوى الأول', { selector: '.ant-select-item-option-content' })
    fireEvent.click(options.at(-1)!)
    expect(screen.queryByTestId('curriculum-loose')).not.toBeInTheDocument()
    expect(lessonsOf(levels()[0]!)).toHaveLength(2)

    fireEvent.click(saveButton())
    await screen.findByText(ar.curriculum.saved, undefined, SLOW)
    const body = puts(calls)[0]!.body as CurriculumInput
    expect(body.sections.map((section) => [section.id, section.items.map((item) => item.id)])).toEqual([
      [SECTION_IDS[1], [ITEM_IDS[2], ITEM_IDS[3]]],
      [SECTION_IDS[0], [ITEM_IDS[1], ITEM_IDS[0]]],
    ])
    expect(body.looseItems).toEqual([])
  })

  it('sends nothing while nothing differs: a change changed back leaves the save button off and reports no unsaved work', async () => {
    const calls = mockCurriculumApi(() => makeCurriculum())
    const { onUnsavedChange } = renderTab()
    await screen.findByText('المستوى الأول — البداية', HEADING)

    const row = lessonsOf(levels()[0]!)[0]!
    fireEvent.click(within(row).getByLabelText(ar.curriculum.lesson.moveDown))
    expect(saveButton()).toBeEnabled()
    expect(lastReport(onUnsavedChange)).toBe(true)
    fireEvent.click(within(lessonsOf(levels()[0]!)[1]!).getByLabelText(ar.curriculum.lesson.moveUp))
    expect(saveButton()).toBeDisabled()
    expect(lastReport(onUnsavedChange)).toBe(false)

    // An added lesson removed again holds nothing either.
    fireEvent.click(within(levels()[1]!).getByText(ar.curriculum.lesson.add).closest('button')!)
    expect(saveButton()).toBeEnabled()
    fireEvent.click(within(lessonsOf(levels()[1]!)[1]!).getByLabelText(ar.curriculum.lesson.remove))
    expect(saveButton()).toBeDisabled()
    fireEvent.click(saveButton())
    expect(puts(calls)).toEqual([])
  })

  it('refuses an empty Arabic title locally and sends nothing', async () => {
    const calls = mockCurriculumApi(() => makeCurriculum())
    renderTab()
    await screen.findByText('المستوى الأول — البداية', HEADING)

    fireEvent.click(within(screen.getByTestId('curriculum-loose')).getByText(ar.curriculum.lesson.add).closest('button')!)
    fireEvent.click(saveButton())
    expect(await screen.findByText(ar.curriculum.fixErrors)).toBeInTheDocument()
    expect(within(lessonsOf(screen.getByTestId('curriculum-loose'))[1]!).getByText(ar.curriculum.validation.titleArRequired)).toBeInTheDocument()
    expect(puts(calls)).toEqual([])
  })

  it('never deletes a lesson learners have progress on, and puts back a lesson the server refused to delete (409 lesson_has_progress)', async () => {
    const calls = mockCurriculumApi(
      () => makeCurriculum(),
      () => jsonResponse(409, { statusCode: 409, error: 'Conflict', code: 'lesson_has_progress', message: 'progress', itemIds: [ITEM_IDS[0]] }),
    )
    renderTab()
    await screen.findByText('المستوى الأول — البداية', HEADING)

    const [first, withProgress] = lessonsOf(levels()[0]!)
    expect(within(withProgress!).getByLabelText(ar.curriculum.lesson.remove)).toBeDisabled()
    expect(within(withProgress!).getByText(ar.curriculum.lesson.removeBlocked)).toBeInTheDocument()
    expect(within(withProgress!).getByText('تقدّم لدى 3 طلاب')).toBeInTheDocument()
    expect(within(levels()[0]!).getByLabelText(ar.curriculum.level.remove)).toBeDisabled()

    // This one had no progress when the curriculum was read; a learner opened it meanwhile.
    fireEvent.click(within(first!).getByLabelText(ar.curriculum.lesson.remove))
    expect(lessonsOf(levels()[0]!)).toHaveLength(1)
    fireEvent.click(saveButton())

    expect(await screen.findByText(ar.curriculum.progressRestored, undefined, SLOW)).toBeInTheDocument()
    expect((puts(calls)[0]!.body as CurriculumInput).sections[0]!.items.map((item) => item.id)).toEqual([ITEM_IDS[1]])
    const rows = lessonsOf(levels()[0]!)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('data-refused', 'true')
    expect(within(rows[0]!).getByLabelText<HTMLInputElement>(ar.curriculum.lesson.fields.titleAr).value).toBe('المتغيرات')
    expect(within(rows[0]!).getByText(ar.curriculum.lesson.refused)).toBeInTheDocument()
    expect(within(rows[0]!).getByLabelText(ar.curriculum.lesson.remove)).toBeDisabled()
    expect(puts(calls)).toHaveLength(1)
  })

  it('opens the content of a saved lesson (API-228) and shows the answer in its row; a new lesson gets its content after the save', async () => {
    const calls = mockCurriculumApi(
      () => makeCurriculum(),
      () => jsonResponse(200, { ...makeCurriculum().sections[1]!.items[0]!, kind: 'pdf', content: { url: 'https://cdn.example.org/loops.pdf' }, completionMode: 'manual', durationSeconds: null }),
    )
    const { onUnsavedChange } = renderTab()
    await screen.findByText('المستوى الأول — البداية', HEADING)

    fireEvent.click(within(levels()[1]!).getByText(ar.curriculum.lesson.add).closest('button')!)
    expect(within(lessonsOf(levels()[1]!)[1]!).getByText(ar.curriculum.lesson.content).closest('button')).toBeDisabled()
    fireEvent.click(within(lessonsOf(levels()[1]!)[1]!).getByLabelText(ar.curriculum.lesson.remove))

    fireEvent.click(within(lessonsOf(levels()[1]!)[0]!).getByText(ar.curriculum.lesson.content).closest('button')!)
    const dialog = (await screen.findByText('محتوى الدرس: الحلقات')).closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByLabelText<HTMLInputElement>(ar.curriculum.content.url).value).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.curriculum.content.kind))
    fireEvent.click((await screen.findAllByText(ar.curriculum.kinds.pdf, { selector: '.ant-select-item-option-content' })).at(-1)!)
    await within(dialog).findByText(ar.curriculum.content.urlHints.pdf)
    fireEvent.change(within(dialog).getByLabelText(ar.curriculum.content.url), { target: { value: 'https://cdn.example.org/loops.pdf' } })
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)

    expect(await within(lessonsOf(levels()[1]!)[0]!).findByText(ar.curriculum.kinds.pdf, undefined, SLOW)).toBeInTheDocument()
    expect(puts(calls).map((call) => call.url)).toEqual([`/api/courses/${COURSE_ID}/curriculum/items/${ITEM_IDS[2]}/content`])
    expect(puts(calls)[0]!.body).toEqual({ kind: 'pdf', content: { url: 'https://cdn.example.org/loops.pdf' }, resources: [] })
    // The structure itself is untouched: nothing to save.
    expect(saveButton()).toBeDisabled()
    expect(lastReport(onUnsavedChange)).toBe(false)
  })

  it('LRN-T06 — a new lesson is a draft without content; «نشر المستوى» publishes that level in the draft only, then ONE PUT sends the flags', async () => {
    const calls = mockCurriculumApi(
      () => makeCurriculum(),
      () => jsonResponse(200, makeCurriculum()),
    )
    renderTab()
    await screen.findByText('المستوى الأول — البداية', HEADING)
    expect(screen.getByTestId('curriculum-publish-hint')).toHaveTextContent(ar.curriculum.publishHint)
    // Every lesson of the first level is published: nothing to publish there.
    expect(within(levels()[0]!).getByText(ar.curriculum.level.publish).closest('button')).toBeDisabled()

    fireEvent.click(within(levels()[1]!).getByText(ar.curriculum.lesson.add).closest('button')!)
    const row = lessonsOf(levels()[1]!)[1]!
    expect(within(row).getByLabelText(ar.curriculum.lesson.fields.published)).not.toBeChecked()
    expect(within(row).getByText(ar.curriculum.lesson.unpublished)).toBeInTheDocument()
    expect(within(row).getByText(ar.curriculum.noContent)).toBeInTheDocument()
    fireEvent.change(within(row).getByLabelText(ar.curriculum.lesson.fields.titleAr), { target: { value: 'الدوال' } })

    const publish = within(levels()[1]!).getByText(ar.curriculum.level.publish).closest('button')!
    expect(publish).toBeEnabled()
    fireEvent.click(publish)
    expect(within(lessonsOf(levels()[1]!)[1]!).getByLabelText(ar.curriculum.lesson.fields.published)).toBeChecked()
    expect(within(lessonsOf(levels()[1]!)[1]!).queryByText(ar.curriculum.lesson.unpublished)).not.toBeInTheDocument()
    expect(within(levels()[1]!).getByText(ar.curriculum.level.publish).closest('button')).toBeDisabled()
    // Only the draft changed: nothing was sent yet, and the lesson outside the levels is still a draft.
    expect(puts(calls)).toEqual([])
    expect(within(lessonsOf(screen.getByTestId('curriculum-loose'))[0]!).getByText(ar.curriculum.lesson.unpublished)).toBeInTheDocument()

    fireEvent.click(saveButton())
    await screen.findByText(ar.curriculum.saved, undefined, SLOW)
    expect(puts(calls)).toHaveLength(1)
    const body = puts(calls)[0]!.body as CurriculumInput
    expect(body.sections[1]!.items).toEqual([
      { id: ITEM_IDS[2], title: { ar: 'الحلقات', en: 'Loops', tr: 'Döngüler' }, isRequired: true, isPublished: true },
      { title: { ar: 'الدوال' }, isRequired: true, isPublished: true },
    ])
    expect(body.looseItems).toEqual([{ id: ITEM_IDS[3], title: { ar: 'مراجعة' }, isRequired: false, isPublished: false }])
  })

  it('LRN-T06 — «نشر الكل» publishes every lesson, the ones outside the levels too, and is off once nothing is left to publish', async () => {
    const calls = mockCurriculumApi(
      () => makeCurriculum(),
      () => jsonResponse(200, makeCurriculum()),
    )
    renderTab()
    await screen.findByText('المستوى الأول — البداية', HEADING)
    const toolbar = screen.getByTestId('curriculum-toolbar')
    const publishAll = () => within(toolbar).getByText(ar.curriculum.publishAll).closest('button')!

    expect(publishAll()).toBeEnabled()
    fireEvent.click(publishAll())
    expect(publishAll()).toBeDisabled()
    expect(within(lessonsOf(screen.getByTestId('curriculum-loose'))[0]!).getByLabelText(ar.curriculum.lesson.fields.published)).toBeChecked()
    expect(puts(calls)).toEqual([])

    fireEvent.click(saveButton())
    await screen.findByText(ar.curriculum.saved, undefined, SLOW)
    expect(puts(calls)).toHaveLength(1)
    const body = puts(calls)[0]!.body as CurriculumInput
    expect([...body.sections.flatMap((section) => section.items), ...body.looseItems!].map((item) => item.isPublished)).toEqual([true, true, true, true])
    expect(body.looseItems).toEqual([{ id: ITEM_IDS[3], title: { ar: 'مراجعة' }, isRequired: false, isPublished: true }])
  })

  it('LRN-T06 — sends a level’s «opens after … days» in the body, refuses a value out of 0..365 locally, and shows when a level opens', async () => {
    const stored = makeCurriculum()
    const saved = makeCurriculum({ sections: [stored.sections[0]!, { ...stored.sections[1]!, releaseAfterDays: 14 }] })
    const calls = mockCurriculumApi(
      () => saved,
      () => jsonResponse(200, saved),
    )
    renderTab()
    await screen.findByText('المستوى الأول — البداية', HEADING)
    // The second level opens 14 days after the class starts; the first at once (no tag, an empty field).
    expect(within(levels()[1]!).getByTestId('curriculum-release')).toHaveTextContent('يُفتح بعد 14 يوماً من بدء الفصل')
    expect(within(levels()[0]!).queryByTestId('curriculum-release')).not.toBeInTheDocument()
    const days = (level: HTMLElement) => within(level).getByLabelText<HTMLInputElement>(ar.curriculum.level.releaseAfterDays)
    expect(days(levels()[0]!).value).toBe('')
    expect(days(levels()[0]!)).toHaveAttribute('placeholder', ar.curriculum.level.releasePlaceholder)
    expect(days(levels()[1]!).value).toBe('14')

    fireEvent.change(days(levels()[0]!), { target: { value: '400' } })
    fireEvent.click(saveButton())
    expect(await within(levels()[0]!).findByText(ar.curriculum.validation.releaseDays.replace('{{max}}', '365'))).toBeInTheDocument()
    expect(puts(calls)).toEqual([])

    fireEvent.change(days(levels()[0]!), { target: { value: '0' } })
    expect(within(levels()[0]!).getByTestId('curriculum-release')).toHaveTextContent(ar.curriculum.level.releaseOnStart)
    fireEvent.change(days(levels()[1]!), { target: { value: '' } })
    fireEvent.click(saveButton())
    await screen.findByText(ar.curriculum.saved, undefined, SLOW)
    const body = puts(calls)[0]!.body as CurriculumInput
    expect(body.sections[0]).toMatchObject({ id: SECTION_IDS[0], releaseAfterDays: 0 })
    // Emptied = open at once: the value is absent from the body (absent = null on the server).
    expect(body.sections[1]).not.toHaveProperty('releaseAfterDays')
    expect(puts(calls)).toHaveLength(1)
  })

  it('LRN-T06 — names the class sessions linked to a lesson, and opens the learner preview in a new tab only while nothing is unsaved', async () => {
    const stored = makeCurriculum()
    const [first, second] = stored.sections[0]!.items
    mockCurriculumApi(() => makeCurriculum({ sections: [{ ...stored.sections[0]!, items: [{ ...first!, sessionCount: 3 }, { ...second!, sessionCount: 1 }] }, stored.sections[1]!] }))
    renderTab()
    await screen.findByText('المستوى الأول — البداية', HEADING)
    const [withThree, withOne] = lessonsOf(levels()[0]!)
    expect(within(withThree!).getByTestId('curriculum-session-count')).toHaveTextContent('3 حصص')
    expect(within(withOne!).getByTestId('curriculum-session-count')).toHaveTextContent('حصة واحدة')
    // No session linked: no tag.
    expect(within(lessonsOf(levels()[1]!)[0]!).queryByTestId('curriculum-session-count')).not.toBeInTheDocument()

    const preview = () => within(screen.getByTestId('curriculum-toolbar')).getByText(ar.curriculum.preview).closest('a')!
    expect(preview()).toHaveAttribute('href', `/learn/${COURSE_ID}/preview`)
    expect(preview()).toHaveAttribute('target', '_blank')
    expect(preview()).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByTestId('curriculum-preview-hint')).not.toBeInTheDocument()

    // A draft that differs: the preview (of the saved curriculum) waits for the save.
    fireEvent.click(within(withThree!).getByLabelText(ar.curriculum.lesson.fields.required))
    expect(preview()).toHaveAttribute('aria-disabled', 'true')
    expect(preview()).not.toHaveAttribute('href')
    expect(screen.getByTestId('curriculum-preview-hint')).toHaveTextContent(ar.curriculum.previewSaveFirst)
    // Changed back: available again.
    fireEvent.click(within(lessonsOf(levels()[0]!)[0]!).getByLabelText(ar.curriculum.lesson.fields.required))
    expect(preview()).toHaveAttribute('href', `/learn/${COURSE_ID}/preview`)
    expect(screen.queryByTestId('curriculum-preview-hint')).not.toBeInTheDocument()
  })

  it('shows a teacher (canManage false) the curriculum read-only, without any editor', async () => {
    mockCurriculumApi(() => makeCurriculum({ canManage: false }))
    renderTab()

    expect(await screen.findByText(ar.curriculum.readOnly)).toBeInTheDocument()
    expect(screen.getByText('المستوى الأول — البداية', HEADING)).toBeInTheDocument()
    expect(screen.getByText('الشروط')).toBeInTheDocument()
    expect(screen.getByText(ar.curriculum.loose.title)).toBeInTheDocument()
    expect(screen.queryByText(ar.curriculum.save)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.curriculum.level.add)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.curriculum.lesson.content)).not.toBeInTheDocument()
    expect(screen.queryAllByRole('textbox')).toEqual([])
  })

  it('words a 404 as «available to who manages or teaches the course», and offers a retry after any other failure', async () => {
    mockCurriculumApi(() => jsonResponse(404, { statusCode: 404, error: 'Not Found', code: 'course_not_found', message: 'no' }))
    const { unmount } = renderWithProviders(<CurriculumTab courseId={COURSE_ID} />, { auth: makeAuth({ user: makeUser({ permissions: ['courses.read'] }) }) })
    expect(await screen.findByText(ar.curriculum.notAvailable)).toBeInTheDocument()
    expect(screen.queryByText(ar.curriculum.retry)).not.toBeInTheDocument()
    unmount()

    let failing = true
    mockCurriculumApi(() => (failing ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : makeCurriculum()))
    renderWithProviders(<CurriculumTab courseId={COURSE_ID} />, { auth: makeAuth({ user: makeUser({ permissions: COURSE_MANAGER_PERMISSIONS }) }) })
    expect(await screen.findByText(ar.curriculum.loadError)).toBeInTheDocument()
    failing = false
    fireEvent.click(screen.getByText(ar.curriculum.retry).closest('button')!)
    expect(await screen.findByText('المستوى الأول — البداية', HEADING)).toBeInTheDocument()
  })
})
