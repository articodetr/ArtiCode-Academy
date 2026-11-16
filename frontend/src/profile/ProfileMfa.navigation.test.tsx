// Leaving the page while a dialog of the two-step verification card holds something that comes ONCE
// (useMfaLeaveGuard): the recovery codes on screen until they are ticked as saved, and the answer of a request
// still running. Escape, the mask, × and «close» are in ProfileMfa.test.tsx; here it is the browser's Back
// (a router navigation — the Android back button, Alt+←) and the reload prompt. Rendered in a data router
// (src/test/navigation.tsx), which useBlocker needs: under the MemoryRouter of renderWithProviders the blocker
// renders nothing.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MfaEnabled, MfaSetup, MfaStatus } from '../api/mfa'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { blockerStates, goBack, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { ProfileMfa } from './ProfileMfa'

// The real component draws the code as SVG paths; the stand-in is enough to know step (b) is on screen.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props: { 'data-testid'?: string }) => <svg data-testid={props['data-testid']} />,
}))

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const OFF: MfaStatus = { available: true, enabled: false, enabledAt: null, recoveryCodesLeft: null, pendingSetup: false }
const ON: MfaStatus = { available: true, enabled: true, enabledAt: '2026-11-16T09:31:12.000Z', recoveryCodesLeft: 10, pendingSetup: false }
const SETUP: MfaSetup = { secret: SECRET, otpauthUri: `otpauth://totp/Arti:sara?secret=${SECRET}`, expiresAt: '2026-11-16T09:40:00.000Z' }
const CODES = [
  'K7QX4-M9TRB', 'P3ZWN-8HDCA', 'A2B3C-4D5E6', 'F7G8H-9JKLM', 'NPQRS-TUVWX',
  'YZ234-56789', 'ABCDE-FGHJK', 'LMNPQ-RSTUV', 'WXYZ2-3456A', '7H8J9-KLMNP',
]
const ENABLED: MfaEnabled = { enabledAt: ON.enabledAt!, recoveryCodes: CODES, revokedSessions: 0 }

/** An answer the test holds back until it opens the gate — a request «still running». */
interface Gate {
  open: () => void
  opened: Promise<void>
}

function gate(): Gate {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

/** API-206 answers `statuses` in order (the last one repeats); API-208 and API-210 wait for their gate, if given. */
function mockApi(statuses: MfaStatus[], held: { enable?: Gate; codes?: Gate } = {}) {
  const queue = [...statuses]
  const writes: string[] = []
  mockFetch(async (url, init) => {
    const request = `${init?.method ?? 'GET'} ${url}`
    if (request === 'GET /api/auth/mfa') return jsonResponse(200, queue.length > 1 ? queue.shift() : queue[0])
    writes.push(request)
    if (request === 'POST /api/auth/mfa/setup') return jsonResponse(200, SETUP)
    if (request === 'POST /api/auth/mfa/enable') {
      await held.enable?.opened
      return jsonResponse(200, ENABLED)
    }
    if (request === 'POST /api/auth/mfa/recovery-codes') {
      await held.codes?.opened
      return jsonResponse(200, { recoveryCodes: CODES })
    }
    return jsonResponse(404, { statusCode: 404, message: 'Not found' })
  })
  return writes
}

function renderCard() {
  const { router } = renderInDataRouter(
    <div data-testid="card">
      <ProfileMfa />
    </div>,
    { path: '/profile' },
  )
  return router
}

/** The button whose label is exactly `text` inside `scope` — a text query, cheaper than an accessible-name one (KI-044). */
function buttonIn(scope: HTMLElement, text: string): HTMLButtonElement {
  const found = within(scope).getByText(text).closest('button')
  if (!found) throw new Error(`No button ${text}`)
  return found
}

async function dialogWith(text: string): Promise<HTMLElement> {
  const dialog = (await screen.findByText(text)).closest<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error(`No dialog with ${text}`)
  return dialog
}

const type = (scope: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } })

/** Clicks a submit button once the previous request has left it (antd ignores a click while it shows loading). */
async function submit(scope: HTMLElement, text: string): Promise<HTMLButtonElement> {
  const button = buttonIn(scope, text)
  await waitFor(() => expect(button).not.toHaveClass('ant-btn-loading'))
  fireEvent.click(button)
  return button
}

/** Opens a dialog of the card by its button. */
async function openDialog(action: string, shows: string): Promise<HTMLElement> {
  const card = screen.getByTestId('card')
  fireEvent.click((await within(card).findByText(action)).closest('button')!)
  return dialogWith(shows)
}

/** Opens «turn on», gives the password and waits for the QR code of step (b). */
async function reachVerifyStep(): Promise<HTMLElement> {
  const dialog = await openDialog(ar.profile.mfa.actions.enable, ar.profile.mfa.setup.passwordIntro)
  type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
  await submit(dialog, ar.profile.mfa.setup.continue)
  await within(dialog).findByTestId('mfa-qr')
  return dialog
}

/** The «leave before saving the recovery codes?» questions in the document — an answered one lingers in jsdom; an antd confirm shows its title twice. */
function leaveQuestions(): HTMLElement[] {
  const dialogs = screen.queryAllByText(ar.profile.mfa.leave.title).map((title) => title.closest<HTMLElement>('[role="dialog"]'))
  return [...new Set(dialogs)].filter((dialog): dialog is HTMLElement => dialog !== null)
}

/** Waits for a question that is not one of `answered` and returns it. */
async function leaveQuestion(answered: HTMLElement[] = []): Promise<HTMLElement> {
  let found: HTMLElement | undefined
  await waitFor(() => {
    found = leaveQuestions().find((question) => !answered.includes(question))
    expect(found).toBeDefined()
  })
  return found!
}

/** Answers a question; a navigation it lets go on completes inside `act`. */
async function answer(question: HTMLElement, label: string) {
  await act(async () => {
    fireEvent.click(buttonIn(question, label))
  })
}

const stillOnTheProfile = () => expect(screen.queryByTestId('location')).toBeNull()
const backOnPrevious = async () => expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')

describe('ProfileMfa — leaving the page while something comes once', () => {
  it('lets a back navigation through before any code is confirmed: the setup is simply discarded', async () => {
    const writes = mockApi([OFF])
    const router = renderCard()
    await reachVerifyStep()
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)

    await backOnPrevious()
    expect(leaveQuestions()).toHaveLength(0)
    expect(document.body.textContent).not.toContain('JBSW')
    expect(writes).toEqual(['POST /api/auth/mfa/setup'])
  })

  it('refuses a back navigation while the code is being confirmed, then asks before unsaved recovery codes are left', async () => {
    const enable = gate()
    mockApi([OFF, ON], { enable })
    const router = renderCard()
    const dialog = await reachVerifyStep()

    type(dialog, ar.profile.mfa.fields.code, '492039')
    const confirm = await submit(dialog, ar.profile.mfa.setup.submit)
    await waitFor(() => expect(confirm).toHaveClass('ant-btn-loading'))

    // The answer — with the codes, once — is on its way: leaving is refused, with a word why. Nothing is asked.
    expect(unloadWouldPrompt()).toBe(true)
    await goBack(router)
    stillOnTheProfile()
    expect(await screen.findByText(ar.profile.mfa.leave.busy)).toBeInTheDocument()
    expect(leaveQuestions()).toHaveLength(0)
    expect(blockerStates(router)).toEqual(['unblocked'])

    // It arrives at a page that is still there: the codes are shown.
    await act(async () => {
      enable.open()
    })
    const list = await within(dialog).findByTestId('mfa-recovery-codes')
    expect(within(list).getAllByRole('listitem')).toHaveLength(10)

    // Back over codes not ticked as saved: held, and ONE worded question says what would be lost.
    await goBack(router)
    const first = await leaveQuestion()
    expect(within(first).getByText(ar.profile.mfa.leave.content)).toBeInTheDocument()
    stillOnTheProfile()
    // A second back joins the question on screen instead of asking again.
    await goBack(router)
    expect(leaveQuestions()).toHaveLength(1)

    // «Stay»: the navigation is cancelled and the codes are still there.
    await answer(first, ar.profile.mfa.leave.cancel)
    expect(blockerStates(router)).toEqual(['unblocked'])
    stillOnTheProfile()
    expect(within(dialog).getByTestId('mfa-recovery-codes')).toBeInTheDocument()
    expect(unloadWouldPrompt()).toBe(true)

    // Asked again the next time; «leave without saving» lets the navigation go on, and the codes go with the page.
    await goBack(router)
    const second = await leaveQuestion([first])
    await answer(second, ar.profile.mfa.leave.ok)
    await backOnPrevious()
    expect(document.body.textContent).not.toContain(CODES[0])
    expect(unloadWouldPrompt()).toBe(false)
  })

  it('lets a back navigation through without a question once the codes are ticked as saved', async () => {
    mockApi([OFF, ON])
    const router = renderCard()
    const dialog = await reachVerifyStep()
    type(dialog, ar.profile.mfa.fields.code, '492039')
    await submit(dialog, ar.profile.mfa.setup.submit)
    await within(dialog).findByTestId('mfa-recovery-codes')
    expect(unloadWouldPrompt()).toBe(true)

    fireEvent.click(within(dialog).getByLabelText(ar.profile.mfa.codes.saved))
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    await backOnPrevious()
    expect(leaveQuestions()).toHaveLength(0)
  })

  it('holds the new recovery codes the same way: refused while they are being made, asked for until they are saved', async () => {
    const codes = gate()
    const writes = mockApi([ON], { codes })
    const router = renderCard()
    const dialog = await openDialog(ar.profile.mfa.actions.regenerate, ar.profile.mfa.regenerate.intro)

    // Nothing is held while the form is only being filled.
    expect(unloadWouldPrompt()).toBe(false)
    type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
    type(dialog, ar.profile.mfa.fields.code, '492039')
    const create = await submit(dialog, ar.profile.mfa.regenerate.submit)
    await waitFor(() => expect(create).toHaveClass('ant-btn-loading'))

    // The old codes stop working with this request: its answer must not be lost.
    expect(unloadWouldPrompt()).toBe(true)
    await goBack(router)
    stillOnTheProfile()
    expect(await screen.findByText(ar.profile.mfa.leave.busy)).toBeInTheDocument()
    expect(leaveQuestions()).toHaveLength(0)

    await act(async () => {
      codes.open()
    })
    await within(dialog).findByTestId('mfa-recovery-codes')

    await goBack(router)
    const question = await leaveQuestion()
    stillOnTheProfile()
    await answer(question, ar.profile.mfa.leave.cancel)
    expect(within(dialog).getByTestId('mfa-recovery-codes')).toBeInTheDocument()

    // Saved: «close» ends the dialog, and nothing holds the page any more.
    fireEvent.click(within(dialog).getByLabelText(ar.profile.mfa.codes.saved))
    fireEvent.click(buttonIn(dialog, ar.profile.mfa.codes.close))
    await waitFor(() => expect(screen.queryByTestId('mfa-recovery-codes')).toBeNull())
    await goBack(router)
    await backOnPrevious()
    expect(leaveQuestions().filter((other) => other !== question)).toEqual([])
    expect(writes).toEqual(['POST /api/auth/mfa/recovery-codes'])
  })
})
