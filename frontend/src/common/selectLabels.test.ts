import { afterEach, describe, expect, it, vi } from 'vitest'
import { labelUnlabelledSelects } from './selectLabels'

function select(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = `<div class="ant-select">${html}<div class="ant-select-placeholder">كل الدورات</div></div>`
  document.body.append(host)
  return host
}

describe('labelUnlabelledSelects (quality pass)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('names a combobox without a label after its placeholder and leaves a labelled one alone', () => {
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => run())
    const bare = select('<input role="combobox" />')
    const named = select('<input role="combobox" aria-label="الفصل" />')
    const stop = labelUnlabelledSelects()
    expect(bare.querySelector('input')).toHaveAttribute('aria-label', 'كل الدورات')
    expect(named.querySelector('input')).toHaveAttribute('aria-label', 'الفصل')
    stop()
  })
})
