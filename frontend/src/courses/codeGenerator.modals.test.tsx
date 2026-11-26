// TEST-332 — the generated code in the subject and level forms (CH-0372).
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { LevelModal } from './LevelModal'
import { SubjectModal } from './SubjectModal'

const auth = makeAuth({ user: makeUser({ permissions: ['courses.read', 'courses.manage'] }) })

function codeField(): HTMLInputElement {
  return screen.getByPlaceholderText(/MATH|BEG/) as HTMLInputElement
}

describe('the generated code (CH-0372)', () => {
  it('fills a new subject with a SUB- code that is not taken, and «توليد رمز» draws another', async () => {
    const taken = ['MATH', 'SUB-AAAA']
    renderWithProviders(<SubjectModal open subject={null} onClose={vi.fn()} onSaved={vi.fn()} takenCodes={taken} />, { auth })
    const first = codeField().value
    expect(first).toMatch(/^SUB-[A-Z2-9]{4}$/)
    expect(taken).not.toContain(first)
    // The user may still type their own.
    fireEvent.change(codeField(), { target: { value: 'my-code' } })
    expect(codeField().value).toBe('MY-CODE')
    fireEvent.click(screen.getByText(ar.courses.generateCode).closest('button')!)
    await waitFor(() => expect(codeField().value).toMatch(/^SUB-[A-Z2-9]{4}$/))
    expect(taken).not.toContain(codeField().value)
  })

  it('fills a new level with an LVL- code, and keeps the stored code of a level being edited', () => {
    renderWithProviders(<LevelModal open level={null} onClose={vi.fn()} onSaved={vi.fn()} takenCodes={['LVL-AAAA']} />, { auth })
    expect(codeField().value).toMatch(/^LVL-[A-Z2-9]{4}$/)
  })
})
