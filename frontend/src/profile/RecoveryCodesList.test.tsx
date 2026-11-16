// The once-only recovery codes view on its own: how long the link of a downloaded file lives, and the keys of
// the list. What the dialogs do around it (the tick, «close», the cursor, leaving the page) is in
// ProfileMfa.test.tsx and ProfileMfa.navigation.test.tsx.
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { renderWithProviders } from '../test/render'
import { DOWNLOAD_LINK_LIFETIME_MS, RecoveryCodesList } from './RecoveryCodesList'

const CODES = ['K7QX4-M9TRB', 'P3ZWN-8HDCA', 'A2B3C-4D5E6']

/** jsdom has no Blob links: each download gets the next `blob:codes-n`, and every revoked link is recorded. */
function stubBlobLinks() {
  let made = 0
  const createObjectURL = vi.fn((_blob: Blob) => `blob:codes-${++made}`)
  const revokeObjectURL = vi.fn((_url: string) => undefined)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL })
  // The click on the temporary link would make jsdom try to navigate to it.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  return { createObjectURL, revokeObjectURL }
}

function renderList(codes: readonly string[] = CODES) {
  return renderWithProviders(
    <RecoveryCodesList codes={codes} generatedAt="2026-11-16T09:31:12.000Z" saved={false} onSavedChange={vi.fn()} onDone={vi.fn()} />,
  )
}

const download = () => fireEvent.click(screen.getByText(ar.profile.mfa.codes.download).closest('button')!)

describe('RecoveryCodesList — the link of a downloaded file', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the link for a minute — a browser that starts the download late still finds the file — then revokes it once', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { createObjectURL, revokeObjectURL } = stubBlobLinks()
    const { unmount } = renderList()

    download()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    // Not at once (Firefox and Safari read the Blob after the click has returned), and not a moment early.
    vi.advanceTimersByTime(0)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(DOWNLOAD_LINK_LIFETIME_MS - 1)
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:codes-1')

    // Already revoked: the view going does not revoke it a second time.
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('revokes the links that are left, and drops their timers, when the view goes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { revokeObjectURL } = stubBlobLinks()
    const { unmount } = renderList()

    download()
    vi.advanceTimersByTime(1_000)
    download()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    // The dialog closes: no link to a file of the codes outlives the codes.
    unmount()
    expect(revokeObjectURL.mock.calls.map(([url]) => url).sort()).toEqual(['blob:codes-1', 'blob:codes-2'])

    // No timer was left behind to fire later.
    vi.advanceTimersByTime(DOWNLOAD_LINK_LIFETIME_MS * 2)
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})

describe('RecoveryCodesList — the list', () => {
  it('keys the codes by position, so no code is a React key (a repeated code raises no duplicate-key warning)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderList(['K7QX4-M9TRB', 'K7QX4-M9TRB', 'P3ZWN-8HDCA'])

    const items = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual(['K7QX4-M9TRB', 'K7QX4-M9TRB', 'P3ZWN-8HDCA'])
    expect(errors.mock.calls.filter(([first]) => /same key/i.test(String(first)))).toEqual([])
  })
})
