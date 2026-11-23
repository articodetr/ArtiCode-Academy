// MOD-09 phase 2 (OEX-T07) — the layout rules of the exam page that a jsdom
// test cannot see. jsdom lays nothing out and Vitest blanks imported
// stylesheets, so this reads the stylesheets' text and asserts the
// configuration: a sticky header, one column on a narrow screen, targets big
// enough for a finger, long texts that wrap instead of widening the page, and
// logical properties only (so Arabic RTL and English LTR mirror each other).
// The pixels themselves need a real browser.
import { beforeAll, describe, expect, it } from 'vitest'

const SHEETS = ['takeExam.css', 'attemptsList.css', 'myExamOnline.css'] as const
const css: Record<string, string> = {}

/** A Node built-in without the Node types the app's tsconfig leaves out (tests run on Node). */
async function builtin<T>(name: string): Promise<T> {
  const specifier: string = `node:${name}`
  return (await import(/* @vite-ignore */ specifier)) as T
}

beforeAll(async () => {
  const { readFileSync } = await builtin<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
  const { fileURLToPath } = await builtin<{ fileURLToPath: (url: string) => string }>('url')
  // Not `new URL('./takeExam.css', import.meta.url)`: Vite rewrites that form into the asset's served URL.
  const here = fileURLToPath(import.meta.url)
  for (const sheet of SHEETS) css[sheet] = readFileSync(here.replace(/takeExam\.css\.test\.ts$/, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
})

/** The declarations of the rule written exactly with `selector`, outside any media query (the first such rule). */
function ruleOf(sheet: string, selector: string): Record<string, string> {
  const outside = sheet.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  for (const match of outside.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1]!.split(',').some((part) => part.trim() === selector)) continue
    return Object.fromEntries(
      match[2]!
        .split(';')
        .map((part) => part.split(':').map((side) => side.trim()))
        .filter((pair): pair is [string, string] => Boolean(pair[0] && pair[1])),
    )
  }
  return {}
}

/** The text inside the media query that starts with `condition`. */
function mediaOf(sheet: string, condition: string): string {
  const start = sheet.indexOf(`@media ${condition}`)
  if (start === -1) return ''
  let depth = 0
  for (let index = sheet.indexOf('{', start); index < sheet.length; index += 1) {
    if (sheet[index] === '{') depth += 1
    else if (sheet[index] === '}' && --depth === 0) return sheet.slice(sheet.indexOf('{', start) + 1, index)
  }
  return ''
}

const px = (value: string | undefined) => Number.parseFloat(value ?? '')

describe('takeExam.css — the exam page’s layout', () => {
  it('keeps the header — the title and the timer — in view while the questions scroll', () => {
    const header = ruleOf(css['takeExam.css']!, '.take-header')
    expect(header.position).toBe('sticky')
    expect(header['inset-block-start']).toBe('0')
    expect(header['flex-wrap']).toBe('wrap') // the saving and the timer drop under the title on a phone instead of overflowing
    // A heading that takes the focus lands below the sticky header, not behind it.
    expect(px(ruleOf(css['takeExam.css']!, '.take-question__heading')['scroll-margin-block-start'])).toBeGreaterThanOrEqual(120)
    // The way back and the language scroll away: only the header sticks.
    expect(ruleOf(css['takeExam.css']!, '.take-topbar').position).toBeUndefined()
  })

  it('puts the navigator beside the question on a wide screen and under it below 992 px, where nothing sticks to the side', () => {
    const sheet = css['takeExam.css']!
    expect(ruleOf(sheet, '.take-layout')['grid-template-columns']).toBe('minmax(0, 1fr) 300px')
    const narrow = mediaOf(sheet, '(max-width: 991.98px)')
    expect(narrow).toMatch(/\.take-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/)
    expect(narrow).toMatch(/\.take-navigator\s*\{\s*position:\s*static;/)
  })

  it('never makes the page wider than a 390 px phone: flexible boxes, and long texts that break inside them', () => {
    const sheet = css['takeExam.css']!
    for (const selector of ['.take-prompt', '.take-option__text', '.take-header__meta', '.take-answer__text']) expect(ruleOf(sheet, selector)['overflow-wrap'], selector).toBe('anywhere')
    for (const selector of ['.take-main', '.take-layout__question', '.take-card', '.take-header__titles']) expect(ruleOf(sheet, selector)['min-inline-size'], selector).toBe('0')
    // The one-line title is cut with an ellipsis rather than pushing the timer out.
    expect(ruleOf(sheet, '.take-header__title')).toMatchObject({ overflow: 'hidden', 'white-space': 'nowrap', 'text-overflow': 'ellipsis' })
    // No box of the three sheets has a fixed inline size a phone cannot hold (the 300 px navigator column is desktop-only).
    for (const name of SHEETS) {
      const fixed = [...css[name]!.matchAll(/(?<![a-z-])(?:min-)?inline-size:\s*(\d+)px/g)].map((match) => Number(match[1]))
      expect(Math.max(0, ...fixed), name).toBeLessThanOrEqual(48)
    }
    const phone = mediaOf(sheet, '(max-width: 575.98px)')
    expect(phone).toMatch(/\.take-main\s*\{\s*padding:\s*12px;/)
  })

  it('gives every target of the exam a size a finger can hit, and shows the keyboard focus', () => {
    const sheet = css['takeExam.css']!
    expect(px(ruleOf(sheet, '.take-option')['min-block-size'])).toBeGreaterThanOrEqual(48)
    const navigator = ruleOf(sheet, '.take-navigator__button')
    expect(px(navigator['inline-size'])).toBeGreaterThanOrEqual(44)
    expect(px(navigator['block-size'])).toBeGreaterThanOrEqual(44)
    for (const selector of ['.take-navigator__button:focus-visible', '.take-option__input:focus-visible', '.take-back-link:focus-visible']) expect(ruleOf(sheet, selector).outline, selector).toMatch(/^2px solid/)
  })

  it('tells answered from unanswered — and the open question — by more than colour', () => {
    const sheet = css['takeExam.css']!
    // Unanswered: a dashed outline on white. Answered: filled. The open question: a ring.
    expect(ruleOf(sheet, '.take-navigator__button').border).toMatch(/dashed/)
    expect(ruleOf(sheet, '.take-navigator__button--answered').border).toMatch(/solid/)
    expect(ruleOf(sheet, '.take-navigator__button--answered').background).toBeDefined()
    expect(ruleOf(sheet, ".take-navigator__button[aria-current='true']")['box-shadow']).toBeDefined()
  })

  it('uses logical properties only, so the page mirrors between Arabic (RTL) and English (LTR)', () => {
    for (const name of SHEETS) {
      const sheet = css[name]!
      expect(sheet, name).not.toMatch(/(?<![a-z-])(left|right)\s*:/)
      expect(sheet, name).not.toMatch(/(margin|padding|border)-(left|right)/)
      expect(sheet, name).not.toMatch(/text-align:\s*(left|right)/)
      expect(sheet, name).not.toMatch(/float\s*:/)
    }
  })
})
