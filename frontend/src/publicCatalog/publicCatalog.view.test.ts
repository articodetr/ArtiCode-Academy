// MOD-20 (D-R138) — the pure rules of the public catalog: the page request, «المزيد», availability, level names
// (D-R130), lesson lengths, failures and the enroll intent.
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { CATALOG_NOT_PUBLIC, PUBLIC_COURSE_IDS, makePublicCard } from '../test/publicCatalog'
import {
  publicCoursePathFor,
  appendCards,
  availabilityOf,
  availabilityPillKey,
  courseBadgesOf,
  courseTextsOf,
  durationMinutes,
  enrollIntentPath,
  explorePathFor,
  exploreSearchOf,
  isPublicCourseGone,
  levelNameOf,
  orderPublicPage,
  publicCatalogParams,
  publicEnrollStateOf,
  publicFailureKey, cardSubscribeTarget } from './publicCatalog.view'

const t = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('ar')(key, options)
const tEn = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('en')(key, options)

describe('publicCatalog.view', () => {
  it('asks for 24 cards, the search trimmed and capped, the cursor only when there is one', () => {
    expect(publicCatalogParams('', undefined)).toEqual({ limit: 24 })
    expect(publicCatalogParams('  بايثون ', 'c1')).toEqual({ limit: 24, q: 'بايثون', cursor: 'c1' })
    expect(publicCatalogParams('x'.repeat(150), undefined).q).toHaveLength(100)
  })

  it('appends the next page after the cards on screen, never showing a course twice', () => {
    const first = makePublicCard({ id: PUBLIC_COURSE_IDS[0] })
    const second = makePublicCard({ id: PUBLIC_COURSE_IDS[1] })
    const third = makePublicCard({ id: PUBLIC_COURSE_IDS[2] })
    expect(appendCards([first, second], [second, third]).map((card) => card.id)).toEqual([...PUBLIC_COURSE_IDS])
  })

  it('words availability from the server counts only', () => {
    const free = { pricing: 'free', price: null } as const
    expect(availabilityOf({ openClasses: 2, hasFreeSeat: true, ...free })).toBe('available')
    expect(availabilityOf({ openClasses: 1, hasFreeSeat: false, ...free })).toBe('full')
    expect(availabilityOf({ openClasses: 0, hasFreeSeat: false, ...free })).toBe('closed')
  })

  it('words a card with no open class «قريبًا» and leaves the other pills as they were', () => {
    expect(t(availabilityPillKey('closed'))).toBe('قريبًا')
    expect(tEn(availabilityPillKey('closed'))).toBe('Coming soon')
    expect(availabilityPillKey('available')).toBe('publicCatalog.card.available')
    expect(availabilityPillKey('full')).toBe('publicCatalog.card.full')
  })

  describe('courseBadgesOf', () => {
    const level = { name: { ar: 'مبتدئ', en: 'Beginner' } }

    it('names the course, its difficulty and its duration, in that order', () => {
      expect(courseBadgesOf({ level, durationHours: 24 }, t, 'ar')).toEqual([
        { key: 'type', text: 'دورة' },
        { key: 'level', text: 'مبتدئ' },
        { key: 'duration', text: '24 ساعة' },
      ])
      expect(courseBadgesOf({ level, durationHours: 1 }, tEn, 'en').map((badge) => badge.text)).toEqual(['Course', 'Beginner', tEn('publicCatalog.card.hours', { count: 1 })])
    })

    it('shows a badge only for what the server has', () => {
      expect(courseBadgesOf({ level: null, durationHours: null }, t, 'ar').map((badge) => badge.key)).toEqual(['type'])
      expect(courseBadgesOf({ level, durationHours: null }, t, 'ar').map((badge) => badge.key)).toEqual(['type', 'level'])
      expect(courseBadgesOf({ level: null, durationHours: 3 }, t, 'ar').map((badge) => badge.key)).toEqual(['type', 'duration'])
    })
  })

  describe('courseTextsOf', () => {
    const text = (ar: string, en?: string) => ({ ar, en })

    it('keeps the summary for the band and the description for its section', () => {
      expect(courseTextsOf({ summary: text('قصير'), description: text('طويل') }, 'ar')).toEqual({ summary: 'قصير', description: 'طويل' })
      expect(courseTextsOf({ summary: text('قصير', 'Short'), description: text('طويل', 'Long') }, 'en')).toEqual({ summary: 'Short', description: 'Long' })
    })

    it('never repeats a description that equals the summary after trimming', () => {
      expect(courseTextsOf({ summary: text('نفس النص'), description: text('  نفس النص\n') }, 'ar')).toEqual({ summary: 'نفس النص', description: null })
    })

    it('compares the texts in the language shown', () => {
      const course = { summary: text('نص', 'Same'), description: text('نص آخر', 'Same') }
      expect(courseTextsOf(course, 'en').description).toBeNull()
      expect(courseTextsOf(course, 'ar').description).toBe('نص آخر')
    })

    it('leaves the band without a short text when only a description exists, and has nothing with neither', () => {
      expect(courseTextsOf({ summary: null, description: text('طويل') }, 'ar')).toEqual({ summary: null, description: 'طويل' })
      expect(courseTextsOf({ summary: text('   '), description: text('طويل') }, 'ar')).toEqual({ summary: null, description: 'طويل' })
      expect(courseTextsOf({ summary: null, description: null }, 'ar')).toEqual({ summary: null, description: null })
      expect(courseTextsOf({ summary: text(' '), description: text(' ') }, 'ar')).toEqual({ summary: null, description: null })
    })

    it('keeps the line breaks inside a text', () => {
      expect(courseTextsOf({ summary: null, description: text('سطر أول\nسطر ثانٍ') }, 'ar').description).toBe('سطر أول\nسطر ثانٍ')
    })
  })

  describe('orderPublicPage', () => {
    const open = (id: string) => makePublicCard({ id })
    const full = (id: string) => makePublicCard({ id, hasFreeSeat: false })
    const unpriced = (id: string) => makePublicCard({ id, hasFreeSeat: false, pricing: 'paid', price: null })
    const soon = (id: string) => makePublicCard({ id, openClasses: 0, hasFreeSeat: false })
    const ids = (cards: readonly { id: string }[]) => cards.map((card) => card.id)

    it('puts what can be joined first and «قريبًا» last, the server’s order kept inside each group', () => {
      const page = [soon('s1'), full('f1'), open('o1'), unpriced('p1'), soon('s2'), open('o2'), full('f2')]
      expect(ids(orderPublicPage(page))).toEqual(['o1', 'o2', 'f1', 'p1', 'f2', 's1', 's2'])
    })

    it('loses no card, adds none, and leaves the server’s page untouched', () => {
      const page = [soon('s1'), open('o1'), full('f1')]
      const before = ids(page)
      const ordered = orderPublicPage(page)
      expect(ids(page)).toEqual(before)
      expect(ordered).toHaveLength(page.length)
      expect(new Set(ids(ordered))).toEqual(new Set(before))
      expect(orderPublicPage([])).toEqual([])
    })

    it('only appends the next page: the cards on screen keep their places, even a coming-soon one above an available one', () => {
      const shown = orderPublicPage([soon('s1'), open('o1')])
      const next = appendCards(shown, orderPublicPage([soon('s2'), soon('s1'), open('o2')]))
      expect(ids(next)).toEqual(['o1', 's1', 'o2', 's2'])
    })
  })

  it('names a level by its ordinal, with its title when it has one; past the tenth by its number (D-R130)', () => {
    expect(levelNameOf({ number: 1, title: null }, t, 'ar')).toBe('المستوى الأول')
    expect(levelNameOf({ number: 2, title: { ar: 'الأساسيات', en: 'Basics' } }, t, 'ar')).toBe('المستوى الثاني — الأساسيات')
    expect(levelNameOf({ number: 10, title: { ar: '  ' } }, t, 'ar')).toBe('المستوى العاشر')
    expect(levelNameOf({ number: 12, title: null }, t, 'ar')).toBe('المستوى الثاني عشر')
    expect(levelNameOf({ number: 2, title: { ar: 'الأساسيات', en: 'Basics' } }, tEn, 'en')).toBe('Level 2 — Basics')
    expect(levelNameOf({ number: 3, title: { ar: 'فقط بالعربية' } }, tEn, 'en')).toBe('Level 3 — فقط بالعربية')
  })

  it('rounds a lesson length to whole minutes (at least one) and has none without a length', () => {
    expect(durationMinutes(600)).toBe(10)
    expect(durationMinutes(20)).toBe(1)
    expect(durationMinutes(89)).toBe(1)
    expect(durationMinutes(91)).toBe(2)
    expect(durationMinutes(0)).toBeNull()
    expect(durationMinutes(null)).toBeNull()
  })

  it('tells a missing course from a closed catalog, and words the other failures', () => {
    const closed = new ApiError(404, 'closed', CATALOG_NOT_PUBLIC)
    const gone = new ApiError(404, 'gone', { statusCode: 404, code: 'course_not_found', message: 'gone' })
    expect(isPublicCourseGone(gone)).toBe(true)
    expect(isPublicCourseGone(closed)).toBe(false)
    expect(publicFailureKey(new ApiError(429, 'slow', { statusCode: 429, code: 'rate_limited', message: 'slow' }))).toBe('publicCatalog.errors.rate_limited')
    expect(publicFailureKey(new ApiError(500, 'boom', { statusCode: 500, message: 'boom' }))).toBe('publicCatalog.errors.server')
    expect(publicFailureKey(new TypeError('Failed to fetch'))).toBe('publicCatalog.errors.network')
  })

  it('carries the search of /explore in the address — to a course page and back — and never anywhere else (PORTAL-04)', () => {
    expect(exploreSearchOf(new URLSearchParams('q=%20%D8%A8%D8%A7%D9%8A%D8%AB%D9%88%D9%86%20'))).toBe('بايثون')
    expect(exploreSearchOf(new URLSearchParams(''))).toBe('')
    expect(exploreSearchOf(new URLSearchParams({ q: 'x'.repeat(150) }))).toHaveLength(100)

    expect(explorePathFor('')).toBe('/explore')
    expect(explorePathFor('   ')).toBe('/explore')
    expect(explorePathFor(' بايثون ')).toBe(`/explore?q=${encodeURIComponent('بايثون')}`)
    expect(publicCoursePathFor('c 1', 'بايثون')).toBe(`/explore/c%201?q=${encodeURIComponent('بايثون')}`)
    expect(publicCoursePathFor('c1', '')).toBe('/explore/c1')

    // A search that looks like an address stays a value of q on this site's own /explore.
    for (const hostile of ['//evil.example', 'https://evil.example/x', '/\\evil.example', 'javascript:alert(1)']) {
      const path = explorePathFor(hostile)
      expect(path.startsWith('/explore?q=')).toBe(true)
      expect(new URL(path, 'https://academy.example').origin).toBe('https://academy.example')
      expect(new URLSearchParams(path.slice('/explore?'.length)).get('q')).toBe(hostile)
    }
  })

  it('leads the enroll button to the signed-in course page with the enroll intent', () => {
    expect(enrollIntentPath(PUBLIC_COURSE_IDS[0])).toBe(`/catalog/${PUBLIC_COURSE_IDS[0]}?intent=enroll`)
    expect(enrollIntentPath('a/b')).toBe('/catalog/a%2Fb?intent=enroll')
  })

  it('says whether a visitor can go on to enroll, from the server’s numbers as it sends them (PORTAL-04)', () => {
    expect(publicEnrollStateOf(makePublicCard())).toBe('enrollable')
    expect(publicEnrollStateOf(makePublicCard({ pricing: 'paid', price: { amount: 100, currency: 'SAR' } }))).toBe('enrollable')
    // No class open wins over everything.
    expect(publicEnrollStateOf(makePublicCard({ openClasses: 0, hasFreeSeat: false, pricing: 'paid', price: null }))).toBe('not_open')
    // The server sends `hasFreeSeat: false` for every paid course whose price is unusable (courseOfferOf()): the price
    // is the reason to give, never «full».
    expect(publicEnrollStateOf(makePublicCard({ hasFreeSeat: false, pricing: 'paid', price: null }))).toBe('price_unavailable')
    expect(publicEnrollStateOf(makePublicCard({ hasFreeSeat: false }))).toBe('class_full')
    expect(publicEnrollStateOf(makePublicCard({ hasFreeSeat: false, pricing: 'paid', price: { amount: 100, currency: 'SAR' } }))).toBe('class_full')
  })

  it('never calls a paid course without a price «full» (the server’s hasFreeSeat folds the price in)', () => {
    expect(availabilityOf(makePublicCard({ hasFreeSeat: false, pricing: 'paid', price: null }))).toBe('priceUnavailable')
    expect(availabilityOf(makePublicCard({ hasFreeSeat: false }))).toBe('full')
    expect(availabilityOf(makePublicCard({ openClasses: 0, hasFreeSeat: false, pricing: 'paid', price: null }))).toBe('closed')
  })

  it('offers the subscribe button only to whoever can enroll, in a course that takes an enrollment now', () => {
    const open = { id: 'c-1', openClasses: 1, hasFreeSeat: true, pricing: 'free', price: null } as const
    const paid = { ...open, pricing: 'paid', price: { amount: 150, currency: 'USD', installments: 1 } } as const
    const path = '/catalog/c-1?intent=enroll'
    expect(cardSubscribeTarget(open, 'visitor', false)).toEqual({ to: '/login', state: { from: path } })
    expect(cardSubscribeTarget(paid, 'visitor', false)).toEqual({ to: '/login', state: { from: path } })
    expect(cardSubscribeTarget(open, 'learner', true)).toEqual({ to: path })
    // A guardian holds no student role; staff never enroll; an unknown session shows nothing yet.
    expect(cardSubscribeTarget(open, 'learner', false)).toBeNull()
    expect(cardSubscribeTarget(open, 'staff', false)).toBeNull()
    expect(cardSubscribeTarget(open, 'pending', false)).toBeNull()
    // No open class, every seat taken, or a paid course without a usable price.
    expect(cardSubscribeTarget({ ...open, openClasses: 0, hasFreeSeat: false }, 'visitor', false)).toBeNull()
    expect(cardSubscribeTarget({ ...open, hasFreeSeat: false }, 'visitor', false)).toBeNull()
    expect(cardSubscribeTarget({ ...paid, price: null, hasFreeSeat: false }, 'visitor', false)).toBeNull()
  })
})
