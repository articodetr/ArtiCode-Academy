// RequestCard (MOD-19, shown in «مدرستي» → «طلبات الاشتراك»): a pending request shows its payment state and totals; a
// closed one (rejected, cancelled, withdrawn) never shows «no invoice issued» with totals of 0.00 — its cancelled
// invoices are listed with their status instead (found by the MOD-19 acceptance run of 2026-11-19).
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeMyRequest } from '../test/catalog'
import { renderWithProviders } from '../test/render'
import { RequestCard } from './RequestCard'

describe('RequestCard', () => {
  it('shows the payment state and the totals of a pending request', () => {
    renderWithProviders(<RequestCard request={makeMyRequest()} busy={false} onCancel={vi.fn()} />)
    expect(screen.getByText('الإجمالي')).toBeInTheDocument()
    expect(screen.getByText('المتبقي')).toBeInTheDocument()
  })

  it('shows no payment state and no totals for a rejected request', () => {
    const rejected = makeMyRequest({
      status: 'cancelled',
      state: 'rejected',
      decidedAt: '2026-11-19T10:00:00.000Z',
      rejectionReason: 'الفصل مكتمل',
      payment: { state: 'missing', required: true, total: 0, paid: 0, balance: 0, currency: 'SAR', invoices: [] },
    })
    renderWithProviders(<RequestCard request={rejected} busy={false} onCancel={vi.fn()} />)
    expect(screen.queryByText('الإجمالي')).not.toBeInTheDocument()
    expect(screen.queryByText('المتبقي')).not.toBeInTheDocument()
  })
})
