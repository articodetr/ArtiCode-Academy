// PORTAL-04: <PublicTitle> names the tab «page — academy» while it is shown and puts the previous title back.
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PublicAcademyNameContext } from './pageTitle'
import { PublicTitle } from './PublicTitle'

describe('PublicTitle', () => {
  afterEach(() => {
    document.title = ''
  })

  it('sets «page — academy» and restores the previous title when it goes', () => {
    document.title = 'قبل'
    const { unmount } = render(
      <PublicAcademyNameContext value="أكاديمية النور">
        <PublicTitle page="الدورات" />
      </PublicAcademyNameContext>,
    )
    expect(document.title).toBe('الدورات — أكاديمية النور')
    unmount()
    expect(document.title).toBe('قبل')
  })

  it('follows a page name that arrives later, and leaves the title alone with nothing to show', () => {
    document.title = 'قبل'
    const { rerender, unmount } = render(
      <PublicAcademyNameContext value="">
        <PublicTitle />
      </PublicAcademyNameContext>,
    )
    expect(document.title).toBe('قبل')
    rerender(
      <PublicAcademyNameContext value="أكاديمية النور">
        <PublicTitle page="أساسيات بايثون" />
      </PublicAcademyNameContext>,
    )
    expect(document.title).toBe('أساسيات بايثون — أكاديمية النور')
    unmount()
    expect(document.title).toBe('قبل')
  })
})
