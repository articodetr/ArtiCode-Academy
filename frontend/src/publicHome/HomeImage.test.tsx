// Homepage images: one picture of /home — its source from the page's API-205 reading, the frame kept while it
// loads, and the fall back to the built-in default once when the academy's own picture fails to load.
import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicHomepageImages } from '../api/academy'
import { HomeImage } from './HomeImage'
import { HOME_IMAGES } from './homeImages'
import { HOME_IMAGE_PLACEHOLDER } from './homeImages.view'
import type { HomeImagesReading } from './homeImages.view'
import { HomeImagesContext } from './homeImagesContext'

// The client's apiUrl() behind an API origin a test may set: the real one reads VITE_API_BASE_URL once, when it loads.
const api = vi.hoisted(() => ({ origin: '' }))
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, apiUrl: (path: string) => `${api.origin}${actual.apiUrl(path)}` }
})

const FIRST = '/api/academy/media/0123456789abcdef0123456789abcdef.webp'
const SECOND = '/api/academy/media/fedcba9876543210fedcba9876543210.png'
const NONE: PublicHomepageImages = { heroStudent: null, aboutLearners: null, promoTraining: null, whyClassroom: null }

function reading(images: Partial<PublicHomepageImages> | null, loading = false): HomeImagesReading {
  return { academy: loading ? null : { homepageImages: images ? { ...NONE, ...images } : images }, loading }
}

function hero(value: HomeImagesReading | null) {
  return (
    <HomeImagesContext value={value}>
      <HomeImage place="heroStudent" alt="" width={760} height={981} decoding="async" fetchPriority="high" />
    </HomeImagesContext>
  )
}

const img = () => document.querySelector<HTMLImageElement>('img[data-home-image="heroStudent"]')!

describe('HomeImage', () => {
  afterEach(() => {
    api.origin = ''
  })

  it('asks the API’s origin for the academy’s picture through apiUrl(), and falls back to the web app’s default', () => {
    api.origin = 'https://api.academy.example'
    render(hero(reading({ heroStudent: FIRST })))
    expect(img()).toHaveAttribute('src', `https://api.academy.example${FIRST}`)

    fireEvent.error(img())
    expect(img()).toHaveAttribute('src', HOME_IMAGES.heroStudent)
  })

  it('keeps the default and the loading pixel on the web app when the API lives elsewhere', () => {
    api.origin = 'https://api.academy.example'
    const { rerender } = render(hero(reading(null, true)))
    expect(img()).toHaveAttribute('src', HOME_IMAGE_PLACEHOLDER)
    rerender(hero(reading(null)))
    expect(img()).toHaveAttribute('src', HOME_IMAGES.heroStudent)
  })

  it('shows the academy’s own picture with the attributes of its band', () => {
    render(hero(reading({ heroStudent: FIRST })))

    expect(img()).toHaveAttribute('src', FIRST)
    expect(img()).toHaveAttribute('alt', '')
    expect(img()).toHaveAttribute('width', '760')
    expect(img()).toHaveAttribute('height', '981')
    expect(img()).toHaveAttribute('decoding', 'async')
    expect(img()).toHaveAttribute('fetchpriority', 'high')
  })

  it('shows the default without the academy’s own picture, and without a provider at all', () => {
    const { unmount } = render(hero(reading(null)))
    expect(img()).toHaveAttribute('src', HOME_IMAGES.heroStudent)
    unmount()

    render(<HomeImage place="whyClassroom" alt="" width={800} height={760} loading="lazy" decoding="async" />)
    const why = document.querySelector('img[data-home-image="whyClassroom"]')
    expect(why).toHaveAttribute('src', HOME_IMAGES.whyClassroom)
    expect(why).toHaveAttribute('loading', 'lazy')
  })

  it('keeps the frame with a transparent pixel while API-205 loads, then shows the answer — never the default first', () => {
    const { rerender } = render(hero(reading(null, true)))
    expect(img()).toHaveAttribute('src', HOME_IMAGE_PLACEHOLDER)
    expect(img()).toHaveAttribute('width', '760')
    expect(img()).toHaveAttribute('height', '981')

    // The pixel never "fails" into the default.
    fireEvent.error(img())
    expect(img()).toHaveAttribute('src', HOME_IMAGE_PLACEHOLDER)

    rerender(hero(reading({ heroStudent: FIRST })))
    expect(img()).toHaveAttribute('src', FIRST)
  })

  it('falls back to the default once when the academy’s picture fails to load — no loop when the default fails too', () => {
    render(hero(reading({ heroStudent: FIRST })))

    fireEvent.error(img())
    expect(img()).toHaveAttribute('src', HOME_IMAGES.heroStudent)

    fireEvent.error(img())
    fireEvent.error(img())
    expect(img()).toHaveAttribute('src', HOME_IMAGES.heroStudent)
  })

  it('leaves a failing default as it is', () => {
    render(hero(reading(null)))
    fireEvent.error(img())
    expect(img()).toHaveAttribute('src', HOME_IMAGES.heroStudent)
  })

  it('tries a new picture afresh when the address changes, even one that failed before', () => {
    const { rerender } = render(hero(reading({ heroStudent: FIRST })))
    fireEvent.error(img())
    expect(img()).toHaveAttribute('src', HOME_IMAGES.heroStudent)

    rerender(hero(reading({ heroStudent: SECOND })))
    expect(img()).toHaveAttribute('src', SECOND)
    fireEvent.error(img())
    expect(img()).toHaveAttribute('src', HOME_IMAGES.heroStudent)

    rerender(hero(reading({ heroStudent: FIRST })))
    expect(img()).toHaveAttribute('src', FIRST)

    // Back to the default (the picture was restored): the default, and a new academy picture is tried again.
    rerender(hero(reading(null)))
    expect(img()).toHaveAttribute('src', HOME_IMAGES.heroStudent)
    rerender(hero(reading({ heroStudent: SECOND })))
    expect(img()).toHaveAttribute('src', SECOND)
  })
})
