// PORTAL-04 (#208): the rules of the public home page.
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { catalogOpenOf, homeProgramsStateOf } from './publicHome.view'

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
})
