import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { renderWithProviders } from '../test/render'
import { ProfileSessions } from './ProfileSessions'

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36'
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const session = (id: string, userAgent: string | null, current: boolean) => ({
  id, startedAt: '2026-11-15T08:00:00.000Z', lastActiveAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-11-22T10:00:00.000Z', userAgent, ipAddress: '::ffff:203.0.113.7', current,
})

function mockSessions(items: unknown[]) {
  const calls: Array<{ method: string; url: string }> = []
  let list = items
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url })
    if (method === 'DELETE') {
      list = (list as Array<{ id: string }>).filter((item) => !url.endsWith(item.id))
      return new Response(null, { status: 204 })
    }
    return jsonResponse(200, { items: list })
  })
  return calls
}

const row = (id: string) => document.querySelector(`[data-session="${id}"]`) as HTMLElement

describe('ProfileSessions (CH-0265 — API-201/202)', () => {
  it('lists the devices with this one marked and signs another one out after a confirmation', async () => {
    const calls = mockSessions([session('s-here', CHROME_WIN, true), session('s-phone', SAFARI_IOS, false)])
    renderWithProviders(<ProfileSessions />)
    expect(await screen.findByText(ar.profile.sessions.browserOn.replace('{{browser}}', 'Chrome').replace('{{system}}', 'Windows'))).toBeInTheDocument()
    expect(within(row('s-here')).getByText(ar.profile.sessions.thisDevice)).toBeInTheDocument()
    expect(within(row('s-here')).queryByText(ar.profile.sessions.signOut)).toBeNull()
    expect(within(row('s-phone')).getByText('203.0.113.7')).toBeInTheDocument()

    fireEvent.click(within(row('s-phone')).getByText(ar.profile.sessions.signOut).closest('button')!)
    const confirm = await screen.findByText(ar.profile.sessions.confirmOne.replace('{{device}}', ar.profile.sessions.browserOn.replace('{{browser}}', 'Safari').replace('{{system}}', 'iOS')))
    fireEvent.click(within(confirm.closest('.ant-popover') as HTMLElement).getByText(ar.profile.sessions.signOut).closest('button')!)
    await waitFor(() => expect(row('s-phone')).toBeNull())
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(['/api/auth/sessions/s-phone'])
  })

  it('signs out every other device and keeps this one', async () => {
    const calls = mockSessions([session('s-here', CHROME_WIN, true), session('s-a', SAFARI_IOS, false), session('s-b', null, false)])
    renderWithProviders(<ProfileSessions />)
    fireEvent.click((await screen.findByText(ar.profile.sessions.signOutOthers)).closest('button')!)
    const confirm = await screen.findByText(ar.profile.sessions.confirmOthers.replace('{{count}}', '2'))
    fireEvent.click(within(confirm.closest('.ant-popover') as HTMLElement).getByText(ar.profile.sessions.signOutOthers).closest('button')!)
    await waitFor(() => expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(2))
    expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('s-here'))).toBe(false)
    await waitFor(() => expect(row('s-a')).toBeNull())
    expect(row('s-here')).not.toBeNull()
  })

  it('keeps «sign out all other devices» off when no row is this device (no refresh cookie sent)', async () => {
    const calls = mockSessions([session('s-a', CHROME_WIN, false), session('s-b', SAFARI_IOS, false)])
    renderWithProviders(<ProfileSessions />)
    const others = (await screen.findByText(ar.profile.sessions.signOutOthers)).closest('button')!
    expect(others).toBeDisabled()
    expect(screen.getByTestId('sessions-unknown-device')).toHaveTextContent(ar.profile.sessions.thisDeviceUnknown)
    expect(screen.queryByText(ar.profile.sessions.thisDevice)).toBeNull()

    fireEvent.click(others)
    expect(screen.queryByText(ar.profile.sessions.confirmOthers.replace('{{count}}', '2'))).toBeNull()
    // Each device can still be signed out on its own.
    expect(within(row('s-a')).getByText(ar.profile.sessions.signOut).closest('button')).toBeEnabled()
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([])
  })
})
