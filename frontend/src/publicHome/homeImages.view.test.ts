// Homepage images: where each picture of /home comes from — the academy's own (API-205 `homepageImages`), the
// built-in default, or nothing while API-205 loads.
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { HomepageImageKey, PublicHomepageImages } from '../api/academy'
import { HOME_IMAGES } from './homeImages'
import { HOME_IMAGE_KEYS, HOME_IMAGE_SLOTS } from './homeImageSlots'
import type { HomeImageKey } from './homeImageSlots'
import { HOME_IMAGE_PLACEHOLDER, HOME_MEDIA_PATH_PREFIX, academyHomeImageUrl, defaultHomeImageSrc, homeImageSrc } from './homeImages.view'
import type { HomeImagesReading } from './homeImages.view'

const HERO_URL = '/api/academy/media/0123456789abcdef0123456789abcdef.webp'
const WHY_URL = '/api/academy/media/fedcba9876543210fedcba9876543210.jpg'

const NONE: PublicHomepageImages = { heroStudent: null, aboutLearners: null, promoTraining: null, whyClassroom: null }

/** API-205 has answered: with the given places (the others null), with `null`, or without the field (an older server). */
function answered(homepageImages?: Partial<PublicHomepageImages> | null): HomeImagesReading {
  const images = homepageImages === undefined || homepageImages === null ? homepageImages : { ...NONE, ...homepageImages }
  return { academy: { homepageImages: images }, loading: false }
}

describe('homeImages.view', () => {
  it('keeps the keys of the API and of the slots the same, each slot defaulting to its built-in picture', () => {
    expectTypeOf<HomeImageKey>().toEqualTypeOf<HomepageImageKey>()
    expect(HOME_IMAGE_KEYS).toEqual(['heroStudent', 'aboutLearners', 'promoTraining', 'whyClassroom'])
    for (const key of HOME_IMAGE_KEYS) {
      expect(defaultHomeImageSrc(key)).toBe(HOME_IMAGES[key])
      expect(HOME_IMAGE_SLOTS[key].defaultSrc).toBe(HOME_IMAGES[key])
    }
  })

  it('shows the default of every place without the academy’s own pictures', () => {
    for (const key of HOME_IMAGE_KEYS) {
      // No reading at all (a band outside /home), an older server, an explicit null, a null place.
      expect(homeImageSrc(key, null)).toBe(HOME_IMAGES[key])
      expect(homeImageSrc(key, undefined)).toBe(HOME_IMAGES[key])
      expect(homeImageSrc(key, answered())).toBe(HOME_IMAGES[key])
      expect(homeImageSrc(key, answered(null))).toBe(HOME_IMAGES[key])
      expect(homeImageSrc(key, answered({}))).toBe(HOME_IMAGES[key])
    }
  })

  it('uses the academy’s own picture of a place, and the defaults of the others', () => {
    const reading = answered({ heroStudent: HERO_URL, whyClassroom: WHY_URL })
    expect(homeImageSrc('heroStudent', reading)).toBe(HERO_URL)
    expect(homeImageSrc('whyClassroom', reading)).toBe(WHY_URL)
    expect(homeImageSrc('aboutLearners', reading)).toBe(HOME_IMAGES.aboutLearners)
    expect(homeImageSrc('promoTraining', reading)).toBe(HOME_IMAGES.promoTraining)
  })

  it('ignores any address that is not the academy’s own media route', () => {
    const unsafe: unknown[] = [
      'https://cdn.example.com/hero.png',
      'http://localhost:3000/api/academy/media/0123456789abcdef0123456789abcdef.png',
      '//evil.example/api/academy/media/a.png',
      'javascript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=',
      'api/academy/media/a.png',
      './api/academy/media/a.png',
      '/api/academy/media/',
      '/api/academy/media/../users',
      '/api/academy/media/%2e%2e/users',
      '/api/academy/media/a/b.png',
      '/api/academy/media/a\\b.png',
      '/api/academy/media/a.png?download=1',
      '/api/academy/media/a.png#x',
      ' /api/academy/media/a.png',
      '/api/academy/media/a.png ',
      '/api/academy/mediaa.png',
      '/API/academy/media/a.png',
      `/api/academy/media/${'a'.repeat(129)}`,
      '',
      42,
      true,
      {},
      ['/api/academy/media/a.png'],
    ]
    for (const value of unsafe) {
      expect(academyHomeImageUrl(value)).toBeNull()
      const reading: HomeImagesReading = { academy: { homepageImages: { heroStudent: value } as unknown as PublicHomepageImages }, loading: false }
      expect(homeImageSrc('heroStudent', reading)).toBe(HOME_IMAGES.heroStudent)
    }
    expect(academyHomeImageUrl(HERO_URL)).toBe(HERO_URL)
    expect(HERO_URL.startsWith(HOME_MEDIA_PATH_PREFIX)).toBe(true)
  })

  it('a malformed homepageImages leaves every default', () => {
    const odd = { academy: { homepageImages: 'heroStudent' as unknown as PublicHomepageImages }, loading: false }
    expect(homeImageSrc('heroStudent', odd)).toBe(HOME_IMAGES.heroStudent)
  })

  it('shows nothing while API-205 is still loading — never the default first', () => {
    for (const key of HOME_IMAGE_KEYS) {
      expect(homeImageSrc(key, { academy: null, loading: true })).toBeNull()
    }
    // The pixel that keeps the frame meanwhile is an inline image, never a request.
    expect(HOME_IMAGE_PLACEHOLDER.startsWith('data:image/gif;base64,')).toBe(true)
  })

  it('shows the defaults when API-205 failed', () => {
    for (const key of HOME_IMAGE_KEYS) {
      expect(homeImageSrc(key, { academy: null, loading: false })).toBe(HOME_IMAGES[key])
    }
  })

  describe('with the API on another origin (VITE_API_BASE_URL)', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    /** A fresh copy of the resolver and its client, which reads VITE_API_BASE_URL when it is first loaded. */
    async function resolverWithBase(base: string) {
      vi.stubEnv('VITE_API_BASE_URL', base)
      vi.resetModules()
      const view = await import('./homeImages.view')
      const { HOME_IMAGES: defaults } = await import('./homeImages')
      return { ...view, defaults }
    }

    it('asks the API’s origin for the academy’s picture, checked first as the root-relative address the server sent', async () => {
      const view = await resolverWithBase('https://api.academy.example/')
      const reading = answered({ heroStudent: HERO_URL, whyClassroom: WHY_URL })

      expect(view.homeImageSrc('heroStudent', reading)).toBe(`https://api.academy.example${HERO_URL}`)
      expect(view.homeImageSrc('whyClassroom', reading)).toBe(`https://api.academy.example${WHY_URL}`)
      expect(view.academyHomeImageUrl(HERO_URL)).toBe(`https://api.academy.example${HERO_URL}`)
      // The check stays on the raw value: an absolute address — even of the API's own origin — is still refused.
      expect(view.academyHomeImageUrl(`https://api.academy.example${HERO_URL}`)).toBeNull()
      expect(view.academyHomeImageUrl('/api/academy/media/../users')).toBeNull()
      const absolute: HomeImagesReading = { academy: { homepageImages: { ...NONE, heroStudent: `https://api.academy.example${HERO_URL}` } }, loading: false }
      expect(view.homeImageSrc('heroStudent', absolute)).toBe(view.defaults.heroStudent)
    })

    it('leaves the defaults and the loading state as they are — they belong to the web app, not to the API', async () => {
      const view = await resolverWithBase('https://api.academy.example')
      const reading = answered({ heroStudent: HERO_URL })

      expect(view.homeImageSrc('aboutLearners', reading)).toBe(view.defaults.aboutLearners)
      expect(view.homeImageSrc('promoTraining', answered())).toBe(view.defaults.promoTraining)
      expect(view.homeImageSrc('whyClassroom', { academy: null, loading: false })).toBe(view.defaults.whyClassroom)
      expect(view.homeImageSrc('heroStudent', { academy: null, loading: true })).toBeNull()
      expect(view.defaults.aboutLearners.startsWith('https://api.academy.example')).toBe(false)
      expect(view.HOME_IMAGE_PLACEHOLDER).toBe(HOME_IMAGE_PLACEHOLDER)
    })
  })
})
