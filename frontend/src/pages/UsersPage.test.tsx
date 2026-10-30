import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { mockUsers } from '../mock/data'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { UsersPage } from './UsersPage'

// Smoke test for the Ant Design table inside the harness. The page still renders
// mock data; MOD-03-T11 replaces it with the real users list and extends this file.
describe('UsersPage (prototype)', () => {
  function renderPage() {
    return renderWithProviders(<UsersPage />, { auth: makeAuth({ user: makeUser() }), route: '/users' })
  }

  it('shows the heading and one row per mock user with the Arabic name and role label', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: ar.users.title })).toBeInTheDocument()

    const table = screen.getByRole('table')
    const [header, ...body] = within(table).getAllByRole('row')
    expect(within(header).getByRole('columnheader', { name: ar.common.name })).toBeInTheDocument()
    expect(body).toHaveLength(mockUsers.length)

    const first = mockUsers[0]
    expect(within(body[0]).getByText(first.name.ar)).toBeInTheDocument()
    expect(within(body[0]).getByText(ar.roles[first.role])).toBeInTheDocument()
  })

  it('tells the visitor that adding a user is not implemented yet', async () => {
    renderPage()
    // The icon's aria-label ("plus") is part of the accessible name, so match the label as a substring.
    await userEvent.click(screen.getByRole('button', { name: new RegExp(ar.users.addUser) }))
    expect(await screen.findByText(ar.common.notImplemented)).toBeInTheDocument()
  })
})
