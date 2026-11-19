// Whole words in table cells (index.css, QA 2026-11-19): antd's Typography sets `word-break: break-word`, which lets the
// browser break a word anywhere when it sizes a table's columns, so a squeezed column broke «2026/11/19» into
// «2/11/19» + «،026» and titles, names and e-mails letter by letter. jsdom lays nothing out and Vitest blanks imported
// CSS, so this reads the rule from the file's text and checks it against the DOM antd 6 really renders: it reaches a
// Typography inside a table cell, outranks antd's own rule there, and leaves a Typography outside a table alone.
import { render } from '@testing-library/react'
import { ConfigProvider, Table, Typography } from 'antd'
import { describe, expect, it } from 'vitest'

/** A file of src/ read from disk: vitest empties every `.css` import, `?raw` included. */
async function readSource(path: string): Promise<string> {
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8')
}

interface CssRule {
  selectors: string[]
  body: string
}

/** The plain rules of a stylesheet's text (the innermost `selector { body }` of any block). */
function rulesOf(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1]!.split(',').map((selector) => selector.trim()).filter(Boolean),
    body: match[2]!,
  }))
}

/** The specificity of one selector as [ids, classes + attributes + pseudo-classes, types]; `:where()` counts nothing. */
function specificity(selector: string): [number, number, number] {
  const bare = selector.replace(/:where\([^()]*\)/g, '').replace(/::[\w-]+/g, '')
  const ids = (bare.match(/#[\w-]+/g) ?? []).length
  const classes = (bare.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length
  const types = (bare.replace(/\[[^\]]*\]/g, '').match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
  return [ids, classes, types]
}

const higher = (a: number[], b: number[]) => (a[0]! !== b[0]! ? a[0]! > b[0]! : a[1]! !== b[1]! ? a[1]! > b[1]! : a[2]! > b[2]!)

/** Whether `selector` matches `element`; `:where(x)` is read as `x` (the element carries antd's hash class anyway). */
function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector.replace(/:where\(([^()]*)\)/g, '$1'))
  } catch {
    return false
  }
}

function bestMatch(element: Element, rules: CssRule[]): [number, number, number] | null {
  let best: [number, number, number] | null = null
  for (const rule of rules)
    for (const selector of rule.selectors) {
      if (!matches(element, selector)) continue
      const value = specificity(selector)
      if (!best || higher(value, best)) best = value
    }
  return best
}

const declares = (body: string, value: string) => new RegExp(`(^|;)\\s*word-break\\s*:\\s*${value}\\s*(;|$)`).test(body.trim())

describe('index.css — table cells keep their words whole (QA 2026-11-19)', () => {
  it('reaches a Typography inside a table cell, outranks antd’s break-word there, and leaves other Typography alone', async () => {
    render(
      <ConfigProvider direction="rtl">
        <Typography.Text data-testid="outside">خارج الجدول</Typography.Text>
        <Table
          rowKey="id"
          pagination={false}
          dataSource={[{ id: '1', due: '2026/11/19، 11:59 م' }]}
          columns={[{ key: 'due', title: 'آخر موعد', render: (_, row: { id: string; due: string }) => <Typography.Text data-testid="inside">{row.due}</Typography.Text> }]}
        />
      </ConfigProvider>,
    )
    const ours = rulesOf(await readSource('./index.css')).filter((rule) => declares(rule.body, 'normal'))
    expect(ours.length).toBeGreaterThan(0)
    const antd = rulesOf([...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n')).filter((rule) =>
      declares(rule.body, 'break-word'),
    )
    // antd really injects the rule this one beats — without it there would be nothing to fix.
    expect(antd.length).toBeGreaterThan(0)

    const inside = document.querySelector('[data-testid="inside"]')!
    const won = bestMatch(inside, ours)
    expect(won, 'index.css does not reach a Typography inside a table cell').not.toBeNull()
    const lost = bestMatch(inside, antd)
    expect(lost, 'antd no longer sets break-word on a Typography: the rule may be obsolete').not.toBeNull()
    expect(higher(won!, lost!), `${won!.join(',')} does not beat antd's ${lost!.join(',')}`).toBe(true)

    expect(bestMatch(document.querySelector('[data-testid="outside"]')!, ours)).toBeNull()
  })
})
