// The frame of the sign-in and account pages (PORTAL-04): the academy's name and logo as the public pages show them, the
// way home, the language switch, one heading per card — and, read from the stylesheet's text (jsdom lays nothing out and
// Vitest blanks imported CSS), a light page that covers the viewport and a card of at most 440 px that fits a phone.
import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PublicAcademyReading } from '../academy/usePublicAcademy'
import { ar } from '../i18n/ar'
import { makePublicAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { renderWithProviders } from '../test/render'
import { AuthLayout, AuthLoading } from './AuthLayout'

const reading = (overrides: Partial<PublicAcademyReading> = {}): PublicAcademyReading => ({
  academy: makePublicAcademy(),
  loading: false,
  error: null,
  ...overrides,
})

function renderFrame(academy?: PublicAcademyReading) {
  return renderWithProviders(
    <AuthLayout title="عنوان البطاقة" subtitle="سطر تحته" academy={academy}>
      <p>محتوى</p>
    </AuthLayout>,
    { route: '/login' },
  )
}

describe('AuthLayout', () => {
  it('names the academy, leads home twice and switches the language, around one heading', () => {
    const fetchMock = mockFetch(() => jsonResponse(500, {}))
    renderFrame(reading())

    expect(screen.getByTestId('auth-academy-name')).toHaveTextContent('أكاديمية آرتي كود')
    expect(screen.getByTestId('auth-academy-name').tagName).toBe('BDI')
    expect(screen.getByTestId('auth-academy-name').closest('a')).toHaveAttribute('href', '/home')
    expect(screen.getByText(ar.login.layout.backHome).closest('a')).toHaveAttribute('href', '/home')
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('عنوان البطاقة')
    expect(screen.getByText('سطر تحته')).toBeInTheDocument()
    expect(screen.getByText('محتوى')).toBeInTheDocument()
    // A page that hands its reading in is never read twice.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads API-205 itself without a reading, and falls back to a neutral name — never the product’s — after a failure', async () => {
    const fetchMock = mockFetch(() => jsonResponse(503, { statusCode: 503 }))
    renderFrame()

    expect(await screen.findByText(ar.publicCatalog.header.academyFallback)).toBeInTheDocument()
    expect(screen.queryByText(ar.common.appName)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the academy’s https logo in the bar and atop the card, decorative, and no logo for another scheme', () => {
    const { unmount } = renderFrame(reading({ academy: makePublicAcademy({ logoUrl: 'https://cdn.example/logo.png' }) }))
    const logos = document.querySelectorAll('img')
    expect(logos).toHaveLength(2)
    for (const logo of logos) {
      expect(logo).toHaveAttribute('src', 'https://cdn.example/logo.png')
      expect(logo).toHaveAttribute('alt', '')
    }
    unmount()

    renderFrame(reading({ academy: makePublicAcademy({ logoUrl: 'javascript:alert(1)' }) }))
    expect(document.querySelector('img')).toBeNull()
  })

  it('shows no name while the academy is still being read', () => {
    renderFrame(reading({ academy: null, loading: true }))
    expect(screen.getByTestId('auth-academy-name')).toHaveTextContent('')
  })

  it('waits with a spinner and, when asked, a line saying why', () => {
    const { unmount } = renderWithProviders(<AuthLoading />)
    expect(document.querySelector('.ant-spin')).not.toBeNull()
    expect(screen.getByTestId('auth-loading')).not.toHaveAttribute('role')
    unmount()
    renderWithProviders(<AuthLoading label="جارٍ الانتظار" />)
    expect(screen.getByRole('status')).toHaveTextContent('جارٍ الانتظار')
  })
})

describe('AuthLayout.css', () => {
  let css = ''

  /** A Node built-in without the Node types the app's tsconfig leaves out (tests run on Node). */
  async function builtin<T>(name: string): Promise<T> {
    const specifier: string = `node:${name}`
    return (await import(/* @vite-ignore */ specifier)) as T
  }

  beforeAll(async () => {
    const { readFileSync } = await builtin<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
    const { fileURLToPath } = await builtin<{ fileURLToPath: (url: string) => string }>('url')
    css = readFileSync(fileURLToPath(import.meta.url).replace(/AuthLayout\.test\.tsx$/, 'AuthLayout.css'), 'utf8')
  })

  /** Every value of `property` in the rule written exactly with `selector` (outside any media query too), in order. */
  function valuesOf(selector: string, property: string, scope = css): string[] {
    const text = scope.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (match[1]!.trim() !== selector) continue
      return match[2]!
        .split(';')
        .map((part) => part.split(':').map((side) => side.trim()))
        .filter(([name, value]) => name === property && value)
        .map(([, value]) => value!)
    }
    return []
  }

  function mediaBlock(query: string): string {
    const start = css.indexOf(`@media (${query})`)
    expect(start).toBeGreaterThan(-1)
    let depth = 0
    for (let index = css.indexOf('{', start); index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}') depth -= 1
      if (depth === 0) return css.slice(css.indexOf('{', start) + 1, index)
    }
    return ''
  }

  it('covers the viewport with a light page, never a full-screen gradient', () => {
    expect(valuesOf('.auth-layout', 'min-height')).toEqual(['100vh', '100dvh'])
    expect(valuesOf('.auth-layout', 'background')).toEqual(['var(--auth-page)'])
    expect(valuesOf('.auth-layout', '--auth-page')[0]).toMatch(/^#f[0-9a-f]{5}$/i)
  })

  it('centres one card of at most 440 px that takes the full width of a phone, with the public pages’ typefaces', () => {
    expect(valuesOf('.auth-layout__card', 'max-width')).toEqual(['440px'])
    expect(valuesOf('.auth-layout__card', 'width')).toEqual(['100%'])
    expect(valuesOf('.auth-layout__card', 'box-sizing')).toEqual(['border-box'])
    expect(valuesOf('.auth-layout', 'font-family')[0]).toContain("'Public Cairo'")
    const phone = mediaBlock('max-width: 560px')
    expect(valuesOf('.auth-layout__card', 'padding', phone)).toEqual(['28px 20px 24px'])
    // The words of «العودة إلى الرئيسية» stay for a screen reader on a phone; only the arrow shows.
    expect(valuesOf('.auth-layout__back-text', 'clip-path', phone)).toEqual(['inset(50%)'])
    expect(valuesOf('.auth-layout__card', 'padding', mediaBlock('max-width: 360px'))).toEqual(['24px 16px 20px'])
  })
})
