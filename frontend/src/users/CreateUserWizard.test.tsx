import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, makeUserDetail } from '../test/users'
import { CreateUserWizard } from './CreateUserWizard'

function mockCreateApi(respond: (body: Record<string, unknown>) => Response = (body) => jsonResponse(201, { ...makeUserDetail(), ...body })) {
  const bodies: Record<string, unknown>[] = []
  mockFetch((_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    bodies.push(body)
    return respond(body)
  })
  return bodies
}

function renderWizard(permissions: string[] = ADMIN_PERMISSIONS) {
  const onCreated = vi.fn()
  renderWithProviders(<CreateUserWizard open onClose={vi.fn()} onCreated={onCreated} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
  })
  return { onCreated }
}

const buttons = {
  next: () => screen.getByRole('button', { name: ar.users.create.next }),
  back: () => screen.getByRole('button', { name: ar.users.create.back }),
  submit: () => screen.getByRole('button', { name: ar.users.create.submit }),
}

async function chooseKind(kind: keyof typeof ar.users.kinds) {
  await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^${ar.users.kinds[kind]}`) }))
  await userEvent.click(buttons.next())
}

async function fill(label: string, value: string) {
  await userEvent.type(screen.getByLabelText(label), value)
}

describe('CreateUserWizard', () => {
  it('walks kind → identity → details and posts the API-014 body of a teacher with an employee profile and an extra role', async () => {
    const bodies = mockCreateApi()
    const { onCreated } = renderWizard()

    await chooseKind('teacher')
    await fill(ar.users.fields.fullName, ' سارة أحمد ')
    await fill(ar.users.fields.email, 'Sara@Test.local')
    await userEvent.click(buttons.next())

    await fill(ar.users.fields.employeeNumber, 'EMP-017')
    await fill(ar.users.fields.jobTitle, 'معلمة رياضيات')
    fireEvent.change(screen.getByLabelText(ar.users.fields.hiredOn), { target: { value: '2025-02-10' } })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.users.fields.roleKeys }))
    fireEvent.click(await screen.findByText(ar.roles.admin, { selector: '.ant-select-item-option-content' }))
    await userEvent.click(buttons.submit())

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      kind: 'teacher',
      fullName: 'سارة أحمد',
      email: 'sara@test.local',
      employeeProfile: { employeeNumber: 'EMP-017', jobTitle: 'معلمة رياضيات', hiredOn: '2025-02-10' },
      roleKeys: ['academy_admin'],
    })
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ kind: 'teacher', fullName: 'سارة أحمد' }))
  })

  it('refuses to leave the identity step without an e-mail or a username', async () => {
    const bodies = mockCreateApi()
    renderWizard()

    await chooseKind('student')
    await fill(ar.users.fields.fullName, 'عمر خالد')
    await userEvent.click(buttons.next())

    expect(await screen.findAllByText(ar.users.validation.identifierRequired)).toHaveLength(2)
    expect(screen.queryByLabelText(ar.users.fields.studentNumber)).not.toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('shows the student profile with notes but no roles field without users.roles.assign', async () => {
    mockCreateApi()
    renderWizard(['users.read', 'users.read_contact', 'users.create'])

    await chooseKind('student')
    await fill(ar.users.fields.fullName, 'عمر خالد')
    await fill(ar.users.fields.username, 'omar')
    await userEvent.click(buttons.next())

    expect(screen.getByLabelText(ar.users.fields.studentNumber)).toBeInTheDocument()
    expect(screen.getByLabelText(ar.users.fields.notes)).toBeInTheDocument()
    expect(screen.queryByText(ar.users.fields.roleKeys)).not.toBeInTheDocument()
    expect(buttons.submit()).toBeInTheDocument()
  })

  it('creates a guardian from the identity step when there is nothing else to fill in', async () => {
    const bodies = mockCreateApi()
    const { onCreated } = renderWizard(['users.read', 'users.read_contact', 'users.create'])

    await chooseKind('guardian')
    expect(screen.queryByRole('button', { name: ar.users.create.next })).not.toBeInTheDocument()
    await fill(ar.users.fields.fullName, 'خالد محمود')
    await fill(ar.users.fields.phone, '+905551234567')
    await fill(ar.users.fields.username, 'khaled')
    await userEvent.click(buttons.submit())

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ kind: 'guardian', fullName: 'خالد محمود', username: 'khaled', phone: '+905551234567' })
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('returns to the identity step and marks the username field on a 409 username_in_use', async () => {
    const bodies = mockCreateApi(() => jsonResponse(409, { statusCode: 409, code: 'username_in_use', message: 'taken' }))
    const { onCreated } = renderWizard()

    await chooseKind('student')
    await fill(ar.users.fields.fullName, 'عمر خالد')
    await fill(ar.users.fields.username, 'omar')
    await userEvent.click(buttons.next())
    expect(screen.getByLabelText(ar.users.fields.studentNumber)).toBeInTheDocument()
    await userEvent.click(buttons.submit())

    await waitFor(() => expect(bodies).toHaveLength(1))
    const username = await screen.findByLabelText(ar.users.fields.username)
    expect(username).toHaveValue('omar')
    expect(await screen.findAllByText(ar.users.errors.username_in_use)).not.toHaveLength(0)
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('shows a permission refusal as an alert and keeps the entered values', async () => {
    mockCreateApi(() => jsonResponse(403, { statusCode: 403, code: 'permission_denied', message: 'Missing permission', missing: ['users.roles.assign'] }))
    renderWizard()

    await chooseKind('guardian')
    await fill(ar.users.fields.fullName, 'خالد محمود')
    await fill(ar.users.fields.email, 'khaled@test.local')
    await userEvent.click(buttons.next())
    await userEvent.click(buttons.submit())

    // The details step of a guardian also shows the informational "no profile" alert; look for the failure text.
    expect(await screen.findByText('ليست لديك الصلاحية اللازمة لهذا الإجراء (users.roles.assign)')).toBeInTheDocument()
    await userEvent.click(buttons.back())
    expect(within(screen.getByRole('dialog')).getByLabelText(ar.users.fields.email)).toHaveValue('khaled@test.local')
  })
})
