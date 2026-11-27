// TEST-342 (J-F79, CH-0386): the stylesheet of the «درس جديد» window. jsdom lays nothing out and Vitest blanks imported
// stylesheets, so these tests read the stylesheet's text and assert the rules that matter beyond the look; the window
// itself was checked in a real browser (master doc 13.4).
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
  // Not `new URL('./lessonModal.css', import.meta.url)`: Vite rewrites that form into the asset's served URL.
  css = readFileSync(fileURLToPath(import.meta.url).replace(/lessonModal\.css\.test\.ts$/, 'lessonModal.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
})

/** The declarations of the first rule whose selector list contains `selector`. */
function ruleOf(selector: string): string {
  const at = css.indexOf(selector)
  if (at < 0) return ''
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}

describe('lessonModal.css (J-F79)', () => {
  it('hides the field names visually only, so every field keeps its name for screen readers', () => {
    const label = ruleOf('.lesson-modal .ant-form .ant-form-item .ant-form-item-label {')
    expect(label).toMatch(/position:\s*absolute/)
    expect(label).toMatch(/clip-path:\s*inset\(50%\)/)
    expect(label).not.toMatch(/display:\s*none/)
    expect(label).not.toMatch(/visibility:\s*hidden/)
  })

  it('hangs every rule on the window: the drawer’s edit form, which shares the fields, keeps its look', () => {
    const selectors = css
      .split('}')
      .map((block) => block.split('{')[0]!.trim())
      .filter(Boolean)
      .flatMap((list) => list.split(',').map((selector) => selector.trim()))
    expect(selectors.length).toBeGreaterThan(10)
    for (const selector of selectors) expect(selector).toMatch(/^\.lesson-(modal|chip)/)
  })

  it('keeps a visible focus mark on a chip chosen from the keyboard', () => {
    expect(ruleOf('.lesson-modal__chips .ant-radio-button-wrapper:has(:focus-visible) .lesson-chip__box')).toMatch(/outline:\s*2px solid/)
  })
})
