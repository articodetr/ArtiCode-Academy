// The weekly schedule tab of the class drawer (J-F07). In its own file so the
// drawer's main test file stays untouched by J-F07 (J-F04 edits it too).
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { CLASS_ID, CLASS_READER_PERMISSIONS, makeClass } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeSchedule } from '../test/schedule'
import { ClassDrawer } from './ClassDrawer'

describe('ClassDrawer — weekly schedule tab', () => {
  it('opens the weekly schedule tab and reads the class schedule; a reader gets no edit button', async () => {
    mockFetch((url, init) => {
      const parsed = new URL(url, 'http://localhost')
      if ((init?.method ?? 'GET') !== 'GET') return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
      if (parsed.pathname === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass())
      if (parsed.pathname === `/api/classes/${CLASS_ID}/schedule`) return jsonResponse(200, makeSchedule())
      if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    })
    renderWithProviders(<ClassDrawer classId={CLASS_ID} onClose={vi.fn()} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
      auth: makeAuth({ user: makeUser({ permissions: CLASS_READER_PERMISSIONS }) }),
      route: '/classes',
    })
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByRole('tab', { name: ar.classSchedule.tab }))
    expect(await screen.findByText('10:00–11:00')).toBeInTheDocument()
    expect(screen.getByText('LAB-1 — مختبر 1')).toBeInTheDocument()
    expect(screen.queryByText(ar.classSchedule.edit)).not.toBeInTheDocument()
  })
})
