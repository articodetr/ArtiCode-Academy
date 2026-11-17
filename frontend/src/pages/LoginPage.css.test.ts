// The page rule of LoginPage.css (QA V3/V5, 1366 × 900): the blue background of the sign-in page and of the public
// pages (/verify, the token pages — account/PublicCard.tsx) stopped under the card and left white below it, because
// `min-height: 100%` never resolved inside Ant Design's App wrapper. jsdom lays nothing out and Vitest blanks imported
// stylesheets, so this test reads the stylesheet's text and asserts the configuration; the height itself is checked in
// a real browser.
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
  // Not `new URL('./LoginPage.css', import.meta.url)`: Vite rewrites that form into the asset's served URL.
  css = readFileSync(fileURLToPath(import.meta.url).replace(/LoginPage\.css\.test\.ts$/, 'LoginPage.css'), 'utf8')
})

/** Every value of `property` in the rule written exactly with `selector`, in order (a fallback comes first). */
function valuesOf(selector: string, property: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.trim() !== selector) continue
    return match[2]!
      .split(';')
      .map((part) => part.split(':').map((side) => side.trim()))
      .filter(([name, value]) => name === property && value)
      .map(([, value]) => value!)
  }
  return []
}

describe('LoginPage.css — the page fills the viewport', () => {
  it('sizes .login-page by the viewport — 100vh, then 100dvh where supported — never by a parent that has no height', () => {
    expect(valuesOf('.login-page', 'min-height')).toEqual(['100vh', '100dvh'])
    // The gradient stays on the rule that now covers the viewport.
    expect(valuesOf('.login-page', 'background')[0]).toMatch(/^linear-gradient\(/)
  })
})
