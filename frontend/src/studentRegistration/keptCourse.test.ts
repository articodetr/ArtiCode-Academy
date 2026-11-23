import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KEPT_COURSE_KEY,
  KEPT_COURSE_TTL_MS,
  chosenCourseOf,
  clearKeptCourse,
  keepCourse,
  readKeptCourse,
  rememberChosenCourse,
  takeKeptCourse,
} from './keptCourse'

const COURSE = '0192f0a0-0000-7000-8000-00000000c001'
const OTHER_COURSE = '0192f0a0-0000-7000-8000-00000000c002'
const NOW = 1_800_000_000_000
const intent = (id: string) => ({ from: `/catalog/${id}?intent=enroll` })

describe('keptCourse', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  describe('chosenCourseOf', () => {
    it('names the course of an enroll intent', () => {
      expect(chosenCourseOf(intent(COURSE))).toBe(COURSE)
    })

    it('names nothing for anything else in the state', () => {
      for (const state of [
        null,
        undefined,
        'x',
        {},
        { from: `/catalog/${COURSE}` },
        { from: '/users' },
        { from: `https://evil.example/catalog/${COURSE}?intent=enroll` },
        { from: `//evil.example/catalog/${COURSE}?intent=enroll` },
        { from: '/catalog/someone@example.test?intent=enroll' },
        { from: '/catalog/not-a-uuid?intent=enroll' },
      ]) {
        expect(chosenCourseOf(state)).toBeNull()
      }
    })
  })

  it('stores the course id and the time, and nothing else', () => {
    keepCourse(COURSE, NOW)
    expect(window.localStorage.length).toBe(1)
    expect(JSON.parse(window.localStorage.getItem(KEPT_COURSE_KEY)!)).toEqual({ courseId: COURSE, savedAt: NOW })
  })

  it('refuses to store a value that is not a course id', () => {
    keepCourse('someone@example.test', NOW)
    expect(window.localStorage.length).toBe(0)
  })

  it('reads the course until 48 hours have passed, then removes it', () => {
    keepCourse(COURSE, NOW)
    expect(readKeptCourse(NOW)).toBe(COURSE)
    expect(readKeptCourse(NOW + KEPT_COURSE_TTL_MS - 1)).toBe(COURSE)
    expect(readKeptCourse(NOW + KEPT_COURSE_TTL_MS)).toBeNull()
    expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
  })

  it('treats a time from the future as unusable', () => {
    keepCourse(COURSE, NOW + 1000)
    expect(readKeptCourse(NOW)).toBeNull()
    expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
  })

  it.each([
    'not json',
    'null',
    '42',
    '{}',
    JSON.stringify({ courseId: 'x', savedAt: NOW }),
    JSON.stringify({ courseId: COURSE }),
    JSON.stringify({ courseId: COURSE, savedAt: String(NOW) }),
    JSON.stringify({ courseId: 42, savedAt: NOW }),
  ])('removes an unreadable value: %s', (raw) => {
    window.localStorage.setItem(KEPT_COURSE_KEY, raw)
    expect(readKeptCourse(NOW)).toBeNull()
    expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
  })

  it('takes the course once', () => {
    keepCourse(COURSE, NOW)
    expect(takeKeptCourse(NOW)).toBe(COURSE)
    expect(takeKeptCourse(NOW)).toBeNull()
    expect(window.localStorage.length).toBe(0)
  })

  it('takes nothing from an expired value and still clears it', () => {
    keepCourse(COURSE, NOW)
    expect(takeKeptCourse(NOW + KEPT_COURSE_TTL_MS)).toBeNull()
    expect(window.localStorage.length).toBe(0)
  })

  it('rememberChosenCourse keeps the course of this visit, replacing an older one', () => {
    keepCourse(OTHER_COURSE, NOW)
    rememberChosenCourse(intent(COURSE), NOW)
    expect(readKeptCourse(NOW)).toBe(COURSE)
  })

  it('rememberChosenCourse clears an older choice when this visit named no course', () => {
    keepCourse(OTHER_COURSE, NOW)
    rememberChosenCourse({ from: '/users' }, NOW)
    expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
  })

  it('leaves another key of the app alone', () => {
    window.localStorage.setItem('articode.other', 'kept')
    keepCourse(COURSE, NOW)
    clearKeptCourse()
    expect(window.localStorage.getItem('articode.other')).toBe('kept')
  })

  it('works, silently, when storage is blocked', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)

    expect(() => keepCourse(COURSE, NOW)).not.toThrow()
    expect(() => rememberChosenCourse(intent(COURSE), NOW)).not.toThrow()
    expect(() => clearKeptCourse()).not.toThrow()
    expect(readKeptCourse(NOW)).toBeNull()
    expect(takeKeptCourse(NOW)).toBeNull()
  })
})
