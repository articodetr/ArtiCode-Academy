import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AcademyClass } from '../api/classes'
import { ar } from '../i18n/ar'
import { makeClassCertificates, makePreviewItem } from '../test/certificates'
import { CLASS_ID, CLASS_MANAGER_PERMISSIONS, CLASS_READER_PERMISSIONS, makeClass } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ClassDrawer } from './ClassDrawer'

const STAFF = [...CLASS_MANAGER_PERMISSIONS, 'certificates.issue']

/** The class detail (re-read on every call), its certificates preview and the status action. */
function mockDrawerApi(initial: AcademyClass) {
  let current = initial
  const previews: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (url === `/api/classes/${CLASS_ID}/certificates` && method === 'GET') {
      previews.push(current.status)
      const completed = current.status === 'completed'
      return jsonResponse(
        200,
        makeClassCertificates({
          class: { id: CLASS_ID, code: current.code, name: current.name, status: current.status },
          issuable: completed ? 1 : 0,
          items: [makePreviewItem({ enrollmentStatus: completed ? 'completed' : 'active', reason: completed ? null : 'not_completed' })],
        }),
      )
    }
    if (url === `/api/classes/${CLASS_ID}/status` && method === 'POST') {
      current = { ...current, status: 'completed', updatedAt: '2026-12-20T15:00:00.000Z' }
      return jsonResponse(200, current)
    }
    if (url === `/api/classes/${CLASS_ID}` && method === 'GET') return jsonResponse(200, current)
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${method} ${url}` })
  })
  return { previews }
}

function renderDrawer(permissions: string[]) {
  renderWithProviders(<ClassDrawer classId={CLASS_ID} onClose={vi.fn()} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/classes',
  })
}

function tabNames(): string[] {
  return [...document.querySelectorAll('.ant-tabs-tab')].map((tab) => tab.textContent ?? '')
}

describe('ClassDrawer — certificates tab (J-F51)', () => {
  it('shows the certificates tab after the others to a holder of certificates.issue, and reads API-136 only once it opens', async () => {
    const api = mockDrawerApi(makeClass({ status: 'running', enrolledCount: 1 }))
    renderDrawer(STAFF)
    await screen.findByText('PY-101-A')

    expect(tabNames().at(-1)).toBe(ar.certificates.classTab.tab)
    expect(api.previews).toEqual([])
    fireEvent.click(screen.getByText(ar.certificates.classTab.tab))
    expect(await screen.findByText(ar.certificates.classTab.reasons.not_completed)).toBeInTheDocument()
    expect(api.previews).toEqual(['running'])
  })

  it('reads the preview again when the class is completed from the drawer’s menu, so the eligible can be issued', async () => {
    const api = mockDrawerApi(makeClass({ status: 'running', enrolledCount: 1 }))
    renderDrawer(STAFF)
    await screen.findByText('PY-101-A')
    fireEvent.click(screen.getByText(ar.certificates.classTab.tab))
    await screen.findByText(ar.certificates.classTab.reasons.not_completed)

    fireEvent.click(screen.getByText(ar.classes.actions.menu).closest('button')!)
    fireEvent.click(await screen.findByText(ar.classes.actions.complete, { selector: '.ant-dropdown-menu-title-content' }))
    const dialog = screen.getByText(ar.classes.confirm.complete).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.classes.actions.complete).closest('button')!)

    expect(await screen.findByText(ar.certificates.classTab.eligible)).toBeInTheDocument()
    await waitFor(() => expect(api.previews).toEqual(['running', 'completed']))
    expect(screen.getByText(ar.certificates.classTab.issueAll.replace('{{count}}', '1')).closest('button')).toBeEnabled()
  })

  it('shows no certificates tab to a teacher (no certificates key by seed)', async () => {
    mockDrawerApi(makeClass({ status: 'completed' }))
    renderDrawer(CLASS_READER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(tabNames()).not.toContain(ar.certificates.classTab.tab)
  })
})
