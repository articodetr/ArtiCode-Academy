// PORTAL-04: the tab title of the public pages — «page — academy».
import { describe, expect, it } from 'vitest'
import { publicTitleOf } from './pageTitle'

describe('publicTitleOf', () => {
  it('joins the page and the academy', () => {
    expect(publicTitleOf('الدورات', 'أكاديمية النور')).toBe('الدورات — أكاديمية النور')
    expect(publicTitleOf(undefined, 'أكاديمية النور')).toBe('أكاديمية النور')
    expect(publicTitleOf('  أساسيات بايثون ', '')).toBe('أساسيات بايثون')
  })

  it('leaves the document title alone when there is nothing to show', () => {
    expect(publicTitleOf(undefined, '')).toBeNull()
    expect(publicTitleOf('   ', '  ')).toBeNull()
  })
})
