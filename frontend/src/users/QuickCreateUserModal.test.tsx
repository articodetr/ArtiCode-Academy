// The one-step «إضافة طالب» / «إضافة مدرس» form: POST /api/users (API-014) with three fields, then the invitation
// (API-015) at once. The page's part (the link shown once, the drawer, the messages) is in UsersPage.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { IssuedLink } from '../api/account'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, makeUserDetail } from '../test/users'
import { QuickCreateUserModal } from './QuickCreateUserModal'
import type { QuickCreateKind } from './users.quickCreate'

const CREATED_ID = '0192f0a0-0000-7000-8000-0000000000aa'
const TOKEN = 'tok_'.padEnd(43, 'q')

function issuedFor(userId: string): IssuedLink {
  return { userId, token: TOKEN, link: `/invite/${TOKEN}`, expiresAt: '2026-11-28T10:00:00.000Z', delivery: { transport: 'none', status: 'skipped' } }
}

interface Calls {
  creates: Record<string, unknown>[]
  invitations: string[]
}

/** POST /api/users answers `create`; POST /api/users/:id/invitations answers `invite`. */
function mockQuickCreateApi(
  create: (body: Record<string, unknown>) => Response | Promise<Response> = (body) =>
    jsonResponse(201, makeUserDetail({ id: CREATED_ID, ...body, status: 'invited', guardians: [] })),
  invite: (url: string) => Response = (url) => jsonResponse(201, issuedFor(url.split('/')[3]!)),
): Calls {
  const calls: Calls = { creates: [], invitations: [] }
  mockFetch((url, init) => {
    if (url === '/api/users' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      calls.creates.push(body)
      return create(body)
    }
    if (url.endsWith('/invitations') && init?.method === 'POST') {
      calls.invitations.push(url)
      return invite(url)
    }
    return jsonResponse(404, { statusCode: 404, message: 'Not found' })
  })
  return calls
}

function renderModal(kind: QuickCreateKind) {
  const onCreated = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<QuickCreateUserModal kind={kind} onClose={onClose} onCreated={onCreated} />, {
    auth: makeAuth({ user: makeUser({ permissions: ADMIN_PERMISSIONS }) }),
  })
  const dialog = screen.getByRole('dialog')
  return { onCreated, onClose, dialog }
}

async function fill(dialog: HTMLElement, label: string | RegExp, value: string) {
  await userEvent.type(within(dialog).getByLabelText(label), value)
}

function submitButton(dialog: HTMLElement, kind: QuickCreateKind) {
  // The title carries the same words: pick the button's own text.
  return within(dialog).getByText(ar.users.quick.submit[kind], { selector: 'button span' }).closest('button')!
}

const BACKUP_PHONE = new RegExp(ar.users.quick.fields.backupPhone)

describe('QuickCreateUserModal', () => {
  it('creates a student from a name and an e-mail only, then issues the invitation at once', async () => {
    const calls = mockQuickCreateApi()
    const { onCreated, dialog } = renderModal('student')

    expect(within(dialog).getByText(ar.users.quick.title.student, { selector: '.ant-modal-title' })).toBeInTheDocument()
    // Exactly three fields: no username, password, locale, profile or roles.
    expect(dialog.querySelectorAll('input')).toHaveLength(3)
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(dialog).getByText(`(${ar.users.quick.optional})`)).toBeInTheDocument()

    await fill(dialog, ar.users.fields.fullName, ' عمر خالد ')
    await fill(dialog, ar.users.fields.email, 'Omar@Test.local')
    await userEvent.click(submitButton(dialog, 'student'))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(calls.creates).toEqual([{ kind: 'student', fullName: 'عمر خالد', email: 'omar@test.local' }])
    expect(calls.invitations).toEqual([`/api/users/${CREATED_ID}/invitations`])
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'student', user: expect.objectContaining({ id: CREATED_ID }), invitation: issuedFor(CREATED_ID), invitationFailure: null }),
    )
  })

  it('sends a typed backup phone in its international form (00966 50 000 0001 → +966500000001)', async () => {
    const calls = mockQuickCreateApi()
    const { onCreated, dialog } = renderModal('student')

    await fill(dialog, ar.users.fields.fullName, 'عمر خالد')
    await fill(dialog, ar.users.fields.email, 'omar@test.local')
    const phone = within(dialog).getByLabelText(BACKUP_PHONE)
    expect(phone).toHaveAttribute('dir', 'ltr')
    await userEvent.type(phone, '00966 50 000 0001')
    await userEvent.click(submitButton(dialog, 'student'))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(calls.creates).toEqual([{ kind: 'student', fullName: 'عمر خالد', email: 'omar@test.local', phone: '+966500000001' }])
  })

  it('requires a teacher’s phone: an empty one is refused under the field with no request, then all three are sent', async () => {
    const calls = mockQuickCreateApi()
    const { onCreated, dialog } = renderModal('teacher')

    expect(within(dialog).getByText(ar.users.quick.title.teacher, { selector: '.ant-modal-title' })).toBeInTheDocument()
    expect(within(dialog).queryByText(`(${ar.users.quick.optional})`)).not.toBeInTheDocument()
    await fill(dialog, ar.users.fields.fullName, 'سارة أحمد')
    await fill(dialog, ar.users.fields.email, 'sara@test.local')
    await userEvent.click(submitButton(dialog, 'teacher'))

    expect(await within(dialog).findByText(ar.users.quick.validation.phoneRequired)).toBeInTheDocument()
    expect(calls.creates).toHaveLength(0)

    await fill(dialog, ar.users.quick.fields.phone, '+966 50 000 0002')
    await userEvent.click(submitButton(dialog, 'teacher'))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(calls.creates).toEqual([{ kind: 'teacher', fullName: 'سارة أحمد', email: 'sara@test.local', phone: '+966500000002' }])
    expect(calls.invitations).toHaveLength(1)
  })

  it('refuses a phone that is not international, a missing e-mail and a one-letter name under their fields, with no request', async () => {
    const calls = mockQuickCreateApi()
    const { dialog } = renderModal('student')

    await fill(dialog, ar.users.fields.fullName, 'ع')
    await fill(dialog, BACKUP_PHONE, '0500000001')
    await userEvent.click(submitButton(dialog, 'student'))

    expect(await within(dialog).findByText(ar.users.quick.validation.phone)).toBeInTheDocument()
    expect(within(dialog).getByText(ar.users.quick.validation.emailRequired)).toBeInTheDocument()
    expect(within(dialog).getByText(ar.users.validation.fullName)).toBeInTheDocument()
    expect(calls.creates).toHaveLength(0)
  })

  it('shows 409 email_in_use under the e-mail field and issues no invitation', async () => {
    const calls = mockQuickCreateApi(() => jsonResponse(409, { statusCode: 409, code: 'email_in_use', message: 'taken' }))
    const { onCreated, dialog } = renderModal('student')

    await fill(dialog, ar.users.fields.fullName, 'عمر خالد')
    await fill(dialog, ar.users.fields.email, 'omar@test.local')
    await userEvent.click(submitButton(dialog, 'student'))

    const message = await within(dialog).findByText(ar.users.errors.email_in_use)
    expect(message.closest('.ant-form-item')).toContainElement(within(dialog).getByLabelText(ar.users.fields.email))
    // Under the field only: no alert above the form.
    expect(dialog.querySelector('.ant-alert')).toBeNull()
    expect(calls.creates).toHaveLength(1)
    expect(calls.invitations).toHaveLength(0)
    expect(onCreated).not.toHaveBeenCalled()
    expect(within(dialog).getByLabelText(ar.users.fields.email)).toHaveValue('omar@test.local')
  })

  it('shows a refusal that names no field above the form and keeps the typing', async () => {
    mockQuickCreateApi(() => jsonResponse(403, { statusCode: 403, code: 'permission_denied', message: 'Missing permission', missing: ['users.create'] }))
    const { onCreated, dialog } = renderModal('teacher')

    await fill(dialog, ar.users.fields.fullName, 'سارة أحمد')
    await fill(dialog, ar.users.fields.email, 'sara@test.local')
    await fill(dialog, ar.users.quick.fields.phone, '+966500000002')
    await userEvent.click(submitButton(dialog, 'teacher'))

    const alert = await within(dialog).findByText('ليست لديك الصلاحية اللازمة لهذا الإجراء (users.create)')
    expect(alert.closest('.ant-alert')).not.toBeNull()
    expect(onCreated).not.toHaveBeenCalled()
    expect(within(dialog).getByLabelText(ar.users.fields.fullName)).toHaveValue('سارة أحمد')
  })

  it('reports the account even when the invitation fails, with the reason', async () => {
    const calls = mockQuickCreateApi(undefined, () =>
      jsonResponse(409, { statusCode: 409, code: 'user_not_invitable', message: 'not invitable' }),
    )
    const { onCreated, dialog } = renderModal('student')

    await fill(dialog, ar.users.fields.fullName, 'عمر خالد')
    await fill(dialog, ar.users.fields.email, 'omar@test.local')
    await userEvent.click(submitButton(dialog, 'student'))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(calls.invitations).toHaveLength(1)
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'student',
        user: expect.objectContaining({ id: CREATED_ID }),
        invitation: null,
        invitationFailure: { key: 'users.errors.user_not_invitable' },
      }),
    )
  })

  it('creates one account however often the form is submitted while the request runs, and locks the form meanwhile', async () => {
    let answer: (response: Response) => void = () => undefined
    const calls = mockQuickCreateApi(() => new Promise<Response>((resolve) => (answer = resolve)))
    const { onCreated, dialog } = renderModal('student')

    await fill(dialog, ar.users.fields.fullName, 'عمر خالد')
    await fill(dialog, ar.users.fields.email, 'omar@test.local')
    const email = within(dialog).getByLabelText(ar.users.fields.email)
    fireEvent.click(submitButton(dialog, 'student'))
    fireEvent.submit(email.closest('form')!)
    fireEvent.submit(email.closest('form')!)

    await waitFor(() => expect(calls.creates).toHaveLength(1))
    await waitFor(() => expect(email).toBeDisabled())
    answer(jsonResponse(201, makeUserDetail({ id: CREATED_ID, fullName: 'عمر خالد', status: 'invited' })))
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(calls.creates).toHaveLength(1)
    expect(calls.invitations).toHaveLength(1)
  })
})
