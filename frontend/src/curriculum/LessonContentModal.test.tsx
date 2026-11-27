// MOD-20 — the content of one lesson (LessonContentModal, TEST-252): the fields of each kind, the local rules that
// mirror the server's (https only, a YouTube link that names a video, a file video's length), the exact API-228
// body, the length read from the media's metadata, and the problems of a 400 content_invalid listed under the form.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CurriculumItem, LessonContentInput } from '../api/curriculum'
import { ar } from '../i18n/ar'
import { COURSE_ID, COURSE_MANAGER_PERMISSIONS } from '../test/courses'
import { ITEM_IDS, makeCurriculumItem } from '../test/curriculum'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { LessonContentModal } from './LessonContentModal'

const c = ar.curriculum.content

/** Every PUT is recorded and answered by `answer` (by default the lesson with the sent kind). */
function mockContentApi(answer?: (body: LessonContentInput) => Response) {
  const bodies: LessonContentInput[] = []
  const urls: string[] = []
  mockFetch((url, init) => {
    const body = JSON.parse(String(init?.body)) as LessonContentInput
    bodies.push(body)
    urls.push(`${init?.method} ${url}`)
    return answer ? answer(body) : jsonResponse(200, makeCurriculumItem({ kind: body.kind, updatedAt: '2026-11-19T12:00:00.000Z' }))
  })
  return { bodies, urls }
}

function renderModal(item: CurriculumItem = makeCurriculumItem()) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<LessonContentModal courseId={COURSE_ID} item={item} title="المتغيرات" onSaved={onSaved} onClose={onClose} />, {
    auth: makeAuth({ user: makeUser({ permissions: COURSE_MANAGER_PERMISSIONS }) }),
    route: '/courses',
  })
  return { onSaved, onClose }
}

const dialog = () => screen.getByText('محتوى الدرس: المتغيرات').closest('[role="dialog"]') as HTMLElement

/** Picks a Select option; the field may appear a moment after the kind changed (the form watches it). */
async function choose(label: string, option: string) {
  fireEvent.mouseDown(await within(dialog()).findByLabelText(label))
  const options = await screen.findAllByText(option, { selector: '.ant-select-item-option-content' })
  fireEvent.click(options.at(-1)!)
}

const type = (label: string, value: string) => fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } })
const save = () => fireEvent.click(within(dialog()).getByText(ar.common.save).closest('button')!)

describe('LessonContentModal (MOD-20)', () => {
  it('shows the fields of each kind', async () => {
    mockContentApi()
    renderModal()
    const inDialog = () => within(dialog())

    expect(inDialog().getByLabelText(c.bodyAr)).toBeInTheDocument()
    expect(inDialog().getByText(c.plainText)).toBeInTheDocument()
    expect(inDialog().queryByLabelText(c.url)).not.toBeInTheDocument()

    await choose(c.kind, ar.curriculum.kinds.video)
    expect(await inDialog().findByLabelText(c.provider)).toBeInTheDocument()
    expect(inDialog().getByLabelText(c.url)).toBeInTheDocument()
    expect(inDialog().getByLabelText(c.durationMinutes)).toBeInTheDocument()
    expect(inDialog().getByText(c.durationRequiredHint)).toBeInTheDocument()
    expect(inDialog().getByText(c.detectDuration)).toBeInTheDocument()
    expect(inDialog().getByText(c.captions)).toBeInTheDocument()
    expect(inDialog().queryByLabelText(c.bodyAr)).not.toBeInTheDocument()

    await choose(c.provider, c.providers.youtube)
    expect(await inDialog().findByText(c.durationOptionalHint)).toBeInTheDocument()
    expect(inDialog().queryByText(c.captions)).not.toBeInTheDocument()
    expect(inDialog().queryByText(c.detectDuration)).not.toBeInTheDocument()

    await choose(c.kind, ar.curriculum.kinds.audio)
    expect(await inDialog().findByText(c.durationRequiredHint)).toBeInTheDocument()
    expect(inDialog().queryByLabelText(c.provider)).not.toBeInTheDocument()

    await choose(c.kind, ar.curriculum.kinds.pdf)
    expect(await inDialog().findByText(c.urlHints.pdf)).toBeInTheDocument()
    expect(inDialog().queryByLabelText(c.durationMinutes)).not.toBeInTheDocument()

    await choose(c.kind, ar.curriculum.kinds.image)
    expect(await inDialog().findByLabelText(c.altAr)).toBeInTheDocument()

    await choose(c.kind, ar.curriculum.kinds.file)
    expect(await inDialog().findByLabelText(c.fileName)).toBeInTheDocument()

    await choose(c.kind, ar.curriculum.kinds.live)
    expect(await inDialog().findByLabelText(c.noteAr)).toBeInTheDocument()
    expect(inDialog().queryByLabelText(c.url)).not.toBeInTheDocument()
    // Resources belong to every kind.
    expect(inDialog().getByText(c.addResource)).toBeInTheDocument()
  })

  it('saves a text lesson with ONE PUT of the kind, the body and the resources, Turkish kept, and hands back the answer', async () => {
    const { bodies, urls } = mockContentApi()
    const { onSaved } = renderModal(makeCurriculumItem({ content: { body: { ar: 'مرحباً', tr: 'Merhaba' } } }))
    expect(within(dialog()).getByLabelText<HTMLTextAreaElement>(c.bodyAr).value).toBe('مرحباً')

    type(c.bodyEn, 'Hello')
    fireEvent.click(within(dialog()).getByText(c.addResource).closest('button')!)
    type(c.resourceTitleAr, 'ملخص الدرس')
    type(c.resourceUrl, ' https://cdn.example.org/summary.pdf ')
    save()

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(urls).toEqual([`PUT /api/courses/${COURSE_ID}/curriculum/items/${ITEM_IDS[0]}/content`])
    expect(bodies).toEqual([
      { kind: 'text', content: { body: { ar: 'مرحباً', en: 'Hello', tr: 'Merhaba' } }, resources: [{ title: { ar: 'ملخص الدرس' }, url: 'https://cdn.example.org/summary.pdf' }] },
    ])
    expect(onSaved.mock.calls[0]![0]).toMatchObject({ id: ITEM_IDS[0], kind: 'text' })
  })

  it('refuses an http link and a YouTube link without a video before any request, then sends the YouTube video', async () => {
    const { bodies } = mockContentApi()
    const { onSaved } = renderModal()

    await choose(c.kind, ar.curriculum.kinds.pdf)
    await within(dialog()).findByLabelText(c.url)
    type(c.url, 'http://cdn.example.org/a.pdf')
    save()
    expect(await within(dialog()).findByText(c.validation.https)).toBeInTheDocument()

    await choose(c.kind, ar.curriculum.kinds.video)
    await choose(c.provider, c.providers.youtube)
    await within(dialog()).findByText(c.durationOptionalHint)
    type(c.url, 'https://www.youtube.com/watch')
    save()
    expect(await within(dialog()).findByText(c.validation.youtube)).toBeInTheDocument()
    expect(bodies).toEqual([])

    type(c.url, 'https://youtu.be/dQw4w9WgXcQ')
    save()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(bodies).toEqual([{ kind: 'video', content: { provider: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', durationSeconds: null }, resources: [] }])
  })

  it('needs the length of a file video, reads it from the media metadata, and sends the captions', async () => {
    const { bodies } = mockContentApi()
    const { onSaved } = renderModal()

    await choose(c.kind, ar.curriculum.kinds.video)
    await within(dialog()).findByText(c.durationRequiredHint)
    type(c.url, 'https://cdn.example.org/lesson.mp4')
    save()
    expect(await within(dialog()).findByText(c.validation.durationRequired)).toBeInTheDocument()

    fireEvent.click(within(dialog()).getByText(c.detectDuration).closest('button')!)
    const probe = await screen.findByTestId('duration-probe')
    expect(probe.tagName).toBe('VIDEO')
    expect(probe).toHaveAttribute('preload', 'metadata')
    expect(probe).toHaveAttribute('src', 'https://cdn.example.org/lesson.mp4')
    Object.defineProperty(probe, 'duration', { configurable: true, value: 125.4 })
    fireEvent.loadedMetadata(probe)
    await waitFor(() => expect(within(dialog()).getByLabelText<HTMLInputElement>(c.durationMinutes).value).toBe('2.08'))
    expect(within(dialog()).getByText('2:05', { selector: '.ant-typography-success bdi' })).toBeInTheDocument()

    fireEvent.click(within(dialog()).getByText(c.addCaption).closest('button')!)
    type(c.captionUrl, 'https://cdn.example.org/lesson.ar.vtt')
    save()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(bodies).toEqual([
      {
        kind: 'video',
        content: { provider: 'file', url: 'https://cdn.example.org/lesson.mp4', durationSeconds: 125, captions: [{ language: 'ar', url: 'https://cdn.example.org/lesson.ar.vtt' }] },
        resources: [],
      },
    ])
  })

  it('lists the problems of a 400 content_invalid under the form and keeps the dialog open', async () => {
    mockContentApi(() =>
      jsonResponse(400, { statusCode: 400, error: 'Bad Request', code: 'content_invalid', message: 'The content does not fit the lesson kind', problems: ['url: must be an absolute https URL'] }),
    )
    const { onSaved, onClose } = renderModal()
    await choose(c.kind, ar.curriculum.kinds.file)
    await within(dialog()).findByLabelText(c.fileName)
    type(c.url, 'https://cdn.example.org/a.zip')
    type(c.fileName, 'a.zip')
    save()

    expect(await within(dialog()).findByText(ar.curriculum.errors.content_invalid)).toBeInTheDocument()
    expect(within(screen.getByTestId('content-problems')).getByText('url: must be an absolute https URL')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('sends nothing when nothing changed and closes', async () => {
    const { bodies } = mockContentApi()
    const { onClose } = renderModal(makeCurriculumItem({ kind: 'pdf', content: { url: 'https://cdn.example.org/a.pdf' } }))
    expect(within(dialog()).getByLabelText<HTMLInputElement>(c.url).value).toBe('https://cdn.example.org/a.pdf')
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(bodies).toEqual([])
  })
})
