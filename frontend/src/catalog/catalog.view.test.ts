// MOD-19 — the pure rules of the learner's catalog screens.
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { makeMyClassItem } from '../test/enrollments'
import { makeCatalogCard, makeCatalogClass, makeCatalogDetail } from '../test/catalog'
import { catalogFailureKey, isCourseGone } from './catalog.errors'
import {
  cardAvailability,
  catalogParams,
  coverSrc,
  enrollableClasses,
  enrollmentUnavailable,
  groupByCourse,
  isCatalogNarrowed,
  priceAmount,
  weekdayKey,
} from './catalog.view'

describe('catalog filters', () => {
  it('sends only what narrows: a trimmed, capped search, the type, the level and «available» as true only', () => {
    expect(catalogParams({}, undefined)).toEqual({ limit: 24 })
    expect(catalogParams({ q: '  ', pricing: undefined }, '')).toEqual({ limit: 24 })
    expect(catalogParams({ q: ' py ', pricing: 'paid', levelId: 'lv', available: true }, 'c1')).toEqual({ limit: 24, q: 'py', pricing: 'paid', levelId: 'lv', available: true, cursor: 'c1' })
    expect(catalogParams({ q: 'a'.repeat(150) }, undefined).q).toHaveLength(100)
    expect(isCatalogNarrowed({})).toBe(false)
    expect(isCatalogNarrowed({ q: '  ' })).toBe(false)
    expect(isCatalogNarrowed({ available: true })).toBe(true)
  })
})

describe('cover image address (the header logo rule)', () => {
  it('loads https always, http only on an http page, nothing else', () => {
    expect(coverSrc('https://cdn.example.org/a.jpg', 'https://academy.example.org')).toBe('https://cdn.example.org/a.jpg')
    expect(coverSrc('http://cdn.example.org/a.jpg', 'https://academy.example.org')).toBeNull()
    expect(coverSrc('http://cdn.example.org/a.jpg', 'http://localhost:5173')).toBe('http://cdn.example.org/a.jpg')
    expect(coverSrc('javascript:alert(1)', 'https://academy.example.org')).toBeNull()
    expect(coverSrc(null, 'https://academy.example.org')).toBeNull()
  })
})

describe('card availability', () => {
  it('words the server counts: available, full, closed, or a paid course without a usable price', () => {
    expect(cardAvailability(makeCatalogCard())).toBe('available')
    expect(cardAvailability(makeCatalogCard({ availableClasses: 0 }))).toBe('full')
    expect(cardAvailability(makeCatalogCard({ openClasses: 0, availableClasses: 0 }))).toBe('closed')
    expect(cardAvailability(makeCatalogCard({ pricing: 'paid', price: null, availableClasses: 0 }))).toBe('priceUnavailable')
  })
})

describe('the classes the details page offers', () => {
  const full = makeCatalogClass({ id: 'full', enrollable: false, blocker: 'class_full' })
  it('offers the enrollable classes only, and none when the reader may not enroll', () => {
    expect(enrollableClasses(makeCatalogDetail({ classes: [makeCatalogClass(), full] })).map((klass) => klass.id)).toEqual([makeCatalogClass().id])
    expect(enrollableClasses(makeCatalogDetail({ selfService: { allowed: false, reason: 'no_permission' } }))).toEqual([])
  })

  it('says «not available» only when no class takes the reader and none holds their own row', () => {
    expect(enrollmentUnavailable(makeCatalogDetail())).toBe(false)
    expect(enrollmentUnavailable(makeCatalogDetail({ classes: [full] }))).toBe(true)
    expect(enrollmentUnavailable(makeCatalogDetail({ classes: [] }))).toBe(true)
    const mine = makeCatalogClass({ enrollable: false, blocker: 'request_pending', myEnrollment: { id: 'e', status: 'pending', state: 'pending_payment' } })
    expect(enrollmentUnavailable(makeCatalogDetail({ classes: [mine] }))).toBe(false)
    expect(enrollmentUnavailable(makeCatalogDetail({ classes: [full], selfService: { allowed: false, reason: 'not_a_student' } }))).toBe(false)
  })
})

describe('small formatters', () => {
  it('names the weekday and shows two decimals', () => {
    expect([0, 1, 6, 7].map(weekdayKey)).toEqual(['sun', 'mon', 'sat', 'sun'])
    expect(priceAmount(1200)).toBe('1200.00')
  })

  it('groups «my classes» by course in the server order', () => {
    const a = makeMyClassItem()
    const b = makeMyClassItem({ enrollmentId: 'e-2', class: { ...a.class, id: 'c-2', code: 'PY-101-B' } })
    const other = makeMyClassItem({ enrollmentId: 'e-3', class: { ...a.class, id: 'c-3', course: { id: 'course-2', code: 'WEB', name: { ar: 'الويب' } } } })
    expect(groupByCourse([a, other, b]).map((group) => [group.course.id, group.items.map((item) => item.enrollmentId)])).toEqual([
      [a.class.course.id, [a.enrollmentId, 'e-2']],
      ['course-2', ['e-3']],
    ])
  })
})

describe('catalog failures', () => {
  it('maps the server codes, a 403 without code, a network failure and anything else', () => {
    expect(catalogFailureKey(new ApiError(409, 'x', { code: 'class_full' }))).toBe('catalog.errors.class_full')
    expect(catalogFailureKey(new ApiError(403, 'x', {}))).toBe('catalog.errors.permission_denied')
    expect(catalogFailureKey(new TypeError('failed to fetch'))).toBe('catalog.errors.network')
    expect(catalogFailureKey(new ApiError(500, 'x', {}))).toBe('catalog.errors.server')
    expect(isCourseGone(new ApiError(404, 'x', { code: 'course_not_found' }))).toBe(true)
    expect(isCourseGone(new ApiError(500, 'x', {}))).toBe(false)
  })
})
