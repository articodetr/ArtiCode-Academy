import { describe, expect, it } from 'vitest'
import { NO_COVER_LOAD, coverLinkOf, coverPreviewState, settleCoverLoad, startCoverLoad } from './courses.cover'
import { COVER_IMAGE_URL_MAX } from './courses.form'

const HTTP_PAGE = 'http://localhost:5173'
const HTTPS_PAGE = 'https://academy.example.org'
const A = 'https://cdn.example.org/a.jpg'
const B = 'https://cdn.example.org/b.jpg'

describe('coverLinkOf', () => {
  it('reads a blank value as no picture', () => {
    expect(coverLinkOf('', HTTPS_PAGE)).toEqual({ kind: 'empty' })
    expect(coverLinkOf('   ', HTTPS_PAGE)).toEqual({ kind: 'empty' })
    expect(coverLinkOf(undefined, HTTPS_PAGE)).toEqual({ kind: 'empty' })
    expect(coverLinkOf(null, HTTPS_PAGE)).toEqual({ kind: 'empty' })
  })

  it('accepts an absolute https link, trimmed', () => {
    expect(coverLinkOf(`  ${A} `, HTTPS_PAGE)).toEqual({ kind: 'ready', src: A })
  })

  it('never loads a value that fails the URL rule, a path on this origin included', () => {
    for (const value of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '/uploads/a.jpg', '//cdn.example.org/a.jpg', 'cdn.example.org/a.jpg', 'https://cdn.example.org/a b.jpg']) {
      expect(coverLinkOf(value, HTTPS_PAGE)).toEqual({ kind: 'invalid' })
    }
  })

  it('refuses a link over the server limit of 2,048 characters', () => {
    const base = 'https://cdn.example.org/'
    expect(coverLinkOf(base + 'a'.repeat(COVER_IMAGE_URL_MAX - base.length), HTTPS_PAGE).kind).toBe('ready')
    expect(coverLinkOf(base + 'a'.repeat(COVER_IMAGE_URL_MAX - base.length + 1), HTTPS_PAGE)).toEqual({ kind: 'invalid' })
  })

  it('marks an http link on an https page as mixed, and loads it on an http page', () => {
    const link = 'http://cdn.example.org/a.jpg'
    expect(coverLinkOf(link, HTTPS_PAGE)).toEqual({ kind: 'mixed' })
    expect(coverLinkOf(link, HTTP_PAGE)).toEqual({ kind: 'ready', src: link })
  })
})

describe('the image load', () => {
  it('starts a new link as loading and keeps the result of the link already shown', () => {
    const loaded = settleCoverLoad(startCoverLoad(NO_COVER_LOAD, A), A, 'loaded')
    expect(startCoverLoad(loaded, A)).toBe(loaded)
    expect(startCoverLoad(loaded, B)).toEqual({ src: B, outcome: 'loading' })
  })

  it('ignores the answer of an older link', () => {
    const current = startCoverLoad(startCoverLoad(NO_COVER_LOAD, A), B)
    expect(settleCoverLoad(current, A, 'failed')).toBe(current)
    expect(settleCoverLoad(current, A, 'loaded')).toBe(current)
    expect(settleCoverLoad(current, B, 'loaded')).toEqual({ src: B, outcome: 'loaded' })
  })
})

describe('coverPreviewState', () => {
  it('follows the link before the load', () => {
    const failed = { src: A, outcome: 'failed' as const }
    expect(coverPreviewState({ kind: 'empty' }, failed)).toBe('empty')
    expect(coverPreviewState({ kind: 'invalid' }, failed)).toBe('invalid')
    expect(coverPreviewState({ kind: 'mixed' }, failed)).toBe('mixed')
  })

  it('is loading until a ready link has an answer', () => {
    const link = { kind: 'ready', src: A } as const
    expect(coverPreviewState(link, NO_COVER_LOAD)).toBe('loading')
    expect(coverPreviewState(link, { src: A, outcome: 'loading' })).toBe('loading')
    expect(coverPreviewState(link, { src: A, outcome: 'loaded' })).toBe('loaded')
    expect(coverPreviewState(link, { src: A, outcome: 'failed' })).toBe('failed')
  })

  it('claims no result for a new link while the load is still the previous one', () => {
    const link = { kind: 'ready', src: B } as const
    expect(coverPreviewState(link, { src: A, outcome: 'loaded' })).toBe('loading')
    expect(coverPreviewState(link, { src: A, outcome: 'failed' })).toBe('loading')
  })
})
