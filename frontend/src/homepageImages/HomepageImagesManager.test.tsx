import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomepageImages } from '../api/homepageImages'
import { ar } from '../i18n/ar'
import { HOME_IMAGE_KEYS, HOME_IMAGE_SLOTS } from '../publicHome/homeImageSlots'
import type { HomeImageKey } from '../publicHome/homeImageSlots'
import { jsonResponse, mockFetch } from '../test/http'
import { blockerStates, goBack, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { HomepageImagesManager } from './HomepageImagesManager'
import { customImage, EXE_BYTES, GIF_BYTES, jpegBytes, makeHomepageImages, pictureFile, pngBytes, SVG_BYTES, webpBytes } from './homepageImages.testData'

const T = ar.homepageImages
const MEDIA_B = '/api/academy/media/fedcba9876543210fedcba9876543210.png'

/** An Arabic text with its {{name}} values, as i18next fills it. */
const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ''))
const dims = (width: number, height: number) => `\u2066${width} × ${height}\u2069`

interface Call {
  method: string
  url: string
  body: unknown
  contentType: string | null
}

/** GET serves `state.current`; a write answers `writes(method, url)` (a 500 when none is given). */
function mockImagesApi(initial: HomepageImages, writes?: (method: string, url: string) => Response | Promise<Response>) {
  const state = { current: initial }
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body, contentType: new Headers(init?.headers).get('Content-Type') })
    if (method === 'GET') return jsonResponse(200, state.current)
    return writes ? writes(method, url) : jsonResponse(500, { statusCode: 500, message: 'unexpected write' })
  })
  return { calls, state }
}

const writesOf = (calls: Call[]) => calls.filter((call) => call.method !== 'GET')

/**
 * The preview of a chosen picture: its `data:` URL under the type read from its bytes. Never an object URL —
 * the deployed CSP refuses `blob:` pictures — so jsdom's missing URL.createObjectURL is a spy that must stay unused.
 */
const dataUrlOf = (bytes: Uint8Array, type: string) => `data:${type};base64,${btoa(String.fromCharCode(...bytes))}`

function spyObjectUrls() {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:never')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL })
  return createObjectURL
}

const MANAGER = makeAuth({ user: makeUser({ permissions: ['academy.settings.read', 'academy.settings.manage'] }) })

function renderManager() {
  return renderWithProviders(<HomepageImagesManager />, { auth: MANAGER, route: '/settings/homepage-images' })
}

const card = (key: HomeImageKey) => screen.getByTestId(`homepage-image-${key}`)
const pictureOf = (key: HomeImageKey) => card(key).querySelector('img.homepage-images__image')?.getAttribute('src')
const buttonIn = (container: HTMLElement, text: string) => within(container).getByText(text).closest('button') as HTMLButtonElement

/** Picks a file in the place's «تغيير الصورة» as the browser hands it over (antd Upload, `beforeUpload`). */
function choose(key: HomeImageKey, file: File) {
  const input = card(key).querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

async function chosen(key: HomeImageKey) {
  return within(card(key)).findByText(T.pending.marker)
}

describe('HomepageImagesManager — Settings → «صور الصفحة الرئيسية»', () => {
  beforeEach(() => {
    spyObjectUrls()
  })

  it('shows the four places in their order, each in its default or custom state, with what to upload and nothing sent', async () => {
    const { calls } = mockImagesApi(makeHomepageImages({ heroStudent: customImage('heroStudent') }))
    renderManager()

    expect(screen.getByText(T.title)).toBeInTheDocument()
    expect(screen.getByText(T.description)).toBeInTheDocument()
    const homeLink = screen.getByText(T.viewHome).closest('a') as HTMLAnchorElement
    expect(homeLink).toHaveAttribute('href', '/home')
    expect(homeLink).toHaveAttribute('target', '_blank')
    expect(homeLink.getAttribute('rel')).toContain('noopener')
    expect(screen.getByTestId('homepage-images-loading')).toBeInTheDocument()

    await screen.findByTestId('homepage-image-heroStudent')
    const order = Array.from(document.querySelectorAll('section[data-testid^="homepage-image-"]')).map((section) => section.getAttribute('data-testid'))
    expect(order).toEqual(HOME_IMAGE_KEYS.map((key) => `homepage-image-${key}`))
    for (const key of HOME_IMAGE_KEYS) expect(within(card(key)).getByRole('heading', { name: T.sections[key] })).toBeInTheDocument()

    // The hero holds the academy's own picture: «مخصّصة» with the server's date, its picture, restorable.
    const hero = card('heroStudent')
    expect(within(hero).getByText(T.status.custom)).toBeInTheDocument()
    expect(within(hero).getByText(/^آخر تغيير: /)).toBeInTheDocument()
    expect(pictureOf('heroStudent')).toBe('/api/academy/media/0123456789abcdef0123456789abcdef.png')
    expect(buttonIn(hero, T.actions.reset)).toBeEnabled()
    expect(within(hero).getByText(fill(T.recommended.transparent, { size: dims(760, 981) }))).toBeInTheDocument()
    expect(hero.querySelector('[data-testid="homepage-image-frame"]')).toHaveClass('homepage-images__frame--transparent')

    // The others show their built-in picture, «افتراضية», and nothing to restore.
    for (const key of ['aboutLearners', 'promoTraining', 'whyClassroom'] as const) {
      const place = card(key)
      expect(within(place).getByText(T.status.default)).toBeInTheDocument()
      expect(within(place).getByText(T.status.defaultHint)).toBeInTheDocument()
      expect(pictureOf(key)).toBe(HOME_IMAGE_SLOTS[key].defaultSrc)
      expect(buttonIn(place, T.actions.reset)).toBeDisabled()
      const slot = HOME_IMAGE_SLOTS[key]
      expect(within(place).getByText(fill(T.recommended.photo, { size: dims(slot.width, slot.height) }))).toBeInTheDocument()
      expect(place.querySelector('[data-testid="homepage-image-frame"]')).toHaveAttribute('data-fit', 'cover')
    }
    expect(screen.getAllByText(fill(T.recommended.maxSize, { size: '5 ميغابايت' }))).toHaveLength(4)

    // The picker takes the three types only, and nothing was written.
    expect(hero.querySelector('input[type="file"]')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
    expect(calls.map((call) => [call.method, call.url])).toEqual([['GET', '/api/academy/homepage-images']])
  })

  it('previews a chosen PNG with its warnings, then sends exactly ONE PUT with the file itself as image/png and shows the server’s answer', async () => {
    const createObjectURL = spyObjectUrls()
    let answer!: () => void
    const saved = makeHomepageImages({ heroStudent: customImage('heroStudent', { url: MEDIA_B }) })
    const { calls } = mockImagesApi(makeHomepageImages(), (method) =>
      method === 'PUT' ? new Promise<Response>((resolve) => (answer = () => resolve(jsonResponse(200, saved)))) : jsonResponse(500, {}),
    )
    renderManager()
    await screen.findByTestId('homepage-image-heroStudent')

    // Named .jpg by mistake: the type sent is the one its bytes say.
    const bytes = pngBytes({ width: 400, height: 300 })
    const file = pictureFile(bytes, 'student.jpg', 'image/jpeg')
    choose('heroStudent', file)
    await chosen('heroStudent')
    const hero = card('heroStudent')

    // The chosen picture shows in the frame in place of the published one, which is unchanged.
    expect(pictureOf('heroStudent')).toBe(dataUrlOf(bytes, 'image/png'))
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(within(hero).getByText(T.status.default)).toBeInTheDocument()
    expect(within(hero).getByText(fill(T.pending.details, { type: 'PNG', size: dims(400, 300), bytes: '1 كيلوبايت' }))).toBeInTheDocument()
    expect(within(hero).getByText(T.pending.hint)).toBeInTheDocument()
    // Warnings never block: smaller than recommended, another shape in the contain frame.
    expect(within(hero).getByText(T.warnings.title)).toBeInTheDocument()
    expect(within(hero).getByText(fill(T.warnings.small, { size: dims(760, 981) }))).toBeInTheDocument()
    expect(within(hero).getByText(T.warnings.smaller)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([])
    // Nothing to restore while a choice is pending (the place is on its default anyway).
    expect(buttonIn(hero, T.actions.reset)).toBeDisabled()

    fireEvent.click(buttonIn(hero, T.actions.save))
    await waitFor(() => expect(writesOf(calls)).toHaveLength(1))
    // While it runs: the choice cannot be cancelled or replaced.
    expect(buttonIn(hero, T.actions.cancel)).toBeDisabled()
    expect(buttonIn(hero, T.actions.change)).toBeDisabled()

    await act(async () => answer())
    expect(await within(hero).findByText(T.status.custom)).toBeInTheDocument()
    expect(within(hero).queryByText(T.pending.marker)).not.toBeInTheDocument()
    expect(pictureOf('heroStudent')).toBe(MEDIA_B)
    expect(await screen.findByText(fill(T.saved, { section: T.sections.heroStudent }))).toBeInTheDocument()

    const [put] = writesOf(calls)
    expect(put).toMatchObject({ method: 'PUT', url: '/api/academy/homepage-images/heroStudent', contentType: 'image/png' })
    expect(put!.body).toBe(file)
    expect(writesOf(calls)).toHaveLength(1)
  })

  it('«إلغاء» returns to the published picture without any request', async () => {
    const { calls } = mockImagesApi(makeHomepageImages({ aboutLearners: customImage('aboutLearners', { contentType: 'image/jpeg' }) }))
    renderManager()
    await screen.findByTestId('homepage-image-aboutLearners')

    const bytes = jpegBytes({ width: 1920, height: 1360 })
    choose('aboutLearners', pictureFile(bytes, 'class.jpg', 'image/jpeg'))
    await chosen('aboutLearners')
    expect(pictureOf('aboutLearners')).toBe(dataUrlOf(bytes, 'image/jpeg'))
    // A picture of the frame's shape and at least its size warns about nothing.
    expect(within(card('aboutLearners')).queryByText(T.warnings.title)).not.toBeInTheDocument()

    fireEvent.click(buttonIn(card('aboutLearners'), T.actions.cancel))
    await waitFor(() => expect(within(card('aboutLearners')).queryByText(T.pending.marker)).not.toBeInTheDocument())
    expect(pictureOf('aboutLearners')).toBe('/api/academy/media/0123456789abcdef0123456789abcdef.png')
    expect(within(card('aboutLearners')).queryByText(T.actions.save)).not.toBeInTheDocument()
    expect(writesOf(calls)).toEqual([])
  })

  it('refuses a renamed SVG, an empty file, a GIF, a file over 5 MB and a renamed program before any request, and keeps an earlier choice', async () => {
    const { calls } = mockImagesApi(makeHomepageImages())
    renderManager()
    await screen.findByTestId('homepage-image-promoTraining')
    const promo = () => card('promoTraining')

    choose('promoTraining', pictureFile(SVG_BYTES, 'logo.png', 'image/png'))
    expect(await within(promo()).findByText(T.refused.unsupported)).toBeInTheDocument()
    expect(within(promo()).getByText(T.refused.title)).toBeInTheDocument()

    choose('promoTraining', pictureFile(new Uint8Array(), 'empty.png', 'image/png'))
    expect(await within(promo()).findByText(T.refused.empty)).toBeInTheDocument()

    choose('promoTraining', pictureFile(GIF_BYTES, 'anim.gif', 'image/gif'))
    expect(await within(promo()).findByText(T.refused.unsupported)).toBeInTheDocument()

    const huge = pictureFile(pngBytes(), 'huge.png', 'image/png')
    Object.defineProperty(huge, 'size', { value: 6_000_000 })
    choose('promoTraining', huge)
    expect(await within(promo()).findByText(fill(T.refused.tooLarge, { size: '5.8 ميغابايت', max: '5 ميغابايت' }))).toBeInTheDocument()

    choose('promoTraining', pictureFile(EXE_BYTES, 'photo.png', 'image/png'))
    expect(await within(promo()).findByText(T.refused.unsupported)).toBeInTheDocument()

    expect(within(promo()).queryByText(T.pending.marker)).not.toBeInTheDocument()
    expect(pictureOf('promoTraining')).toBe(HOME_IMAGE_SLOTS.promoTraining.defaultSrc)

    // A valid choice, then a refused one: the valid choice stays, the refusal is told beside it.
    const promoBytes = webpBytes({ width: 900, height: 560 })
    choose('promoTraining', pictureFile(promoBytes, 'promo.webp', 'image/webp'))
    await chosen('promoTraining')
    expect(within(promo()).queryByText(T.refused.unsupported)).not.toBeInTheDocument()
    choose('promoTraining', pictureFile(SVG_BYTES, 'promo.svg', 'image/svg+xml'))
    expect(await within(promo()).findByText(T.refused.unsupported)).toBeInTheDocument()
    expect(within(promo()).getByText(T.pending.marker)).toBeInTheDocument()
    expect(pictureOf('promoTraining')).toBe(dataUrlOf(promoBytes, 'image/webp'))

    expect(writesOf(calls)).toEqual([])
  })

  it('keeps the chosen picture and the published one when the server refuses the save, and saves on a retry', async () => {
    const answers = [
      () => jsonResponse(503, { statusCode: 503, code: 'media_storage_unavailable', message: 'storage' }),
      () => jsonResponse(200, makeHomepageImages({ whyClassroom: customImage('whyClassroom', { url: MEDIA_B, contentType: 'image/jpeg' }) })),
    ]
    const { calls } = mockImagesApi(makeHomepageImages({ whyClassroom: customImage('whyClassroom', { contentType: 'image/jpeg' }) }), () => answers.shift()!())
    renderManager()
    await screen.findByTestId('homepage-image-whyClassroom')
    const why = () => card('whyClassroom')

    const bytes = jpegBytes({ width: 800, height: 760, exif: true })
    const file = pictureFile(bytes, 'class.jpeg', 'image/jpeg')
    choose('whyClassroom', file)
    await chosen('whyClassroom')

    fireEvent.click(buttonIn(why(), T.actions.save))
    expect(await within(why()).findByText(T.saveFailed)).toBeInTheDocument()
    expect(within(why()).getByText(T.errors.media_storage_unavailable)).toBeInTheDocument()
    // The choice is still there to retry or cancel; the published state did not move.
    expect(within(why()).getByText(T.pending.marker)).toBeInTheDocument()
    expect(pictureOf('whyClassroom')).toBe(dataUrlOf(bytes, 'image/jpeg'))
    expect(within(why()).getByText(T.status.custom)).toBeInTheDocument()
    expect(buttonIn(why(), T.actions.save)).toBeEnabled()

    fireEvent.click(buttonIn(why(), T.actions.save))
    await waitFor(() => expect(within(why()).queryByText(T.pending.marker)).not.toBeInTheDocument())
    expect(pictureOf('whyClassroom')).toBe(MEDIA_B)
    expect(within(why()).queryByText(T.saveFailed)).not.toBeInTheDocument()

    const puts = writesOf(calls)
    expect(puts.map((call) => [call.method, call.url, call.contentType])).toEqual([
      ['PUT', '/api/academy/homepage-images/whyClassroom', 'image/jpeg'],
      ['PUT', '/api/academy/homepage-images/whyClassroom', 'image/jpeg'],
    ])
    expect(puts[0]!.body).toBe(file)
    expect(puts[1]!.body).toBe(file)
  })

  it('names the size limit when the server (or a proxy before it) refuses a picture as too large', async () => {
    mockImagesApi(makeHomepageImages(), () => new Response(null, { status: 413 }))
    renderManager()
    await screen.findByTestId('homepage-image-promoTraining')
    choose('promoTraining', pictureFile(pngBytes({ width: 900, height: 560, colourType: 2 }), 'promo.png', 'image/png'))
    await chosen('promoTraining')
    fireEvent.click(buttonIn(card('promoTraining'), T.actions.save))
    expect(await within(card('promoTraining')).findByText(fill(T.errors.image_too_large, { max: '5 ميغابايت' }))).toBeInTheDocument()
  })

  it('restores the default behind a confirmation with ONE DELETE, then shows the server’s answer', async () => {
    const { calls } = mockImagesApi(makeHomepageImages({ promoTraining: customImage('promoTraining') }), (method) =>
      method === 'DELETE' ? jsonResponse(200, makeHomepageImages()) : jsonResponse(500, {}),
    )
    renderManager()
    await screen.findByTestId('homepage-image-promoTraining')
    const promo = () => card('promoTraining')
    expect(within(promo()).getByText(T.status.custom)).toBeInTheDocument()

    fireEvent.click(buttonIn(promo(), T.actions.reset))
    const popup = (await screen.findByText(fill(T.actions.resetConfirm, { section: T.sections.promoTraining }))).closest('.ant-popover') as HTMLElement
    expect(writesOf(calls)).toEqual([])
    fireEvent.click(buttonIn(popup, T.actions.resetOk))

    expect(await within(promo()).findByText(T.status.default)).toBeInTheDocument()
    expect(pictureOf('promoTraining')).toBe(HOME_IMAGE_SLOTS.promoTraining.defaultSrc)
    expect(buttonIn(promo(), T.actions.reset)).toBeDisabled()
    expect(await screen.findByText(fill(T.restored, { section: T.sections.promoTraining }))).toBeInTheDocument()
    expect(writesOf(calls).map((call) => [call.method, call.url, call.body])).toEqual([['DELETE', '/api/academy/homepage-images/promoTraining', undefined]])
  })

  it('runs one write at a time: another place’s save waits until the running one is answered', async () => {
    let answer!: () => void
    const { calls } = mockImagesApi(makeHomepageImages(), () => new Promise<Response>((resolve) => (answer = () => resolve(jsonResponse(200, makeHomepageImages({ heroStudent: customImage('heroStudent') }))))))
    renderManager()
    await screen.findByTestId('homepage-image-heroStudent')
    choose('heroStudent', pictureFile(webpBytes({ kind: 'VP8L', width: 760, height: 981, alpha: true }), 'hero.webp', 'image/webp'))
    choose('aboutLearners', pictureFile(jpegBytes(), 'about.jpg', 'image/jpeg'))
    await chosen('heroStudent')
    await chosen('aboutLearners')

    fireEvent.click(buttonIn(card('heroStudent'), T.actions.save))
    await waitFor(() => expect(writesOf(calls)).toHaveLength(1))
    expect(buttonIn(card('aboutLearners'), T.actions.save)).toBeDisabled()
    // Choosing stays open on the other places: it sends nothing.
    expect(buttonIn(card('aboutLearners'), T.actions.change)).toBeEnabled()

    await act(async () => answer())
    await waitFor(() => expect(buttonIn(card('aboutLearners'), T.actions.save)).toBeEnabled())
    expect(within(card('aboutLearners')).getByText(T.pending.marker)).toBeInTheDocument()
    expect(writesOf(calls)).toHaveLength(1)
  })

  it('warns the hero about a JPEG, measures a turned photo as the browser shows it, and previews it larger in the frame of its place', async () => {
    mockImagesApi(makeHomepageImages())
    renderManager()
    await screen.findByTestId('homepage-image-heroStudent')

    // Stored 981 × 760 with EXIF orientation 6 (big-endian): the browser shows it upright, 760 × 981 — the hero's shape.
    const bytes = jpegBytes({ width: 981, height: 760, orientation: 6, byteOrder: 'MM' })
    choose('heroStudent', pictureFile(bytes, 'hero.jpg', 'image/jpeg'))
    await chosen('heroStudent')
    const hero = card('heroStudent')
    expect(within(hero).getByText(fill(T.pending.details, { type: 'JPEG', size: dims(760, 981), bytes: '1 كيلوبايت' }))).toBeInTheDocument()
    expect(within(hero).getByText(T.warnings.jpegNoTransparency)).toBeInTheDocument()
    // Upright it has the frame's size and shape: the JPEG warning is the only one.
    expect(Array.from(hero.querySelectorAll('.homepage-images__warnings li')).map((item) => item.textContent)).toEqual([T.warnings.jpegNoTransparency])

    fireEvent.click(buttonIn(card('heroStudent'), T.actions.preview))
    const dialog = (await screen.findByText(fill(T.preview.title, { section: T.sections.heroStudent }))).closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(new RegExp(T.preview.pending))).toBeInTheDocument()
    const large = dialog.querySelector('img.homepage-images__image') as HTMLImageElement
    expect(large.getAttribute('src')).toBe(dataUrlOf(bytes, 'image/jpeg'))
    expect(large).toHaveAttribute('alt', fill(T.pendingAlt, { section: T.sections.heroStudent }))
    expect(dialog.querySelector('.homepage-images__stage--large')).not.toBeNull()
  })

  it('says which picture cannot be displayed: the chosen one before saving, or the published one', async () => {
    mockImagesApi(makeHomepageImages({ aboutLearners: customImage('aboutLearners') }))
    renderManager()
    await screen.findByTestId('homepage-image-heroStudent')

    fireEvent.error(card('aboutLearners').querySelector('img.homepage-images__image')!)
    expect(await within(card('aboutLearners')).findByText(T.unavailable)).toBeInTheDocument()

    choose('heroStudent', pictureFile(pngBytes(), 'hero.png', 'image/png'))
    await chosen('heroStudent')
    fireEvent.error(card('heroStudent').querySelector('img.homepage-images__image')!)
    expect(await within(card('heroStudent')).findByText(T.pendingUnavailable)).toBeInTheDocument()
    expect(within(card('heroStudent')).queryByText(T.unavailable)).not.toBeInTheDocument()
  })

  it('reports a failed first read with a retry', async () => {
    const answers = [
      () => jsonResponse(503, { statusCode: 503, code: 'academy_not_configured', message: 'seed' }),
      () => jsonResponse(200, makeHomepageImages()),
    ]
    mockFetch(() => answers.shift()!())
    renderManager()

    expect(await screen.findByText(T.loadFailed)).toBeInTheDocument()
    expect(screen.getByText(T.errors.academy_not_configured)).toBeInTheDocument()
    expect(screen.queryByTestId('homepage-image-heroStudent')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(T.retry).closest('button')!)
    expect(await screen.findByTestId('homepage-image-heroStudent')).toBeInTheDocument()
    expect(screen.queryByText(T.loadFailed)).not.toBeInTheDocument()
  })

  it('asks before leaving with a chosen picture that is not saved (browser back, reload, tab close)', async () => {
    mockImagesApi(makeHomepageImages())
    const { router } = renderInDataRouter(<HomepageImagesManager />, { auth: MANAGER, path: '/settings/homepage-images', previous: '/settings' })
    await screen.findByTestId('homepage-image-heroStudent')
    expect(unloadWouldPrompt()).toBe(false)

    choose('heroStudent', pictureFile(pngBytes(), 'hero.png', 'image/png'))
    await chosen('heroStudent')
    expect(unloadWouldPrompt()).toBe(true)

    /** The dialogs of the question asked so far (an answered one lingers in jsdom; antd shows a confirm's title twice). */
    const questions = () => [...new Set(screen.queryAllByText(T.unsaved.title).map((title) => title.closest('[role="dialog"]') as HTMLElement))]
    const answer = async (count: number, label: string) => {
      await waitFor(() => expect(questions()).toHaveLength(count))
      const dialog = questions()[count - 1]!
      await act(async () => {
        fireEvent.click(buttonIn(dialog, label))
      })
    }

    await goBack(router)
    await answer(1, T.unsaved.cancel)
    expect(router.state.location.pathname).toBe('/settings/homepage-images')
    expect(within(card('heroStudent')).getByText(T.pending.marker)).toBeInTheDocument()

    await goBack(router)
    await answer(2, T.unsaved.ok)
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/settings')
  })

  /** The notice a navigation gets while a write is in flight: its dialog, with «حسنًا» as its only button. */
  async function writingNotice() {
    const content = await screen.findByText(T.writing.content)
    const dialog = content.closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual([T.writing.ok])
    return dialog
  }

  it('holds a navigation while a save is being written with a notice to wait — never «discard and leave» — and lets it go once the save is answered', async () => {
    let answer!: () => void
    mockImagesApi(makeHomepageImages(), () => new Promise<Response>((resolve) => (answer = () => resolve(jsonResponse(200, makeHomepageImages({ heroStudent: customImage('heroStudent') }))))))
    const { router } = renderInDataRouter(<HomepageImagesManager />, { auth: MANAGER, path: '/settings/homepage-images', previous: '/settings' })
    await screen.findByTestId('homepage-image-heroStudent')
    choose('heroStudent', pictureFile(pngBytes(), 'hero.png', 'image/png'))
    await chosen('heroStudent')
    fireEvent.click(buttonIn(card('heroStudent'), T.actions.save))
    await waitFor(() => expect(buttonIn(card('heroStudent'), T.actions.cancel)).toBeDisabled())

    await goBack(router)
    const notice = await writingNotice()
    expect(screen.queryByText(T.unsaved.title)).not.toBeInTheDocument()
    expect(screen.queryByText(T.unsaved.ok)).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/settings/homepage-images')
    expect(blockerStates(router)).not.toContain('blocked')
    expect(unloadWouldPrompt()).toBe(true)
    await act(async () => {
      fireEvent.click(buttonIn(notice, T.writing.ok))
    })

    await act(async () => answer())
    expect(await within(card('heroStudent')).findByText(T.status.custom)).toBeInTheDocument()
    // Nothing chosen and nothing being written any more: leaving is free.
    expect(unloadWouldPrompt()).toBe(false)
    await goBack(router)
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
    expect(screen.queryByText(T.unsaved.title)).not.toBeInTheDocument()
  })

  it('holds a navigation while a restore is being written too, with nothing chosen', async () => {
    let answer!: () => void
    mockImagesApi(makeHomepageImages({ whyClassroom: customImage('whyClassroom') }), () => new Promise<Response>((resolve) => (answer = () => resolve(jsonResponse(200, makeHomepageImages())))))
    const { router } = renderInDataRouter(<HomepageImagesManager />, { auth: MANAGER, path: '/settings/homepage-images', previous: '/settings' })
    await screen.findByTestId('homepage-image-whyClassroom')

    fireEvent.click(buttonIn(card('whyClassroom'), T.actions.reset))
    const popup = (await screen.findByText(fill(T.actions.resetConfirm, { section: T.sections.whyClassroom }))).closest('.ant-popover') as HTMLElement
    fireEvent.click(buttonIn(popup, T.actions.resetOk))
    await waitFor(() => expect(card('whyClassroom').querySelector('.ant-btn-loading')).not.toBeNull())

    await goBack(router)
    await writingNotice()
    expect(screen.queryByText(T.unsaved.title)).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/settings/homepage-images')

    await act(async () => answer())
    expect(await within(card('whyClassroom')).findByText(T.status.default)).toBeInTheDocument()
    await goBack(router)
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
  })
})
