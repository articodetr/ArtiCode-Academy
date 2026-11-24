// PORTAL-04 (#208): the rules of the public home page.
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { makePublicCard } from '../test/publicCatalog'
import { catalogOpenOf, formatHomeStat, homeProgramsOf, homeProgramsPath, homeProgramsStateOf, homeStatsOf } from './publicHome.view'

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

  describe('homeProgramsOf', () => {
    const open = (id: string) => makePublicCard({ id })
    const full = (id: string) => makePublicCard({ id, hasFreeSeat: false })
    const unpriced = (id: string) => makePublicCard({ id, hasFreeSeat: false, pricing: 'paid', price: null })
    const soon = (id: string) => makePublicCard({ id, openClasses: 0, hasFreeSeat: false })
    const ids = (cards: readonly { id: string }[]) => cards.map((card) => card.id)

    it('shows only what takes a learner now, in the server’s order', () => {
      const selection = homeProgramsOf([soon('s1'), open('o1'), full('f1'), open('o2'), unpriced('p1')])
      expect(ids(selection.cards)).toEqual(['o1', 'o2'])
      expect(selection.joinable).toBe(true)
    })

    it('stops at six when more are available', () => {
      const cards = Array.from({ length: 9 }, (_, index) => open(`o${index}`))
      expect(ids(homeProgramsOf(cards).cards)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4', 'o5'])
    })

    it('falls back to the first six published, marked as not joinable, when none is available', () => {
      const cards = [soon('a'), full('b'), unpriced('c'), soon('d'), soon('e'), soon('f'), soon('g')]
      const selection = homeProgramsOf(cards)
      expect(ids(selection.cards)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
      expect(selection.joinable).toBe(false)
    })

    it('has nothing to show without a card', () => {
      expect(homeProgramsOf([])).toEqual({ cards: [], joinable: false })
    })

    it('leaves the figures to every card read, not to the ones shown', () => {
      const cards = [open('o1'), soon('s1'), soon('s2')].map((card) => ({ ...card, lessonCount: 2 }))
      expect(homeProgramsOf(cards).cards).toHaveLength(1)
      expect(homeStatsOf(cards, false)).toMatchObject({ programs: 3, lessons: 6 })
    })
  })

  it('writes a figure in Latin digits, with «+» for a lower bound', () => {
    expect(formatHomeStat(1250, false)).toBe('1,250')
    expect(formatHomeStat(48, true)).toBe('48+')
  })
})
