// PORTAL-04, the learner journey: the return path of a sign-in is a path of this site or nothing — by the server's own
// rule for `returnTo` —, the enroll intent names its course, a forced password change carries the path along, and a
// course kept while registering is the destination of a student who names no other.
import { describe, expect, it } from 'vitest'
import { enrollIntentPath } from '../publicCatalog/publicCatalog.view'
import {
  RETURN_PATH_MAX_LENGTH,
  enrollIntentCourseOf,
  followsReturnToRule,
  requestedReturnPath,
  returnPathOf,
  returnToOf,
  safeReturnPath,
  signInDestination,
  signInTarget,
  withReturnTo,
} from './returnPath'

const COURSE = '0192f0a0-0000-7000-8000-00000000c001'

describe('returnPath', () => {
  it('keeps a path of this site with its query and fragment', () => {
    expect(safeReturnPath('/catalog/c-1?intent=enroll')).toBe('/catalog/c-1?intent=enroll')
    expect(safeReturnPath('/users?status=active#top')).toBe('/users?status=active#top')
    expect(safeReturnPath('/')).toBe('/')
    expect(safeReturnPath(`/${'a'.repeat(RETURN_PATH_MAX_LENGTH - 1)}`)).toHaveLength(RETURN_PATH_MAX_LENGTH)
  })

  it('refuses anything that could lead to another site, and the login page itself', () => {
    for (const hostile of [
      'https://evil.example/x',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '',
      '/login',
      '/login?next=/users',
      `/${'a'.repeat(3000)}`,
    ]) {
      expect(safeReturnPath(hostile)).toBeNull()
    }
    expect(safeReturnPath(42)).toBeNull()
    expect(safeReturnPath(null)).toBeNull()
    expect(safeReturnPath({ pathname: '/users' })).toBeNull()
  })

  // The shared contract, rule B: the server answers `/` for exactly these, so both sides agree.
  it.each([
    ['a full URL', 'https://academy.example/catalog'],
    ['no leading slash', 'catalog/c-1'],
    ['two leading slashes', '//evil.example/x'],
    ['a slash and a backslash', '/\\evil.example'],
    ['a backslash later on', '/catalog\\c-1'],
    ['a space', '/catalog/c 1'],
    ['a tab', '/catalog/\tc-1'],
    ['a newline', '/catalog\n/c-1'],
    ['a no-break space', '/catalog/c 1'],
    ['a line separator', '/catalog/c 1'],
    ['a NUL', `/catalog/c${String.fromCharCode(0)}1`],
    ['DEL', `/catalog/c${String.fromCharCode(0x7f)}1`],
    ['the API', '/api/auth/me'],
    ['the API by its root', '/api/'],
    ['513 characters', `/${'a'.repeat(RETURN_PATH_MAX_LENGTH)}`],
    ['an empty string', ''],
  ])('refuses %s, as the server does', (_label, value) => {
    expect(followsReturnToRule(value)).toBe(false)
    expect(safeReturnPath(value)).toBeNull()
  })

  it.each([
    ['the home page', '/'],
    ['a course with the enroll intent', `/catalog/${COURSE}?intent=enroll`],
    ['an encoded value', '/explore?q=%D8%A8%D8%A7%D9%8A%D8%AB%D9%88%D9%86'],
    ['a path that only starts like the API', '/apis'],
    ['512 characters', `/${'a'.repeat(RETURN_PATH_MAX_LENGTH - 1)}`],
  ])('accepts %s, as the server does', (_label, value) => {
    expect(followsReturnToRule(value)).toBe(true)
    expect(safeReturnPath(value)).toBe(value)
  })

  it('refuses a path that reaches the API once it is resolved', () => {
    expect(safeReturnPath('/x/../api/auth/me')).toBeNull()
  })

  it('reads the return path from the router state only when it is usable', () => {
    expect(returnPathOf({ from: '/catalog/c-1?intent=enroll' })).toBe('/catalog/c-1?intent=enroll')
    expect(returnPathOf({ from: 'https://evil.example' })).toBeNull()
    expect(returnPathOf({ notice: 'mfa_step_ended' })).toBeNull()
    expect(returnPathOf(null)).toBeNull()
    expect(returnPathOf('/users')).toBeNull()
  })

  it('reads ?returnTo= of the address, encoded or not, and never another site', () => {
    const intent = enrollIntentPath(COURSE)
    expect(returnToOf(`?returnTo=${encodeURIComponent(intent)}`)).toBe(intent)
    expect(returnToOf(`?google=failed&returnTo=${encodeURIComponent(intent)}`)).toBe(intent)
    expect(returnToOf('?returnTo=/users')).toBe('/users')
    expect(returnToOf(`?returnTo=${encodeURIComponent('https://evil.example')}`)).toBeNull()
    expect(returnToOf(`?returnTo=${encodeURIComponent('//evil.example')}`)).toBeNull()
    expect(returnToOf('?returnTo=')).toBeNull()
    expect(returnToOf('')).toBeNull()
  })

  it('prefers ?returnTo= over the router state, and falls back to the state', () => {
    expect(requestedReturnPath('?returnTo=%2Fusers', { from: '/courses' })).toBe('/users')
    expect(requestedReturnPath('?returnTo=https%3A%2F%2Fevil.example', { from: '/courses' })).toBe('/courses')
    expect(requestedReturnPath('', { from: '/courses' })).toBe('/courses')
    expect(requestedReturnPath('', null)).toBeNull()
  })

  it('writes a link that carries the return path, and none for the home page or a hostile one', () => {
    const intent = enrollIntentPath(COURSE)
    expect(withReturnTo('/register', intent)).toBe(`/register?returnTo=${encodeURIComponent(intent)}`)
    expect(returnToOf(withReturnTo('/register', intent).slice('/register'.length))).toBe(intent)
    expect(withReturnTo('/register', '/')).toBe('/register')
    expect(withReturnTo('/register', null)).toBe('/register')
    expect(withReturnTo('/register', 'https://evil.example')).toBe('/register')
  })

  it('names the course of an enroll intent, as the public course page writes it', () => {
    expect(enrollIntentCourseOf(enrollIntentPath('c-1'))).toBe('c-1')
    expect(enrollIntentCourseOf(enrollIntentPath('a/b'))).toBe('a/b')
    expect(enrollIntentCourseOf('/catalog/c-1')).toBeNull()
    expect(enrollIntentCourseOf('/catalog/c-1?intent=other')).toBeNull()
    expect(enrollIntentCourseOf('/catalog?intent=enroll')).toBeNull()
    expect(enrollIntentCourseOf('/catalog/c-1/x?intent=enroll')).toBeNull()
    expect(enrollIntentCourseOf('https://evil.example/catalog/c-1?intent=enroll')).toBeNull()
    expect(enrollIntentCourseOf(null)).toBeNull()
  })

  it('sends a user who must change the password to the profile page with the return path, else to the return path', () => {
    const intent = enrollIntentPath('c-1')
    expect(signInDestination({ mustChangePassword: true }, intent)).toEqual({ path: '/profile', state: { from: intent } })
    expect(signInDestination({ mustChangePassword: true }, '/')).toEqual({ path: '/profile' })
    expect(signInDestination({ mustChangePassword: true }, null)).toEqual({ path: '/profile' })
    expect(signInDestination({ mustChangePassword: false }, intent)).toEqual({ path: intent })
    expect(signInDestination({ mustChangePassword: false }, null)).toEqual({ path: '/' })
  })

  describe('signInTarget — after a password sign-in, Google or the second step', () => {
    const student = { mustChangePassword: false, roles: ['student'] }
    const staff = { mustChangePassword: false, roles: ['academy_admin'] }
    const kept = enrollIntentPath(COURSE)

    it.each([
      ['a return path wins over a kept course', student, '/my-classes', COURSE, { path: '/my-classes', usesKeptCourse: false }],
      ['a student without one goes to the kept course', student, null, COURSE, { path: kept, usesKeptCourse: true }],
      ['the home page names no page, so the kept course wins', student, '/', COURSE, { path: kept, usesKeptCourse: true }],
      ['staff never get a kept course', staff, null, COURSE, { path: '/', usesKeptCourse: false }],
      ['a guardian never gets a kept course', { mustChangePassword: false, roles: ['guardian'] }, null, COURSE, { path: '/', usesKeptCourse: false }],
      ['nothing kept: the default', student, null, null, { path: '/', usesKeptCourse: false }],
    ])('%s', (_label, user, returnTo, keptCourse, expected) => {
      expect(signInTarget(user, returnTo, keptCourse)).toEqual(expected)
    })

    it('uses the kept course up when the return path names that very course', () => {
      expect(signInTarget(student, kept, COURSE)).toEqual({ path: kept, usesKeptCourse: true })
      // Another course in the return path leaves the kept one alone.
      const other = enrollIntentPath('0192f0a0-0000-7000-8000-00000000c002')
      expect(signInTarget(student, other, COURSE)).toEqual({ path: other, usesKeptCourse: false })
    })

    it('carries the kept course through the forced password change', () => {
      expect(signInTarget({ mustChangePassword: true, roles: ['student'] }, null, COURSE)).toEqual({
        path: '/profile',
        state: { from: kept },
        usesKeptCourse: true,
      })
    })
  })
})
