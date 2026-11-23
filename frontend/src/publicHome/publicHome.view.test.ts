// PORTAL-04 (#208): the rules of the public home page.
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { makePublicCard } from '../test/publicCatalog'
import { catalogOpenOf, formatHomeStat, homeProgramsPath, homeProgramsStateOf, homeStatsOf } from './publicHome.view'

const closed = new ApiError(404, 'closed', { statusCode: 404, code: 'catalog_not_public' })
const notFound = new ApiError(404, 'gone', { statusCode: 404, code: 'course_not_found' })

describe('publicHome.view', () => {
  it('names the state of the programs section', () => {
    expect(homeProgramsStateOf({ loading: true, error: null, count: 0 })).toBe('loading')
    expect(homeProgramsStateOf({ loading: false, error: null, count: 3 })).toBe('ready')
    expect(homeProgramsStateOf({ loading: false, error: null, count: 0 })).toBe('empty')
    expect(homeProgramsStateOf({ loading: false, error: closed, count: 0 })).toBe('closed')
    // Any other failure — a 404 that is not the closed catalog, a 500, the network — is an error with a retry.
    expect(homeProgramsStateOf({ loading: false, error: notFound, count: 0 })).toBe('error')
    expect(homeProgramsStateOf({ loading: false, error: new TypeError('network'), count: 0 })).toBe('error')
  })

  it('knows the catalog is open from the programs first, else from API-205, else not yet', () => {
    expect(catalogOpenOf('ready', { catalogPublic: false })).toBe(true)
    expect(catalogOpenOf('empty', null)).toBe(true)
    expect(catalogOpenOf('closed', { catalogPublic: true })).toBe(false)
    expect(catalogOpenOf('loading', { catalogPublic: true })).toBe(true)
    expect(catalogOpenOf('error', { catalogPublic: false })).toBe(false)
    // A server before MOD-20 sends no `catalogPublic`: read as closed.
    expect(catalogOpenOf('loading', {})).toBe(false)
    expect(catalogOpenOf('loading', null)).toBeNull()
  })

  it('leads each viewer to the programs only where they can go', () => {
    expect(homeProgramsPath('visitor', true, false)).toBe('/explore')
    expect(homeProgramsPath('visitor', false, false)).toBeNull()
    expect(homeProgramsPath('visitor', null, false)).toBeNull()
    expect(homeProgramsPath('learner', false, false)).toBe('/catalog')
    expect(homeProgramsPath('staff', true, true)).toBe('/courses')
    expect(homeProgramsPath('staff', true, false)).toBeNull()
    expect(homeProgramsPath('pending', true, true)).toBeNull()
  })

  it('sums the figures from the cards, whole hours only, and has none without a card', () => {
    const cards = [makePublicCard({ lessonCount: 4, durationHours: 1.5, openClasses: 2 }), makePublicCard({ lessonCount: 3, durationHours: null, openClasses: 0 }), makePublicCard({ lessonCount: 1, durationHours: 2.25, openClasses: 1 })]
    expect(homeStatsOf(cards, false)).toEqual({ programs: 3, lessons: 8, hours: 3, openClasses: 3, partial: false })
    expect(homeStatsOf(cards, true)?.partial).toBe(true)
    expect(homeStatsOf([], true)).toBeNull()
  })

  it('writes a figure in Latin digits, with «+» for a lower bound', () => {
    expect(formatHomeStat(1250, false)).toBe('1,250')
    expect(formatHomeStat(48, true)).toBe('48+')
  })
})
