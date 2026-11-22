// PORTAL-04 (#208): the viewer of the public pages and where its links lead.
import { describe, expect, it } from 'vitest'
import { coursePathFor, isLearner, programsPathFor, showsProgramsLink, viewerOf } from './publicViewer'

describe('publicViewer', () => {
  it('tells a pending session, a visitor, a learner and a member of staff apart', () => {
    expect(viewerOf('loading', null)).toBe('pending')
    expect(viewerOf('anonymous', null)).toBe('visitor')
    // An authenticated status without a user is no session to act on.
    expect(viewerOf('authenticated', null)).toBe('visitor')
    expect(viewerOf('authenticated', { roles: ['student'] })).toBe('learner')
    expect(viewerOf('authenticated', { roles: ['guardian'] })).toBe('learner')
    // A teacher who is also a guardian reads the learners' catalog, as the nav entry `catalog` allows.
    expect(viewerOf('authenticated', { roles: ['teacher', 'guardian'] })).toBe('learner')
    expect(viewerOf('authenticated', { roles: ['academy_admin'] })).toBe('staff')
    expect(viewerOf('authenticated', { roles: [] })).toBe('staff')
    expect(isLearner(null)).toBe(false)
  })

  it('leads a visitor to the public catalog, a learner to the signed-in one and staff to the courses page', () => {
    expect(programsPathFor('visitor')).toBe('/explore')
    expect(programsPathFor('pending')).toBe('/explore')
    expect(programsPathFor('learner')).toBe('/catalog')
    expect(programsPathFor('staff')).toBe('/courses')

    expect(coursePathFor('visitor', 'a/b')).toBe('/explore/a%2Fb')
    expect(coursePathFor('learner', 'c1')).toBe('/catalog/c1')
    expect(coursePathFor('staff', 'c1')).toBe('/courses')
  })

  it('shows «البرامج» to a visitor only while the catalog is public, always to a learner, never to staff', () => {
    expect(showsProgramsLink('visitor', true)).toBe(true)
    expect(showsProgramsLink('visitor', false)).toBe(false)
    expect(showsProgramsLink('pending', false)).toBe(false)
    expect(showsProgramsLink('learner', false)).toBe(true)
    expect(showsProgramsLink('staff', true)).toBe(false)
  })
})
