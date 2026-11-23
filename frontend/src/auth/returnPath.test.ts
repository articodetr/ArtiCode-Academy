// PORTAL-04, the learner journey — stage 2: the return path of a sign-in is a path of this site or nothing, the enroll
// intent names its course, and a forced password change carries the path along.
import { describe, expect, it } from 'vitest'
import { enrollIntentPath } from '../publicCatalog/publicCatalog.view'
import { enrollIntentCourseOf, returnPathOf, safeReturnPath, signInDestination } from './returnPath'

describe('returnPath', () => {
  it('keeps a path of this site with its query and fragment', () => {
    expect(safeReturnPath('/catalog/c-1?intent=enroll')).toBe('/catalog/c-1?intent=enroll')
    expect(safeReturnPath('/users?status=active#top')).toBe('/users?status=active#top')
    expect(safeReturnPath('/')).toBe('/')
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

  it('reads the return path from the router state only when it is usable', () => {
    expect(returnPathOf({ from: '/catalog/c-1?intent=enroll' })).toBe('/catalog/c-1?intent=enroll')
    expect(returnPathOf({ from: 'https://evil.example' })).toBeNull()
    expect(returnPathOf({ notice: 'mfa_step_ended' })).toBeNull()
    expect(returnPathOf(null)).toBeNull()
    expect(returnPathOf('/users')).toBeNull()
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
})
