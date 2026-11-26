// The kept scrollbar place of AppLayout.css (J-F73). jsdom lays nothing out and Vitest blanks imported stylesheets, so
// these tests read the stylesheet's text and assert the rules; the side menu's position across short and long pages
// and with a modal open was measured in a real browser (master doc 13.4).
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
  // Not `new URL('./AppLayout.css', import.meta.url)`: Vite rewrites that form into the asset's served URL.
  css = readFileSync(fileURLToPath(import.meta.url).replace(/AppLayout\.css\.test\.ts$/, 'AppLayout.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
})

const SUPPORTS = '@supports (scrollbar-gutter: stable) and selector(:has(*))'

/** The text between the braces of the block that starts with `prelude` (nested blocks included). */
function blockOf(source: string, prelude: string): string {
  const start = source.indexOf(`${prelude} {`)
  if (start < 0) return ''
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}' && (depth -= 1) === 0) return source.slice(source.indexOf('{', start) + 1, index)
  }
  return ''
}

/** The declarations of the rule written exactly with `selector` inside `source`, as `property → value`. */
function declarations(source: string, selector: string): Map<string, string> {
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.trim() !== selector) continue
    return new Map(
      match[2]!
        .split(';')
        .map((part) => part.split(':').map((side) => side.trim()))
        .filter(([property, value]) => property && value)
        .map(([property, value]): [string, string] => [property!, value!]),
    )
  }
  return new Map()
}

describe('AppLayout.css — the page scrollbar never moves the shell (J-F73)', () => {
  it('keeps the scrollbar place on every page of the shell, and only there', () => {
    const block = blockOf(css, SUPPORTS)
    expect(block).not.toBe('')
    expect(declarations(block, ':root:has(.app-shell)').get('scrollbar-gutter')).toBe('stable')
    // Nowhere for the whole document: the sign-in page and the pages outside the shell keep the browser's default.
    expect(declarations(css, 'html').get('scrollbar-gutter')).toBeUndefined()
    expect(declarations(css, ':root').get('scrollbar-gutter')).toBeUndefined()
  })

  it("cancels antd's narrowing of <body> under an open modal or drawer, which the kept place already makes", () => {
    expect(declarations(blockOf(css, SUPPORTS), ':root:has(.app-shell) body').get('width')).toBe('auto !important')
  })

  it('never forces the scrollbar with overflow-y: scroll — the scroll lock would send the page back to its top', () => {
    expect(css).not.toMatch(/overflow-y:\s*scroll/)
  })
})
