// The cascade rules of timetable.css (KI-119). jsdom lays nothing out and Vitest blanks imported stylesheets, so
// these tests read the stylesheet's text and assert the configuration; the cascade itself was checked in a real
// browser. WeekGrid.test.tsx asserts that the slots carry these classes.
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
  // Not `new URL('./timetable.css', import.meta.url)`: Vite rewrites that form into the asset's served URL.
  css = readFileSync(fileURLToPath(import.meta.url).replace(/timetable\.css\.test\.ts$/, 'timetable.css'), 'utf8')
})

/** Every rule of the stylesheet (inside an at-rule too) as its selector list, on one line, and its declarations. */
function rules(): Array<{ selector: string; body: string }> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return Array.from(withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({ selector: match[1]!.trim().replace(/\s+/g, ' '), body: match[2]! }))
}

/** The declarations of the rule written exactly with `selector`, as `property → value`. */
function declarations(selector: string): Map<string, string> {
  const rule = rules().find((candidate) => candidate.selector === selector)
  if (!rule) return new Map()
  return new Map(
    rule.body
      .split(';')
      .map((part) => part.split(':').map((side) => side.trim()))
      .filter(([property, value]) => property && value)
      .map(([property, value]): [string, string] => [property!, value!]),
  )
}

describe('timetable.css — the cascade of three or more overlapping slots (KI-119)', () => {
  it('raises a hovered card and a card focused from the keyboard in two rules, so a browser without :has() keeps the hover', () => {
    expect(declarations('.tt-slot.is-cascade:hover').get('z-index')).toBe('1')
    expect(declarations('.tt-slot.is-cascade:has(> .tt-event:focus-visible)').get('z-index')).toBe('1')
    // A selector list holding `:has()` is dropped whole by a browser that cannot read it: never share one.
    for (const { selector } of rules().filter((rule) => rule.selector.includes(':has('))) expect(selector.split(',')).toHaveLength(1)
  })

  it('lets the pointer through a slot’s padding to the card underneath, and keeps the start time of a cascade card out of the sliver rule', () => {
    expect(declarations('.tt-slot.is-cascade').get('pointer-events')).toBe('none')
    expect(declarations('.tt-slot.is-cascade > .tt-event').get('pointer-events')).toBe('auto')
    expect(declarations('.tt-slot:not(.is-cascade) .tt-event:not(.is-card) .tt-event__sub, .tt-slot:not(.is-cascade) .tt-event:not(.is-card) .tt-event__time').get('display')).toBe('none')
  })

  it('keeps one-hour slots compact in the 24-hour grid without overlapping back-to-back hours or pushing the time off the row', () => {
    expect(declarations('.tt-slot').get('min-height')).toBe('14px')
    expect(declarations('.tt-event.is-tiny .tt-event__title').get('flex')).toBe('1 1 0')
    expect(declarations('.tt-event.is-tiny .tt-event__time').get('flex')).toBe('none')
  })
})
