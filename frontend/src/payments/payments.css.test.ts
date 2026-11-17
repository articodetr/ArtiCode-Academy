// The phone rules of payments.css (QA V4, 390 px). jsdom lays nothing out and Vitest blanks imported stylesheets, so
// these tests read the stylesheet's text and assert the configuration; the widths themselves are checked in a real
// browser. The components' tests assert that the elements carry these classes.
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
  // Not `new URL('./payments.css', import.meta.url)`: Vite rewrites that form into the asset's served URL.
  css = readFileSync(fileURLToPath(import.meta.url).replace(/payments\.css\.test\.ts$/, 'payments.css'), 'utf8')
})

/** The declarations of the rule written exactly with `selector`, as `property → value`. */
function declarations(selector: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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

describe('payments.css — phone rules', () => {
  it('lays «my invoices» out in one column no wider than the page and wraps the three amounts (QA V4 P4: 449 px at 390 px)', () => {
    expect(declarations('.my-invoices').get('grid-template-columns')).toBe('minmax(0, 1fr)')
    expect(declarations('.my-invoice').get('min-width')).toBe('0')
    expect(declarations('.my-invoice__totals').get('flex-wrap')).toBe('wrap')
  })

  it('lets an installment or receipt row wrap instead of squeezing its date onto the amount (re-verification of CH-0296)', () => {
    expect(declarations('.my-invoice__lists li').get('flex-wrap')).toBe('wrap')
    // The due date keeps its text width (a zero `flex: 1` basis made the wrap see a zero-wide date and squeeze it).
    expect(declarations('.my-invoice__lists li > span.my-invoice__due').get('flex')).toBe('1 0 auto')
    expect(declarations('.my-invoice__lists li > span.my-invoice__due').get('white-space')).toBe('nowrap')
  })

  it('keeps an invoice number on one line and lets the drawer header put its actions under the title (QA V4 P6)', () => {
    expect(declarations('.finance-number').get('white-space')).toBe('nowrap')
    expect(declarations('.ant-drawer-header.finance-drawer__header').get('flex-wrap')).toBe('wrap')
    // antd's `flex: 1` has a zero basis, which would never let the header wrap.
    expect(declarations('.ant-drawer-header.finance-drawer__header > .ant-drawer-header-title').get('flex')).toBe('1 1 auto')
  })
})
