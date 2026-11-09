import { describe, expect, it } from 'vitest'
import type { Academy } from '../api/academy'
import { makeAcademy } from '../test/academy'
import { academyBrandName, brandLogoSrc, isBrandPending } from './academy.brand'

const ORIGIN = 'https://academy.example.test'

describe('academyBrandName', () => {
  it('shows the UI language and falls back to the mandatory Arabic', () => {
    const academy = makeAcademy({ name: { ar: 'أكاديمية النور', en: 'Al-Noor Academy' } })
    expect(academyBrandName(academy, 'ar')).toBe('أكاديمية النور')
    expect(academyBrandName(academy, 'en')).toBe('Al-Noor Academy')
    expect(academyBrandName(makeAcademy({ name: { ar: 'أكاديمية النور', tr: 'Nur Akademisi' } }), 'en')).toBe('أكاديمية النور')
  })

  it('has no name without an academy or a usable name (the header keeps its static one)', () => {
    expect(academyBrandName(null, 'ar')).toBeNull()
    expect(academyBrandName(undefined, 'en')).toBeNull()
    expect(academyBrandName(makeAcademy({ name: { ar: '   ' } }), 'ar')).toBeNull()
    expect(academyBrandName({ name: undefined } as unknown as Academy, 'ar')).toBeNull()
  })
})

describe('brandLogoSrc', () => {
  it('loads an https: URL or a root-relative path that stays on the page origin', () => {
    expect(brandLogoSrc('https://cdn.example.test/brand/logo.png', ORIGIN)).toBe('https://cdn.example.test/brand/logo.png')
    expect(brandLogoSrc('  HTTPS://CDN.Example.test/logo.svg ', ORIGIN)).toBe('https://cdn.example.test/logo.svg')
    expect(brandLogoSrc('/media/logo.png', ORIGIN)).toBe('https://academy.example.test/media/logo.png')
  })

  it('shows no logo for any other address', () => {
    const refused = [
      null,
      undefined,
      '',
      '   ',
      'http://cdn.example.test/logo.png',
      // Look root-relative, but browsers resolve them to another host.
      '//cdn.example.test/logo.png',
      '/\\cdn.example.test/logo.png',
      '/\t/cdn.example.test/logo.png',
      'javascript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=',
      'ftp://cdn.example.test/logo.png',
      'logo.png',
      'https://',
    ]
    for (const value of refused) expect(brandLogoSrc(value, ORIGIN), JSON.stringify(value)).toBeNull()
  })

  it('loads an http: logo only while the page itself is served over http: — never mixed content on an https: page (J-F24)', () => {
    const HTTP_ORIGIN = 'http://localhost:5173'
    expect(brandLogoSrc('http://cdn.example.test/logo.png', HTTP_ORIGIN)).toBe('http://cdn.example.test/logo.png')
    expect(brandLogoSrc(' HTTP://CDN.Example.test/logo.svg ', HTTP_ORIGIN)).toBe('http://cdn.example.test/logo.svg')
    // https: stays allowed on an http: page, and so does a path on the page's own origin.
    expect(brandLogoSrc('https://cdn.example.test/logo.png', HTTP_ORIGIN)).toBe('https://cdn.example.test/logo.png')
    expect(brandLogoSrc('/media/logo.png', HTTP_ORIGIN)).toBe('http://localhost:5173/media/logo.png')
    // The same http: address on an https: page shows nothing.
    expect(brandLogoSrc('http://cdn.example.test/logo.png', ORIGIN)).toBeNull()

    // Every other refusal holds on an http: page too.
    const refused = [
      '//cdn.example.test/logo.png',
      '/\\cdn.example.test/logo.png',
      '/\t/cdn.example.test/logo.png',
      'javascript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=',
      'ftp://cdn.example.test/logo.png',
      'logo.png',
      'http://',
    ]
    for (const value of refused) expect(brandLogoSrc(value, HTTP_ORIGIN), JSON.stringify(value)).toBeNull()
  })

  it('refuses http: and paths, but keeps https:, when the page origin is opaque', () => {
    expect(brandLogoSrc('https://cdn.example.test/logo.png', 'null')).toBe('https://cdn.example.test/logo.png')
    expect(brandLogoSrc('http://cdn.example.test/logo.png', 'null')).toBeNull()
    expect(brandLogoSrc('/media/logo.png', 'null')).toBeNull()
  })
})

describe('isBrandPending', () => {
  it('is true only while the first read runs — no row and no failure yet (J-F24)', () => {
    expect(isBrandPending({ academy: null, loading: true, error: null })).toBe(true)
    // A row arrived: its name (or the static one) stays during a re-read.
    expect(isBrandPending({ academy: makeAcademy(), loading: false, error: null })).toBe(false)
    expect(isBrandPending({ academy: makeAcademy(), loading: true, error: null })).toBe(false)
    // The read failed (503 included): the static name shows, during a retry too.
    const failure = new Error('academy_not_configured')
    expect(isBrandPending({ academy: null, loading: false, error: failure })).toBe(false)
    expect(isBrandPending({ academy: null, loading: true, error: failure })).toBe(false)
  })
})
