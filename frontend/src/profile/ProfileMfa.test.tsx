// The two-step verification card of the profile and its dialogs (API-206..API-210).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MfaEnabled, MfaSetup, MfaStatus } from '../api/mfa'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { ProfilePage } from '../pages/ProfilePage'
import { jsonResponse, mockFetch } from '../test/http'
import { unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { formatDateTime } from '../users/users.format'
import { ProfileMfa } from './ProfileMfa'

// The real component draws the code as SVG paths; the stand-in shows what it was asked to draw.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props: { value: string; bgColor?: string; title?: string; 'data-testid'?: string }) => (
    <svg data-testid={props['data-testid']} data-value={props.value} data-bg={props.bgColor} aria-label={props.title} />
  ),
}))

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const OFF: MfaStatus = { available: true, enabled: false, enabledAt: null, recoveryCodesLeft: null, pendingSetup: false }
const ON: MfaStatus = { available: true, enabled: true, enabledAt: '2026-11-16T09:31:12.000Z', recoveryCodesLeft: 10, pendingSetup: false }
const SETUP: MfaSetup = {
  secret: SECRET,
  otpauthUri: `otpauth://totp/Arti%20Academy:sara%40example.com?secret=${SECRET}&issuer=Arti%20Academy&algorithm=SHA1&digits=6&period=30`,
  expiresAt: '2026-11-16T09:40:00.000Z',
}
const CODES = [
  'K7QX4-M9TRB', 'P3ZWN-8HDCA', 'A2B3C-4D5E6', 'F7G8H-9JKLM', 'NPQRS-TUVWX',
  'YZ234-56789', 'ABCDE-FGHJK', 'LMNPQ-RSTUV', 'WXYZ2-3456A', '7H8J9-KLMNP',
]
const ENABLED: MfaEnabled = { enabledAt: ON.enabledAt!, recoveryCodes: CODES, revokedSessions: 2 }

const STATUS = 'GET /api/auth/mfa'
const SETUP_POST = 'POST /api/auth/mfa/setup'
const ENABLE_POST = 'POST /api/auth/mfa/enable'
const DISABLE_POST = 'POST /api/auth/mfa/disable'
const CODES_POST = 'POST /api/auth/mfa/recovery-codes'

type Reply = [status: number, body?: unknown]
const refusal = (status: number, code: string): Reply => [status, { statusCode: status, code, message: `refused: ${code}` }]
/** No answer at all: the request went out and the connection dropped (whatever the server did with it). */
const LOST: Reply = [0]

interface Call {
  request: string
  body: unknown
}

/** Answers each route with its replies in order (the last one repeats) and records every request. */
function serve(routes: Record<string, Reply[]>): Call[] {
  const calls: Call[] = []
  const queues = Object.fromEntries(Object.entries(routes).map(([request, replies]) => [request, [...replies]]))
  mockFetch((url, init) => {
    const request = `${init?.method ?? 'GET'} ${url}`
    calls.push({ request, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    const queue = queues[request]
    if (!queue || queue.length === 0) return jsonResponse(404, { statusCode: 404, message: 'Not found' })
    const [status, body] = queue.length > 1 ? queue.shift()! : queue[0]!
    if (status === 0) return Promise.reject(new TypeError('Failed to fetch'))
    return jsonResponse(status, body)
  })
  return calls
}

const writes = (calls: Call[]) => calls.filter((call) => !call.request.startsWith('GET '))
const reads = (calls: Call[], request = STATUS) => calls.filter((call) => call.request === request).length

function renderCard() {
  const onSessionsChanged = vi.fn()
  renderWithProviders(
    <div data-testid="card">
      <ProfileMfa onSessionsChanged={onSessionsChanged} />
    </div>,
  )
  return { onSessionsChanged, card: screen.getByTestId('card') }
}

/** The button whose label is exactly `text` inside `scope` — a text query, cheaper than an accessible-name one (KI-044). */
function buttonIn(scope: HTMLElement, text: string): HTMLButtonElement {
  const found = within(scope).getByText(text).closest('button')
  if (!found) throw new Error(`No button ${text}`)
  return found
}

async function findButtonIn(scope: HTMLElement, text: string): Promise<HTMLButtonElement> {
  const found = (await within(scope).findByText(text)).closest('button')
  if (!found) throw new Error(`No button ${text}`)
  return found
}

/** The open dialog that shows `text`. */
async function dialogWith(text: string): Promise<HTMLElement> {
  const dialog = (await screen.findByText(text)).closest<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error(`No dialog with ${text}`)
  return dialog
}

const field = (scope: HTMLElement, label: string) => within(scope).getByLabelText<HTMLInputElement>(label)
const type = (scope: HTMLElement, label: string, value: string) => fireEvent.change(field(scope, label), { target: { value } })

/** Clicks a submit button once the previous request has left it (antd ignores a click while it shows loading). */
async function submit(scope: HTMLElement, text: string) {
  const button = buttonIn(scope, text)
  await waitFor(() => expect(button).not.toHaveClass('ant-btn-loading'))
  fireEvent.click(button)
}

const noDialog = () => waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())

/** The line of the card that takes the cursor when a dialog went and its button is gone. */
function statusLine(card: HTMLElement): HTMLElement {
  const line = within(card).getByTestId('mfa-status').closest<HTMLElement>('[tabindex="-1"]')
  if (!line) throw new Error('No focusable status line')
  return line
}

/** A click on the mask around the dialog: the press and the click both land on the wrapper (rc-dialog checks both). */
function clickMask(dialog: HTMLElement) {
  const wrapper = dialog.closest<HTMLElement>('.ant-modal-wrap')
  if (!wrapper) throw new Error('No mask around the dialog')
  fireEvent.mouseDown(wrapper)
  fireEvent.click(wrapper)
}

/** Opens «turn on» (the button holds the cursor, as after a real click or key press), gives the password and waits for the QR code of step (b). */
async function reachVerifyStep(card: HTMLElement): Promise<HTMLElement> {
  const enable = await findButtonIn(card, ar.profile.mfa.actions.enable)
  enable.focus()
  fireEvent.click(enable)
  const dialog = await dialogWith(ar.profile.mfa.setup.passwordIntro)
  type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
  await submit(dialog, ar.profile.mfa.setup.continue)
  await within(dialog).findByTestId('mfa-qr')
  return dialog
}

describe('ProfileMfa — the two-step verification card (API-206..API-210)', () => {
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>

  beforeEach(() => {
    writeText = vi.fn(async () => undefined)
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
  })

  describe('status', () => {
    it('explains two-step verification and offers to turn it on while it is off', async () => {
      const calls = serve({ [STATUS]: [[200, OFF]] })
      const { card } = renderCard()

      expect(await within(card).findByText(ar.profile.mfa.intro)).toBeInTheDocument()
      expect(within(card).getByTestId('mfa-status')).toHaveTextContent(ar.profile.mfa.statusOff)
      expect(buttonIn(card, ar.profile.mfa.actions.enable)).toBeEnabled()
      expect(within(card).queryByText(ar.profile.mfa.actions.disable)).toBeNull()
      expect(calls).toEqual([{ request: STATUS, body: undefined }])
    })

    it('shows since when it is on, the recovery codes left and both actions', async () => {
      serve({ [STATUS]: [[200, ON]] })
      const { card } = renderCard()

      const since = i18n.t('profile.mfa.enabledSince', { when: formatDateTime(ON.enabledAt, 'ar') })
      expect(await within(card).findByText(since)).toBeInTheDocument()
      // Latin digits, as the rest of the profile shows its dates.
      expect(since).toMatch(/2026/)
      const left = within(card).getByTestId('mfa-codes-left')
      expect(left).toHaveTextContent(i18n.t('profile.mfa.recoveryCodesLeft', { count: 10 }))
      expect(left).not.toHaveClass('ant-typography-warning')
      expect(within(card).queryByText(ar.profile.mfa.lowRecoveryCodes)).toBeNull()
      expect(buttonIn(card, ar.profile.mfa.actions.regenerate)).toBeEnabled()
      expect(buttonIn(card, ar.profile.mfa.actions.disable)).toBeEnabled()
      expect(within(card).queryByText(ar.profile.mfa.actions.enable)).toBeNull()
    })

    it('warns when three recovery codes or fewer are left', async () => {
      serve({ [STATUS]: [[200, { ...ON, recoveryCodesLeft: 3 }]] })
      const { card } = renderCard()

      expect(await within(card).findByText(ar.profile.mfa.lowRecoveryCodes)).toBeInTheDocument()
      const left = within(card).getByTestId('mfa-codes-left')
      expect(left).toHaveTextContent(i18n.t('profile.mfa.recoveryCodesLeft', { count: 3 }))
      expect(left).toHaveClass('ant-typography-warning')
    })

    it('says so when no recovery code is left', async () => {
      serve({ [STATUS]: [[200, { ...ON, recoveryCodesLeft: 0 }]] })
      const { card } = renderCard()

      expect(await within(card).findByText(ar.profile.mfa.noRecoveryCodes)).toBeInTheDocument()
      expect(within(card).getByTestId('mfa-codes-left')).toHaveTextContent(i18n.t('profile.mfa.recoveryCodesLeft', { count: 0 }))
    })

    it('offers nothing that could only fail while the server has not enabled the feature', async () => {
      serve({ [STATUS]: [[200, { ...OFF, available: false }]] })
      const { card } = renderCard()

      expect(await within(card).findByText(ar.profile.mfa.unavailable)).toBeInTheDocument()
      expect(within(card).queryByText(ar.profile.mfa.actions.enable)).toBeNull()
    })

    it('says that signing in is blocked when it is on but the server key is missing', async () => {
      serve({ [STATUS]: [[200, { ...ON, available: false }]] })
      const { card } = renderCard()

      expect(await within(card).findByText(ar.profile.mfa.unavailableEnabled)).toBeInTheDocument()
      expect(within(card).queryByText(ar.profile.mfa.actions.regenerate)).toBeNull()
      expect(within(card).queryByText(ar.profile.mfa.actions.disable)).toBeNull()
    })

    it('words a failed read and reads again on demand', async () => {
      const calls = serve({ [STATUS]: [[500, { statusCode: 500, message: 'Internal server error' }], [200, OFF]] })
      const { card } = renderCard()

      expect(await within(card).findByText(ar.profile.mfa.loadFailed)).toBeInTheDocument()
      expect(within(card).queryByText(ar.profile.mfa.actions.enable)).toBeNull()

      fireEvent.click(buttonIn(card, ar.profile.mfa.retry))
      expect(await within(card).findByText(ar.profile.mfa.intro)).toBeInTheDocument()
      expect(within(card).queryByText(ar.profile.mfa.loadFailed)).toBeNull()
      expect(reads(calls)).toBe(2)
    })
  })

  describe('turning it on', () => {
    it('asks for the password, then shows the QR code of the URI, the key in fours and the expiry', async () => {
      const calls = serve({ [STATUS]: [[200, OFF]], [SETUP_POST]: [refusal(400, 'password_invalid'), [200, SETUP]] })
      const { card } = renderCard()
      fireEvent.click(await findButtonIn(card, ar.profile.mfa.actions.enable))
      const dialog = await dialogWith(ar.profile.mfa.setup.passwordIntro)

      // Nothing is sent without a password.
      await submit(dialog, ar.profile.mfa.setup.continue)
      expect(await within(dialog).findByText(ar.profile.mfa.validation.passwordRequired)).toBeInTheDocument()
      expect(writes(calls)).toEqual([])

      // A wrong password is said on its field, which keeps what was typed and the cursor.
      type(dialog, ar.profile.mfa.fields.password, 'wrong-pass-1')
      await submit(dialog, ar.profile.mfa.setup.continue)
      expect(await within(dialog).findByText(ar.profile.mfa.errors.password_invalid)).toBeInTheDocument()
      const password = field(dialog, ar.profile.mfa.fields.password)
      expect(password).toHaveValue('wrong-pass-1')
      expect(password).toHaveAttribute('autocomplete', 'current-password')
      expect(document.activeElement).toBe(password)
      expect(within(dialog).queryByTestId('mfa-qr')).toBeNull()

      type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
      await submit(dialog, ar.profile.mfa.setup.continue)

      const qr = await within(dialog).findByTestId('mfa-qr')
      // The password field went with step (a): the cursor is on the one field of step (b).
      expect(document.activeElement).toBe(field(dialog, ar.profile.mfa.fields.code))
      expect(qr).toHaveAttribute('data-value', SETUP.otpauthUri)
      expect(qr).toHaveAttribute('data-bg', '#ffffff')
      expect(within(dialog).getByText(ar.profile.mfa.setup.manualKey)).toBeInTheDocument()
      const key = within(dialog).getByTestId('mfa-secret')
      expect(key.textContent).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
      expect(key).toHaveAttribute('dir', 'ltr')
      expect(within(dialog).getByText(i18n.t('profile.mfa.setup.expiresAt', { when: formatDateTime(SETUP.expiresAt, 'ar') }))).toBeInTheDocument()

      // The key is copied without the spaces of its display.
      fireEvent.click(buttonIn(dialog, ar.profile.mfa.setup.copyKey))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET))

      const code = field(dialog, ar.profile.mfa.fields.code)
      expect(code).toHaveAttribute('inputmode', 'numeric')
      expect(code).toHaveAttribute('autocomplete', 'one-time-code')
      expect(code).toHaveAttribute('dir', 'ltr')
      // Typed left to right in the Arabic UI too. Ant Design's RTL class sets `direction: rtl` and beats the
      // attribute; mfa.css answers with `input.profile-mfa__code-input.ant-input { direction: ltr }`. jsdom
      // loads no stylesheet and lays nothing out, so what can be held down here is that the input is the element
      // that rule selects — the visual order of «123 456» is a browser check.
      expect(code.tagName).toBe('INPUT')
      expect(code).toHaveClass('ant-input', 'ant-input-rtl', 'profile-mfa__code-input')

      expect(writes(calls)).toEqual([
        { request: SETUP_POST, body: { password: 'wrong-pass-1' } },
        { request: SETUP_POST, body: { password: 'right-pass-1' } },
      ])
    })

    it('turns it on with a code and shows the recovery codes once: close waits for the tick, copy and download work, nothing is stored', async () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      const createObjectURL = vi.fn((_blob: Blob) => 'blob:recovery-codes')
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL })
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
      const downloads: Array<{ name: string; href: string }> = []
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push({ name: this.download, href: this.href })
      })
      const calls = serve({
        [STATUS]: [[200, OFF], [200, ON]],
        [SETUP_POST]: [[200, SETUP]],
        [ENABLE_POST]: [refusal(400, 'mfa_code_invalid'), [200, ENABLED]],
      })
      const { card, onSessionsChanged } = renderCard()
      const dialog = await reachVerifyStep(card)
      const code = field(dialog, ar.profile.mfa.fields.code)
      expect(unloadWouldPrompt()).toBe(false)

      // What cannot be a code is not sent — and stays, to be completed.
      type(dialog, ar.profile.mfa.fields.code, '12345')
      await submit(dialog, ar.profile.mfa.setup.submit)
      expect(await within(dialog).findByText(ar.profile.mfa.validation.codeShape)).toBeInTheDocument()
      expect(code).toHaveValue('12345')
      expect(writes(calls)).toHaveLength(1)

      // A code the server refuses is said on the field, which is emptied and gets the cursor back.
      type(dialog, ar.profile.mfa.fields.code, '111111')
      await submit(dialog, ar.profile.mfa.setup.submit)
      expect(await within(dialog).findByText(ar.profile.mfa.errors.mfa_code_invalid)).toBeInTheDocument()
      expect(code).toHaveValue('')
      expect(document.activeElement).toBe(code)
      expect(onSessionsChanged).not.toHaveBeenCalled()

      type(dialog, ar.profile.mfa.fields.code, '492 039')
      await submit(dialog, ar.profile.mfa.setup.submit)

      const list = await within(dialog).findByTestId('mfa-recovery-codes')
      expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(CODES)
      expect(list).toHaveAttribute('dir', 'ltr')
      // The form went with step (b): the cursor is on the heading of the codes, which also names the list.
      const heading = within(dialog).getByText(ar.profile.mfa.codes.listLabel, { selector: 'h2' })
      expect(document.activeElement).toBe(heading)
      expect(list).toHaveAttribute('aria-labelledby', heading.id)
      expect(within(dialog).getByText(ar.profile.mfa.codes.warning)).toBeInTheDocument()
      expect(within(dialog).getByText(ar.profile.mfa.setup.done)).toBeInTheDocument()
      expect(within(dialog).getByText(i18n.t('profile.mfa.setup.othersSignedOut', { count: 2 }))).toBeInTheDocument()
      // The secret left the screen with step (b).
      expect(within(dialog).queryByTestId('mfa-qr')).toBeNull()
      expect(document.body.textContent).not.toContain('JBSW Y3DP')
      expect(writes(calls).at(-1)).toEqual({ request: ENABLE_POST, body: { code: '492039' } })
      expect(onSessionsChanged).toHaveBeenCalledTimes(1)

      // The codes cannot vanish by accident: no ×, Escape and the mask do nothing, «close» waits for the tick.
      const close = buttonIn(dialog, ar.profile.mfa.codes.close)
      expect(close).toBeDisabled()
      expect(dialog.querySelector('.ant-modal-close')).toBeNull()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      clickMask(dialog)
      fireEvent.click(close)
      expect(within(dialog).getByTestId('mfa-recovery-codes')).toBeInTheDocument()
      // «Close» is the only way out, and it is off: a line says what turns it on, tied to the button and the tick.
      expect(within(dialog).getByTestId('mfa-close-hint')).toHaveTextContent(ar.profile.mfa.codes.closeHint)
      expect(close).toHaveAccessibleDescription(ar.profile.mfa.codes.closeHint)
      expect(within(dialog).getByLabelText(ar.profile.mfa.codes.saved)).toHaveAccessibleDescription(ar.profile.mfa.codes.closeHint)
      // A reload or a tab close would lose them too: the browser asks first.
      expect(unloadWouldPrompt()).toBe(true)

      fireEvent.click(buttonIn(dialog, ar.profile.mfa.codes.copy))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODES.join('\n')))

      // The file is built in the browser: a Blob behind a temporary link, no request.
      const requestsBefore = calls.length
      fireEvent.click(buttonIn(dialog, ar.profile.mfa.codes.download))
      expect(downloads).toEqual([{ name: 'recovery-codes.txt', href: 'blob:recovery-codes' }])
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      const blob = createObjectURL.mock.calls[0]![0]
      expect(blob.type).toBe('text/plain;charset=utf-8')
      const text = await blob.text()
      expect(text).toContain(ar.profile.mfa.codes.fileTitle)
      expect(text).toContain(CODES.join('\r\n'))
      expect(text).toContain(ar.profile.mfa.codes.fileHint)
      expect(calls).toHaveLength(requestsBefore)

      fireEvent.click(within(dialog).getByLabelText(ar.profile.mfa.codes.saved))
      expect(close).toBeEnabled()
      expect(unloadWouldPrompt()).toBe(false)
      fireEvent.click(close)
      await noDialog()

      // The card re-read its status and now shows «on».
      expect(await within(card).findByText(i18n.t('profile.mfa.enabledSince', { when: formatDateTime(ON.enabledAt, 'ar') }))).toBeInTheDocument()
      expect(reads(calls)).toBe(2)
      expect(document.body.textContent).not.toContain(CODES[0])
      // «Turn on», which opened the dialog, is gone: the cursor is on the status line, not on nothing.
      expect(within(card).queryByText(ar.profile.mfa.actions.enable)).toBeNull()
      await waitFor(() => expect(document.activeElement).toBe(statusLine(card)))
      // Nothing was missed: no notice about unseen codes.
      expect(within(card).queryByTestId('mfa-unseen-codes')).toBeNull()

      // Neither the password, the secret, a code nor a recovery code went into the browser's storage.
      const stored = [
        ...setItem.mock.calls.map((call) => call.join('=')),
        ...[localStorage, sessionStorage].flatMap((storage) =>
          Array.from({ length: storage.length }, (_, index) => `${storage.key(index)}=${storage.getItem(storage.key(index) ?? '')}`),
        ),
      ].join('\n')
      for (const secret of [SECRET, 'JBSW Y3DP', 'right-pass-1', '492039', '111111', SETUP.otpauthUri, ...CODES]) {
        expect(stored).not.toContain(secret)
      }
    })

    it('returns to the password step with a notice when the setup expired, and can start again', async () => {
      const calls = serve({ [STATUS]: [[200, OFF]], [SETUP_POST]: [[200, SETUP]], [ENABLE_POST]: [refusal(409, 'mfa_setup_required')] })
      const { card, onSessionsChanged } = renderCard()
      const dialog = await reachVerifyStep(card)

      type(dialog, ar.profile.mfa.fields.code, '492039')
      await submit(dialog, ar.profile.mfa.setup.submit)

      expect(await within(dialog).findByText(ar.profile.mfa.errors.mfa_setup_required)).toBeInTheDocument()
      expect(within(dialog).getByText(ar.profile.mfa.setup.passwordIntro)).toBeInTheDocument()
      expect(within(dialog).queryByTestId('mfa-qr')).toBeNull()
      expect(document.body.textContent).not.toContain('JBSW Y3DP')
      // A new form: the password of the first try is not in it.
      expect(field(dialog, ar.profile.mfa.fields.password)).toHaveValue('')
      expect(onSessionsChanged).not.toHaveBeenCalled()

      type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
      await submit(dialog, ar.profile.mfa.setup.continue)
      expect(await within(dialog).findByTestId('mfa-qr')).toBeInTheDocument()
      expect(within(dialog).queryByText(ar.profile.mfa.errors.mfa_setup_required)).toBeNull()
      expect(writes(calls).map((call) => call.request)).toEqual([SETUP_POST, ENABLE_POST, SETUP_POST])
    })

    it('discards the setup when the dialog is closed before the codes; the next session starts empty', async () => {
      const calls = serve({ [STATUS]: [[200, OFF]], [SETUP_POST]: [[200, SETUP]] })
      const { card, onSessionsChanged } = renderCard()
      await reachVerifyStep(card)

      fireEvent.keyDown(document.body, { key: 'Escape' })
      await noDialog()
      expect(document.body.textContent).not.toContain('JBSW Y3DP')
      expect(onSessionsChanged).not.toHaveBeenCalled()
      // Still off, and nothing more was asked of the server.
      expect(buttonIn(card, ar.profile.mfa.actions.enable)).toBeEnabled()
      expect(calls.map((call) => call.request)).toEqual([STATUS, SETUP_POST])

      const enable = buttonIn(card, ar.profile.mfa.actions.enable)
      enable.focus()
      fireEvent.click(enable)
      const dialog = await dialogWith(ar.profile.mfa.setup.passwordIntro)
      expect(field(dialog, ar.profile.mfa.fields.password)).toHaveValue('')
      expect(within(dialog).queryByTestId('mfa-qr')).toBeNull()

      // Before the codes the mask and × close it too.
      expect(dialog.querySelector('.ant-modal-close')).not.toBeNull()
      clickMask(dialog)
      await noDialog()
      // The cursor returns to the button that opened the dialog.
      expect(document.activeElement).toBe(buttonIn(card, ar.profile.mfa.actions.enable))
    })

    it('closes with a notice and shows the truth when it is already on (another tab turned it on)', async () => {
      const calls = serve({ [STATUS]: [[200, OFF], [200, ON]], [SETUP_POST]: [refusal(409, 'mfa_already_enabled')] })
      const { card } = renderCard()
      fireEvent.click(await findButtonIn(card, ar.profile.mfa.actions.enable))
      const dialog = await dialogWith(ar.profile.mfa.setup.passwordIntro)

      type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
      await submit(dialog, ar.profile.mfa.setup.continue)

      expect(await screen.findByText(ar.profile.mfa.errors.mfa_already_enabled)).toBeInTheDocument()
      await noDialog()
      expect(await within(card).findByText(i18n.t('profile.mfa.recoveryCodesLeft', { count: 10 }))).toBeInTheDocument()
      expect(reads(calls)).toBe(2)
    })

    it('says that it is on but the recovery codes were not shown when the first answer was lost, and offers new codes in one click', async () => {
      // The code was right and the server turned it on — but its answer, with the ten codes, never arrived. The
      // retry is refused: it is already on.
      const calls = serve({
        [STATUS]: [[200, OFF], [200, ON], [200, ON]],
        [SETUP_POST]: [[200, SETUP]],
        [ENABLE_POST]: [LOST, refusal(409, 'mfa_already_enabled')],
        [CODES_POST]: [[200, { recoveryCodes: CODES }]],
      })
      const { card, onSessionsChanged } = renderCard()
      const dialog = await reachVerifyStep(card)

      type(dialog, ar.profile.mfa.fields.code, '492039')
      await submit(dialog, ar.profile.mfa.setup.submit)
      expect(await within(dialog).findByText(ar.login.errors.network)).toBeInTheDocument()
      // Nothing is known yet: the dialog stays, with the code still typed.
      expect(field(dialog, ar.profile.mfa.fields.code)).toHaveValue('492039')
      expect(onSessionsChanged).not.toHaveBeenCalled()

      await submit(dialog, ar.profile.mfa.setup.submit)
      await noDialog()

      // The card shows the truth — on — and says plainly what is missing, for as long as it is missing.
      expect(await within(card).findByText(i18n.t('profile.mfa.enabledSince', { when: formatDateTime(ON.enabledAt, 'ar') }))).toBeInTheDocument()
      const notice = within(card).getByTestId('mfa-unseen-codes')
      expect(notice).toHaveTextContent(ar.profile.mfa.errors.codes_unseen)
      expect(notice).toHaveTextContent(ar.profile.mfa.unseenCodesHint)
      expect(notice.textContent).not.toContain('mfa_already_enabled')
      // Not the passing «already on» of an out-of-date card.
      expect(screen.queryByText(ar.profile.mfa.errors.mfa_already_enabled)).toBeNull()
      // The other sessions ended when it was turned on: the devices card is told.
      expect(onSessionsChanged).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(document.activeElement).toBe(statusLine(card)))
      expect(writes(calls).map((call) => call.request)).toEqual([SETUP_POST, ENABLE_POST, ENABLE_POST])

      // One click opens «new recovery codes»; the codes made there are shown, and the notice has done its work.
      fireEvent.click(buttonIn(notice, ar.profile.mfa.actions.regenerateNow))
      const regenerate = await dialogWith(ar.profile.mfa.regenerate.intro)
      type(regenerate, ar.profile.mfa.fields.password, 'right-pass-1')
      type(regenerate, ar.profile.mfa.fields.code, '204 817')
      await submit(regenerate, ar.profile.mfa.regenerate.submit)
      const list = await within(regenerate).findByTestId('mfa-recovery-codes')
      expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(CODES)
      expect(within(card).queryByTestId('mfa-unseen-codes')).toBeNull()
      fireEvent.click(within(regenerate).getByLabelText(ar.profile.mfa.codes.saved))
      fireEvent.click(buttonIn(regenerate, ar.profile.mfa.codes.close))
      await noDialog()
      expect(within(card).queryByTestId('mfa-unseen-codes')).toBeNull()
      expect(writes(calls).at(-1)).toEqual({ request: CODES_POST, body: { password: 'right-pass-1', code: '204817' } })
    })

    it('checks the truth when the dialog is closed after a code that got no answer: on means codes nobody saw', async () => {
      const calls = serve({ [STATUS]: [[200, OFF], [200, ON]], [SETUP_POST]: [[200, SETUP]], [ENABLE_POST]: [LOST] })
      const { card, onSessionsChanged } = renderCard()
      const dialog = await reachVerifyStep(card)

      type(dialog, ar.profile.mfa.fields.code, '492039')
      await submit(dialog, ar.profile.mfa.setup.submit)
      expect(await within(dialog).findByText(ar.login.errors.network)).toBeInTheDocument()
      expect(reads(calls)).toBe(1)

      // No retry: the dialog is closed. «Off» is no longer known to be true, so the card reads again —
      fireEvent.click(buttonIn(dialog, ar.common.cancel))
      await noDialog()

      // — and it is on: only the answer that never came can have done that, and it carried the codes.
      expect(await within(card).findByText(i18n.t('profile.mfa.enabledSince', { when: formatDateTime(ON.enabledAt, 'ar') }))).toBeInTheDocument()
      expect(reads(calls)).toBe(2)
      const notice = within(card).getByTestId('mfa-unseen-codes')
      expect(notice).toHaveTextContent(ar.profile.mfa.errors.codes_unseen)
      expect(buttonIn(notice, ar.profile.mfa.actions.regenerateNow)).toBeEnabled()
      expect(onSessionsChanged).toHaveBeenCalledTimes(1)
      expect(writes(calls).map((call) => call.request)).toEqual([SETUP_POST, ENABLE_POST])
    })

    it('says nothing of unseen codes when the unanswered code never reached the server: still off', async () => {
      const calls = serve({ [STATUS]: [[200, OFF]], [SETUP_POST]: [[200, SETUP]], [ENABLE_POST]: [LOST] })
      const { card, onSessionsChanged } = renderCard()
      const dialog = await reachVerifyStep(card)

      type(dialog, ar.profile.mfa.fields.code, '492039')
      await submit(dialog, ar.profile.mfa.setup.submit)
      expect(await within(dialog).findByText(ar.login.errors.network)).toBeInTheDocument()

      fireEvent.keyDown(document.body, { key: 'Escape' })
      await noDialog()

      // Read again all the same — and it is off, as shown.
      await waitFor(() => expect(reads(calls)).toBe(2))
      expect(await within(card).findByText(ar.profile.mfa.intro)).toBeInTheDocument()
      expect(within(card).getByTestId('mfa-status')).toHaveTextContent(ar.profile.mfa.statusOff)
      expect(within(card).queryByTestId('mfa-unseen-codes')).toBeNull()
      expect(onSessionsChanged).not.toHaveBeenCalled()

      // A dialog closed without such a doubt asks nothing more of the server.
      fireEvent.click(buttonIn(card, ar.profile.mfa.actions.enable))
      await dialogWith(ar.profile.mfa.setup.passwordIntro)
      fireEvent.keyDown(document.body, { key: 'Escape' })
      await noDialog()
      expect(reads(calls)).toBe(2)
    })

    it('words the rate limit above the form and keeps the dialog', async () => {
      serve({ [STATUS]: [[200, OFF]], [SETUP_POST]: [refusal(429, 'rate_limited')] })
      const { card } = renderCard()
      fireEvent.click(await findButtonIn(card, ar.profile.mfa.actions.enable))
      const dialog = await dialogWith(ar.profile.mfa.setup.passwordIntro)

      type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
      await submit(dialog, ar.profile.mfa.setup.continue)

      expect(await within(dialog).findByText(ar.profile.mfa.errors.rate_limited)).toBeInTheDocument()
      expect(dialog.textContent).not.toContain('rate_limited')
      expect(field(dialog, ar.profile.mfa.fields.password)).toHaveValue('right-pass-1')
    })
  })

  describe('new recovery codes', () => {
    it('asks for the password and a code, shows the new codes once and re-reads the count', async () => {
      const calls = serve({
        [STATUS]: [[200, { ...ON, recoveryCodesLeft: 2 }], [200, ON]],
        [CODES_POST]: [refusal(400, 'password_invalid'), [200, { recoveryCodes: CODES }]],
      })
      const { card, onSessionsChanged } = renderCard()
      fireEvent.click(await findButtonIn(card, ar.profile.mfa.actions.regenerate))
      const dialog = await dialogWith(ar.profile.mfa.regenerate.intro)

      type(dialog, ar.profile.mfa.fields.password, 'wrong-pass-1')
      type(dialog, ar.profile.mfa.fields.code, '492039')
      await submit(dialog, ar.profile.mfa.regenerate.submit)
      expect(await within(dialog).findByText(ar.profile.mfa.errors.password_invalid)).toBeInTheDocument()
      expect(document.activeElement).toBe(field(dialog, ar.profile.mfa.fields.password))
      // The code was not the problem: it stays.
      expect(field(dialog, ar.profile.mfa.fields.code)).toHaveValue('492039')

      type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
      type(dialog, ar.profile.mfa.fields.code, '٤٩٢ ٠٣٩')
      await submit(dialog, ar.profile.mfa.regenerate.submit)

      const list = await within(dialog).findByTestId('mfa-recovery-codes')
      expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(CODES)
      expect(within(dialog).getByText(ar.profile.mfa.regenerate.done)).toBeInTheDocument()
      expect(within(dialog).getByText(ar.profile.mfa.codes.warning)).toBeInTheDocument()
      expect(writes(calls)).toEqual([
        { request: CODES_POST, body: { password: 'wrong-pass-1', code: '492039' } },
        { request: CODES_POST, body: { password: 'right-pass-1', code: '492039' } },
      ])

      // The same once-only view: no ×, and «close» waits for the tick.
      const close = buttonIn(dialog, ar.profile.mfa.codes.close)
      expect(close).toBeDisabled()
      expect(dialog.querySelector('.ant-modal-close')).toBeNull()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(within(dialog).getByTestId('mfa-recovery-codes')).toBeInTheDocument()
      fireEvent.click(within(dialog).getByLabelText(ar.profile.mfa.codes.saved))
      fireEvent.click(close)
      await noDialog()

      // The count comes from the server again; sessions were not touched.
      expect(await within(card).findByText(i18n.t('profile.mfa.recoveryCodesLeft', { count: 10 }))).toBeInTheDocument()
      expect(within(card).queryByText(ar.profile.mfa.lowRecoveryCodes)).toBeNull()
      expect(reads(calls)).toBe(2)
      expect(onSessionsChanged).not.toHaveBeenCalled()
    })
  })

  describe('turning it off', () => {
    it('turns it off with the password and a code, then shows «off» and how many other sessions ended', async () => {
      const calls = serve({ [STATUS]: [[200, ON], [200, OFF]], [DISABLE_POST]: [[200, { revokedSessions: 2 }]] })
      const { card, onSessionsChanged } = renderCard()
      const disable = await findButtonIn(card, ar.profile.mfa.actions.disable)
      disable.focus()
      fireEvent.click(disable)
      const dialog = await dialogWith(ar.profile.mfa.disable.warning)

      // The password alone is not enough: a factor is asked for before anything is sent.
      type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
      await submit(dialog, ar.profile.mfa.disable.submit)
      expect(await within(dialog).findByText(ar.profile.mfa.validation.codeRequired)).toBeInTheDocument()
      expect(writes(calls)).toEqual([])

      type(dialog, ar.profile.mfa.fields.code, '492 039')
      await submit(dialog, ar.profile.mfa.disable.submit)
      await noDialog()

      expect(writes(calls)).toEqual([{ request: DISABLE_POST, body: { password: 'right-pass-1', code: '492039' } }])
      expect(await within(card).findByText(ar.profile.mfa.intro)).toBeInTheDocument()
      expect(within(card).getByTestId('mfa-status')).toHaveTextContent(ar.profile.mfa.statusOff)
      expect(within(card).getByText(ar.profile.mfa.disabledNotice)).toBeInTheDocument()
      expect(within(card).getByText(i18n.t('profile.mfa.sessionsEnded', { count: 2 }))).toBeInTheDocument()
      expect(buttonIn(card, ar.profile.mfa.actions.enable)).toBeEnabled()
      expect(reads(calls)).toBe(2)
      expect(onSessionsChanged).toHaveBeenCalledTimes(1)
      // «Turn off» is gone with the old status: the cursor waits for the new status line, then sits on it.
      await waitFor(() => expect(document.activeElement).toBe(statusLine(card)))
    })

    it('takes a recovery code instead of a code, sent as XXXXX-XXXXX', async () => {
      const calls = serve({ [STATUS]: [[200, ON], [200, OFF]], [DISABLE_POST]: [refusal(400, 'mfa_code_invalid'), [200, { revokedSessions: 0 }]] })
      const { card } = renderCard()
      fireEvent.click(await findButtonIn(card, ar.profile.mfa.actions.disable))
      const dialog = await dialogWith(ar.profile.mfa.disable.warning)

      type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
      type(dialog, ar.profile.mfa.fields.code, '111111')
      fireEvent.click(buttonIn(dialog, ar.profile.mfa.disable.useRecoveryCode))
      const recovery = field(dialog, ar.profile.mfa.fields.recoveryCode)
      expect(within(dialog).queryByLabelText(ar.profile.mfa.fields.code)).toBeNull()
      expect(recovery).toHaveAttribute('dir', 'ltr')
      // The same left-to-right rule of mfa.css selects it (see the code field of the setup dialog).
      expect(recovery.tagName).toBe('INPUT')
      expect(recovery).toHaveClass('ant-input', 'ant-input-rtl', 'profile-mfa__code-input', 'profile-mfa__code-input--recovery')
      expect(document.activeElement).toBe(recovery)
      // The link now leads back to the code of the app.
      expect(within(dialog).getByText(ar.profile.mfa.disable.useCode)).toBeInTheDocument()

      // What cannot be a recovery code is not sent.
      type(dialog, ar.profile.mfa.fields.recoveryCode, 'K7QX0-M9TRB')
      await submit(dialog, ar.profile.mfa.disable.submit)
      expect(await within(dialog).findByText(ar.profile.mfa.validation.recoveryCodeShape)).toBeInTheDocument()
      expect(writes(calls)).toEqual([])

      // A recovery code the server refuses (wrong, or used before) is said on its field and typed again.
      type(dialog, ar.profile.mfa.fields.recoveryCode, 'k7qx4 m9trb')
      await submit(dialog, ar.profile.mfa.disable.submit)
      expect(await within(dialog).findByText(ar.profile.mfa.errors.recovery_code_invalid)).toBeInTheDocument()
      expect(recovery).toHaveValue('')
      expect(document.activeElement).toBe(recovery)

      type(dialog, ar.profile.mfa.fields.recoveryCode, 'p3zwn-8hdca')
      await submit(dialog, ar.profile.mfa.disable.submit)
      await noDialog()

      // Exactly one factor travels: the code typed before the switch is not sent.
      expect(writes(calls)).toEqual([
        { request: DISABLE_POST, body: { password: 'right-pass-1', recoveryCode: 'K7QX4-M9TRB' } },
        { request: DISABLE_POST, body: { password: 'right-pass-1', recoveryCode: 'P3ZWN-8HDCA' } },
      ])
      expect(await within(card).findByText(ar.profile.mfa.disabledNotice)).toBeInTheDocument()
      // No other session ended, so none is mentioned.
      expect(within(card).queryByText(/سُجّل الخروج من الأجهزة الأخرى/)).toBeNull()
    })

    it('closes with a notice and re-reads when the server lost its key meanwhile', async () => {
      const calls = serve({ [STATUS]: [[200, ON], [200, { ...ON, available: false }]], [DISABLE_POST]: [refusal(503, 'mfa_unavailable')] })
      const { card, onSessionsChanged } = renderCard()
      fireEvent.click(await findButtonIn(card, ar.profile.mfa.actions.disable))
      const dialog = await dialogWith(ar.profile.mfa.disable.warning)

      type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
      type(dialog, ar.profile.mfa.fields.code, '492039')
      await submit(dialog, ar.profile.mfa.disable.submit)

      expect(await screen.findByText(ar.profile.mfa.errors.mfa_unavailable)).toBeInTheDocument()
      await noDialog()
      expect(await within(card).findByText(ar.profile.mfa.unavailableEnabled)).toBeInTheDocument()
      expect(within(card).queryByText(ar.profile.mfa.disabledNotice)).toBeNull()
      expect(reads(calls)).toBe(2)
      expect(onSessionsChanged).not.toHaveBeenCalled()
    })
  })

  describe('on the profile page', () => {
    it('sits in its own card and makes the devices card read its list again after it is turned off', async () => {
      const SESSIONS = 'GET /api/auth/sessions'
      const device = { id: 's-here', startedAt: '2026-11-15T08:00:00.000Z', lastActiveAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-11-22T10:00:00.000Z', userAgent: null, ipAddress: null, current: true }
      const calls = serve({
        [STATUS]: [[200, ON], [200, OFF]],
        [SESSIONS]: [[200, { items: [device] }]],
        [DISABLE_POST]: [[200, { revokedSessions: 1 }]],
      })
      const user = makeUser({ id: 'user-st', role: 'student', roles: ['student'], permissions: ['courses.read'] })
      renderWithProviders(<ProfilePage />, { auth: makeAuth({ user }), route: '/profile' })

      const card = (await screen.findByText(ar.profile.mfa.actions.disable)).closest<HTMLElement>('.ant-card')!
      expect(within(card).getByText(ar.profile.mfa.title)).toBeInTheDocument()
      await screen.findByText(ar.profile.sessions.thisDevice)
      expect(reads(calls, SESSIONS)).toBe(1)

      fireEvent.click(buttonIn(card, ar.profile.mfa.actions.disable))
      const dialog = await dialogWith(ar.profile.mfa.disable.warning)
      type(dialog, ar.profile.mfa.fields.password, 'right-pass-1')
      type(dialog, ar.profile.mfa.fields.code, '492039')
      await submit(dialog, ar.profile.mfa.disable.submit)
      await noDialog()

      expect(await within(card).findByText(i18n.t('profile.mfa.sessionsEnded', { count: 1 }))).toBeInTheDocument()
      await waitFor(() => expect(reads(calls, SESSIONS)).toBe(2))
      expect(await screen.findByText(ar.profile.sessions.thisDevice)).toBeInTheDocument()
    })
  })
})
