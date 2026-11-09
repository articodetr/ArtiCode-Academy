import { describe, expect, it } from 'vitest'
import type { Academy } from '../api/academy'
import { makeAcademy } from '../test/academy'
import { academyBrandName, brandLogoSrc } from './academy.brand'

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
})
