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
    expect(declarations('.public-card .public-card__link:focus-visible::after').get('outline')).toBe('2px solid #0f6cbd')
    expect(css).not.toContain(':has(')
  })

  it('lines up the card footers of a row (the card is a column)', () => {
    const card = declarations('.public-card')
    expect(card.get('display')).toBe('flex')
    expect(card.get('flex-direction')).toBe('column')
  })

  it('on a phone keeps the brand and the action on one row, the links on the next, and drops the accounts line', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 767px)'))
    expect(phone).toMatch(/\.public-catalog__header::after\s*\{[^}]*flex-basis:\s*100%/)
    const small = css.slice(css.indexOf('@media (max-width: 575px)'))
    expect(small).toMatch(/\.public-catalog__note\s*\{\s*display:\s*none;/)
  })
})
