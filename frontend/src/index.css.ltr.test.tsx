// The left-to-right fields of index.css (QA 2026-11-17): a field marked `dir="ltr"` keeps that direction in the Arabic
// UI. jsdom lays nothing out and Vitest blanks imported CSS, so this reads the rule from the file's text and checks it
// against the DOM antd 6 really renders in RTL — the element that carries `dir="ltr"` matches the rule, and the rule
// outranks every `direction: rtl` rule antd injected for that element (its `-rtl` classes, which beat the attribute).
import { render, screen } from '@testing-library/react'
import { AutoComplete, Button, ConfigProvider, Form, Input, InputNumber, Select, Space } from 'antd'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { GeneralSettingsForm } from './academy/GeneralSettingsForm'
import { ar } from './i18n/ar'
import { SETTINGS_MANAGER_PERMISSIONS, makeAcademy } from './test/academy'
import { jsonResponse, mockFetch } from './test/http'
import { makeAuth, makeUser, renderWithProviders } from './test/render'

/** A file of src/ read from disk: vitest empties every `.css` import, `?raw` included. */
async function readSource(path: string): Promise<string> {
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
  // A variable, not a literal: Vite rewrites `new URL('./index.css', import.meta.url)` into the asset's served URL.
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

const higher = (a: number[], b: number[]) => a[0]! !== b[0]! ? a[0]! > b[0]! : a[1]! !== b[1]! ? a[1]! > b[1]! : a[2]! > b[2]!

/** Whether `selector` matches `element`; `:where(x)` is read as `x` (the element carries antd's hash class anyway). */
function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector.replace(/:where\(([^()]*)\)/g, '$1'))
  } catch {
    return false
  }
}

/** The best specificity among the given rules' selectors that match `element`, or null when none does. */
function bestMatch(element: Element, rules: CssRule[]): [number, number, number] | null {
  let best: [number, number, number] | null = null
  for (const rule of rules) for (const selector of rule.selectors) {
    if (!matches(element, selector)) continue
    const value = specificity(selector)
    if (!best || higher(value, best)) best = value
  }
  return best
}

const declares = (body: string, value: 'ltr' | 'rtl') => new RegExp(`(^|;)\\s*direction\\s*:\\s*${value}\\s*(;|$)`).test(body.trim())

/** index.css's rules that set `direction: ltr`. */
async function ltrRules(): Promise<CssRule[]> {
  return rulesOf(await readSource('./index.css')).filter((rule) => declares(rule.body, 'ltr'))
}

/** The `direction: rtl` rules antd injected into the document for what is rendered. */
function antdRtlRules(): CssRule[] {
  const css = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n')
  return rulesOf(css).filter((rule) => declares(rule.body, 'rtl'))
}

/** Every antd field on screen that carries `dir="ltr"` — the input, the textarea or the select's root. */
const ltrFields = (root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>('input[dir="ltr"], textarea[dir="ltr"], .ant-select[dir="ltr"]')]

/** Each field keeps its direction: index.css reaches it, and outranks every antd rule that would turn it RTL. */
async function expectLtr(fields: HTMLElement[]) {
  const ours = await ltrRules()
  expect(ours.length).toBeGreaterThan(0)
  const antd = antdRtlRules()
  // Without the RTL classes there would be nothing to beat: the rendering must be the Arabic one.
  expect(antd.length).toBeGreaterThan(0)
  for (const field of fields) {
    const won = bestMatch(field, ours)
    expect(won, `index.css does not reach ${field.outerHTML}`).not.toBeNull()
    const lost = bestMatch(field, antd)
    if (lost) expect(higher(won!, lost), `${field.outerHTML}: ${won!.join(',')} does not beat antd's ${lost.join(',')}`).toBe(true)
  }
}

/** `dir="ltr"` for a component whose props type omits it (see `select` below). */
const LTR_DIR = { dir: 'ltr' } as object

const SHAPES: Record<string, ReactNode> = {
  plain: <Input dir="ltr" placeholder="https://" />,
  readOnly: <Input dir="ltr" readOnly value="qa1" />,
  email: <Input dir="ltr" type="email" />,
  maxLength: <Input dir="ltr" maxLength={3} placeholder="SAR" />,
  password: <Input.Password dir="ltr" />,
  clear: <Input dir="ltr" allowClear placeholder="uuid" />,
  suffix: <Input dir="ltr" type="time" suffix="(+1)" />,
  count: <Input dir="ltr" showCount maxLength={64} />,
  addon: <Input dir="ltr" addonAfter="@" />,
  compact: (
    <Space.Compact>
      <Input dir="ltr" readOnly value="https://academy.example/invite/abc" />
      <Button>نسخ</Button>
    </Space.Compact>
  ),
  textArea: <Input.TextArea dir="ltr" rows={2} />,
  textAreaCount: <Input.TextArea dir="ltr" rows={2} showCount maxLength={200} />,
  number: <InputNumber dir="ltr" />,
  numberSuffix: <InputNumber dir="ltr" suffix="%" />,
  // antd's Select/AutoComplete types leave `dir` out although the root renders it; no screen passes it today (the
  // audit page's event field uses a class), so it goes through an untyped spread to keep the rule's selector tested.
  select: <Select {...LTR_DIR} options={[{ value: 'a', label: 'a' }]} />,
  autoComplete: <AutoComplete {...LTR_DIR} options={[{ value: 'Asia/Riyadh' }]} />,
}

describe('index.css — a field marked dir="ltr" stays left to right in the Arabic UI (QA 2026-11-17)', () => {
  it('reaches every shape antd 6 renders a dir="ltr" field in, and outranks antd’s RTL classes on each', async () => {
    render(
      <ConfigProvider direction="rtl">
        <Form layout="vertical">
          {Object.entries(SHAPES).map(([name, field]) => (
            <Form.Item key={name} label={name} data-shape={name}>
              {field}
            </Form.Item>
          ))}
        </Form>
      </ConfigProvider>,
    )
    const fields = ltrFields()
    // One field per shape: the attribute lands on the input, the textarea or the select's root.
    expect(fields).toHaveLength(Object.keys(SHAPES).length)
    // antd puts its RTL class on these very elements — the reason the attribute alone was not enough.
    expect(document.querySelector('input.ant-input-rtl[dir="ltr"]')).not.toBeNull()
    expect(document.querySelector('.ant-select-rtl[dir="ltr"]')).not.toBeNull()
    await expectLtr(fields)
  })

  it('covers every left-to-right field of the general settings tab (logo URL, phone, e-mail, names, currency, slug, serial prefix)', async () => {
    mockFetch((url) => (url === '/api/academy' ? jsonResponse(200, makeAcademy()) : jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })))
    renderWithProviders(<GeneralSettingsForm />, { auth: makeAuth({ user: makeUser({ permissions: SETTINGS_MANAGER_PERMISSIONS }) }), route: '/settings' })
    await screen.findByLabelText(ar.settings.contactPhone)
    const fields = ltrFields()
    expect(fields).toContain(screen.getByLabelText(ar.settings.contactPhone))
    expect(fields).toContain(screen.getByLabelText(ar.settings.logoUrl))
    expect(fields).toContain(screen.getByLabelText(ar.settings.slug))
    expect(fields.length).toBeGreaterThanOrEqual(7)
    await expectLtr(fields)
  })
})
