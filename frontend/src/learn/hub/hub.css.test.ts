import { describe, expect, it } from 'vitest'
import { HUB_ANTD_THEME, TABSEET_FONT_FAMILY } from './hub.theme'

/** Read a sibling/relative stylesheet from disk: vitest empties every `.css` import. */
async function readCss(relativePath: string): Promise<string> {
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
  return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
}

function declarationsOf(css: string, selector: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.split(',').map((s) => s.trim())
    if (!selectors.includes(selector)) continue
    for (const part of match[2]!.split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      const prop = part.slice(0, colon).trim()
      const val = part.slice(colon + 1).trim()
      if (prop && val) map.set(prop, val)
    }
  }
  return map
}

describe('«دروسي» — TabseetCourse Cairo typography and styles (J-F66)', () => {
  it('bundles Cairo locally in publicFonts.css with no external CDN URLs (CSP default-src self)', async () => {
    const fontsCss = await readCss('../../publicCatalog/publicFonts.css')
    expect(fontsCss).toContain("font-family: 'Public Cairo'")
    expect(fontsCss).toContain('cairo-arabic-wght-normal.woff2')
    expect(fontsCss).not.toMatch(/https?:\/\//i)
    expect(TABSEET_FONT_FAMILY).toContain("'Public Cairo'")
    expect(HUB_ANTD_THEME.token?.fontFamily).toBe(TABSEET_FONT_FAMILY)
    expect(HUB_ANTD_THEME.token?.colorPrimary).toBe('#113464')
  })

  it('applies Cairo and the exact TabseetCourse typography scale across .hub and .hub-sessions', async () => {
    const css = await readCss('./hub.css')
    expect(css).not.toMatch(/https?:\/\//i)

    const mobileIndex = css.indexOf('@media (max-width: 768px)')
    expect(mobileIndex).toBeGreaterThan(-1)
    const baseCss = css.slice(0, mobileIndex)
    const mobileCss = css.slice(css.indexOf('{', mobileIndex) + 1)

    const root = declarationsOf(baseCss, '.hub')
    expect(root.get('--hub-font')).toContain("'Public Cairo'")
    expect(root.get('font-family')).toBe('var(--hub-font)')
    expect(declarationsOf(baseCss, '.hub-sessions').get('font-family')).toBe('var(--hub-font)')

    // Exact TabseetCourse (CategoriesStd.cshtml) font sizes & weights.
    const tab = declarationsOf(baseCss, '.hub-tab')
    expect(tab.get('font-size')).toBe('14px')
    expect(tab.get('font-weight')).toBe('700')
    expect(declarationsOf(baseCss, '.hub-tab .anticon').get('font-size')).toBe('18px')

    const headerTitle = declarationsOf(baseCss, '.hub-header__title')
    expect(headerTitle.get('font-size')).toBe('26px')
    expect(headerTitle.get('font-weight')).toBe('800')
    expect(declarationsOf(mobileCss, '.hub-header__title').get('font-size')).toBe('22px')

    expect(declarationsOf(baseCss, '.hub-header__text').get('font-size')).toBe('14.5px')
    expect(declarationsOf(baseCss, '.hub-stat__value').get('font-size')).toBe('18px')
    expect(declarationsOf(baseCss, '.hub-stat__label').get('font-size')).toBe('12px')
    expect(declarationsOf(baseCss, '.hub-section-head h2').get('font-size')).toBe('19px')
    expect(declarationsOf(baseCss, '.hub-card__name').get('font-size')).toBe('17px')
    expect(declarationsOf(baseCss, '.hub-card__name').get('font-weight')).toBe('800')
    expect(declarationsOf(baseCss, '.hub-card__teacher').get('font-size')).toBe('13px')
    expect(declarationsOf(baseCss, '.hub-panel__title').get('font-size')).toBe('20px')
    expect(declarationsOf(baseCss, '.hub-panel__title').get('font-weight')).toBe('800')
    expect(declarationsOf(baseCss, '.hub-row__title').get('font-size')).toBe('15.5px')
    expect(declarationsOf(baseCss, '.hub-row__title').get('font-weight')).toBe('800')
    expect(declarationsOf(baseCss, '.hub-row__meta').get('font-size')).toBe('12.5px')
    expect(declarationsOf(baseCss, '.hub-pill').get('font-size')).toBe('12.5px')
    expect(declarationsOf(baseCss, '.hub-btn').get('font-size')).toBe('12.5px')
    expect(declarationsOf(baseCss, '.hub-btn--live').get('background')).toBe('#16a34a')
    for (const anchor of ['.hub-panel-anchor', '.hub-panel', '.hub-player', '.hub-list-anchor']) {
      expect(declarationsOf(baseCss, anchor).get('scroll-margin-block-start')).toBe('var(--ac-sticky-offset, 88px)')
    }
  })
})
