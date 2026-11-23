import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocationProbe } from '../test/LocationProbe'
import { renderWithProviders } from '../test/render'
import { CourseDoneModal } from './CourseDoneModal'

describe('CourseDoneModal (TEST-323)', () => {
  it('names the certificate the completion issued and opens «my certificates»', () => {
    renderWithProviders(<CourseDoneModal open certificate={{ id: 'c1', serial: 'ACA-2026-00009' }} onClose={vi.fn()} />, {
      routes: { '*': <LocationProbe /> },
    })
    expect(screen.getByText(/ACA-2026-00009/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('عرض شهادتي'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/my-certificates')
  })

  it('keeps the plain message without a certificate', () => {
    renderWithProviders(<CourseDoneModal open onClose={vi.fn()} />)
    expect(screen.getByText('العودة إلى فصولي')).toBeInTheDocument()
    expect(screen.queryByText('عرض شهادتي')).not.toBeInTheDocument()
  })
})
