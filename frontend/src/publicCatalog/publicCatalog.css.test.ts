// PORTAL-04: the rules of publicCatalog.css that jsdom cannot show. Vitest blanks imported stylesheets, so these tests
// read the stylesheet's text (the payments.css.test.ts pattern); the layout itself was checked in a real browser.
import { beforeAll, describe, expect, it } from 'vitest'

let css = ''

/** A Node built-in without the Node types the app's tsconfig leaves out (tests run on Node). */
async function builtin<T>(name: string): Promise<T> {
  const specifier: string = `node:${name}`
  return (await import(/* @vite-ignore */ specifier)) as T
}

beforeAll(async () => {
  const { readFileSync } = await builtin<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
  const { fileURLToPath } = await builtin<{ fileURLToPath: (url: string) => string }>('url')
  css = readFileSync(fileURLToPath(import.meta.url).replace(/publicCatalog\.css\.test\.ts$/, 'publicCatalog.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
})

/** The declarations of the rule written exactly with `selector` (the first one), as `property → value`. */
function declarations(selector: string): Map<string, string> {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.trim() !== selector) continue
    const result = new Map<string, string>()
    for (const part of match[2]!.split(';')) {
      const [property, ...value] = part.split(':')
      if (property && value.length > 0) result.set(property.trim(), value.join(':').trim())
    }
    return result
  }
  throw new Error(`no rule for ${selector}`)
}

describe('publicCatalog.css', () => {
  it('stretches the card name’s link over the whole card, with «التفاصيل» above it', () => {
    expect(declarations('.public-card').get('position')).toBe('relative')
    const stretched = declarations('.public-card .public-card__link::after')
    expect(stretched.get('position')).toBe('absolute')
    expect(stretched.get('inset')).toBe('0')
    expect(stretched.get('z-index')).toBe('1')
    expect(declarations('.public-card .public-card__action').get('z-index')).toBe('2')
  })

  it('draws the keyboard focus ring on the stretched area itself — no :has() needed', () => {
    expect(declarations('.public-card .public-card__link:focus-visible::after').get('outline')).toBe('2px solid #039092')
    expect(css).not.toContain(':has(')
  })

  it('lines up the card footers of a row (the card is a column)', () => {
    const card = declarations('.public-card')
    expect(card.get('display')).toBe('flex')
    expect(card.get('flex-direction')).toBe('column')
  })

  it('from a tablet down moves the links and the language switch behind the menu button', () => {
    expect(declarations('.public-catalog__menu-button.ant-btn').get('display')).toBe('none')
    const small = css.slice(css.indexOf('@media (max-width: 991px)'))
    expect(small).toMatch(/\.public-catalog__nav,\s*\.public-catalog__language,\s*\.public-catalog__search-link\s*\{\s*display:\s*none;/)
    expect(small).toMatch(/\.public-catalog__menu-button\.ant-btn\s*\{\s*display:\s*inline-flex;/)
  })

  it('keeps the one-row header in view at every width', () => {
    expect(declarations('.public-catalog__header').get('position')).toBe('sticky')
    expect(css).not.toMatch(/\.public-catalog__header\s*\{\s*position:\s*static;/)
  })

  it('marks the current page’s link with a bar, and never hides a focus ring', () => {
    expect(declarations('.public-catalog__nav-link.active::after').get('background')).toBe('var(--pub-primary)')
    expect(declarations('.public-catalog__nav-link:focus-visible').get('outline')).toBe('2px solid var(--pub-primary)')
  })

  it('shows the enrollment status as a labelled pill, and the card details in a darker grey than page-level lines', () => {
    for (const state of ['available', 'full', 'closed']) {
      const rule = declarations(`.public-card__availability--${state}`)
      expect(rule.get('background'), state).toMatch(/^#/)
      expect(rule.get('border-color'), state).toMatch(/^#/)
      expect(rule.get('color'), state).toBeTruthy()
    }
    expect(declarations('.public-card .public-card__summary').get('color')).toBe('var(--pub-detail)')
    expect(declarations('.public-card__fact').get('color')).toBe('var(--pub-detail)')
  })

  it('stops the card’s movement for a viewer who asks for reduced motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.public-card--link:hover[^{]*\{\s*transform:\s*none;/)
  })
})
