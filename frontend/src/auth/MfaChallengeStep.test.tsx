import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MfaChallenge } from '../api/auth'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { mfaChallengeResponse } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import type { AuthContextValue } from './auth-context'
import { MfaChallengeStep } from './MfaChallengeStep'

const mfa = ar.login.mfa

function refused(status: number, code: string, extra: Record<string, unknown> = {}) {
  return new ApiError(status, 'refused', { statusCode: status, code, ...extra })
}

function renderStep(options: { auth?: AuthContextValue; challenge?: MfaChallenge } = {}) {
  const auth = options.auth ?? makeAuth()
  const challenge = options.challenge ?? mfaChallengeResponse()
  const onSuccess = vi.fn()
  const onRestart = vi.fn()
  const utils = renderWithProviders(<MfaChallengeStep challenge={challenge} onSuccess={onSuccess} onRestart={onRestart} />, { auth })
  return { ...utils, auth, challenge, onSuccess, onRestart, complete: vi.mocked(auth.completeMfaLogin) }
}

const codeField = () => screen.getByLabelText<HTMLInputElement>(mfa.code)
const recoveryField = () => screen.getByLabelText<HTMLInputElement>(mfa.recoveryCode)
const submitButton = () => screen.getByText(mfa.submit).closest('button') as HTMLButtonElement

describe('MfaChallengeStep', () => {
  it('asks for the 6-digit code in a focused, numeric, one-time-code field and says when the step ends', () => {
    renderStep()

    const field = codeField()
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('inputmode', 'numeric')
    expect(field).toHaveAttribute('autocomplete', 'one-time-code')
    expect(field).toHaveAttribute('dir', 'ltr')
    // The class sits on the <input> itself — the stylesheet's `input.mfa-code-input` keeps it left to right in RTL.
    expect(field).toHaveClass('mfa-code-input')
    expect(field.tagName).toBe('INPUT')
    expect(field).toHaveValue('')
    expect(screen.getByText(mfa.intro)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('login.mfa.expiresInMinutes', { minutes: 5 }))).toBeInTheDocument()
    expect(screen.getByText(mfa.useRecoveryCode)).toBeInTheDocument()
    expect(screen.getByText(mfa.backToSignIn)).toBeInTheDocument()
    expect(submitButton()).toBeEnabled()
  })

  it('sends the typed code (spaces dropped) with the challenge on Enter and reports the signed-in user', async () => {
    const { complete, challenge, onSuccess, onRestart } = renderStep()
    const signedIn = makeUser({ id: 'user-9' })
    complete.mockResolvedValue(signedIn)

    await userEvent.type(codeField(), '123 456{Enter}')

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(challenge.challenge, { code: '123456' })
    expect(onRestart).not.toHaveBeenCalled()
    // Neither the challenge nor the code is written anywhere.
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('keeps the step after a wrong code: the message under the field, the field emptied and focused again', async () => {
    const { complete, onSuccess, onRestart } = renderStep()
    complete.mockRejectedValueOnce(refused(401, 'mfa_code_invalid'))

    await userEvent.type(codeField(), '111111')
    await userEvent.click(submitButton())

    expect(await screen.findByText(mfa.errors.code_invalid)).toBeInTheDocument()
    expect(codeField()).toHaveValue('')
    await waitFor(() => expect(codeField()).toHaveFocus())
    expect(submitButton()).toBeEnabled()
    expect(onRestart).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()

    // The same challenge takes the next code.
    const signedIn = makeUser()
    complete.mockResolvedValueOnce(signedIn)
    await userEvent.type(codeField(), '222222{Enter}')
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('never sends a code that cannot be right — it would cost one of the five attempts', async () => {
    const { complete } = renderStep()

    await userEvent.click(submitButton())
    expect(await screen.findByText(mfa.codeRequired)).toBeInTheDocument()

    await userEvent.type(codeField(), '12345{Enter}')
    expect(await screen.findByText(mfa.codeFormat)).toBeInTheDocument()

    await userEvent.clear(codeField())
    await userEvent.type(codeField(), '12345a{Enter}')
    expect(await screen.findByText(mfa.codeFormat)).toBeInTheDocument()
    expect(complete).not.toHaveBeenCalled()
  })

  it('sends one request when the form is submitted twice before it is disabled', async () => {
    const { complete, container } = renderStep()
    complete.mockReturnValue(new Promise<never>(() => {}))
    fireEvent.change(codeField(), { target: { value: '123456' } })
    const form = container.querySelector('form') as HTMLFormElement

    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(screen.getByText(mfa.submitting)).toBeInTheDocument()
  })

  it('switches to a recovery code and back, dropping what was typed for the other factor', async () => {
    const { complete, challenge, onSuccess } = renderStep()
    const user = userEvent.setup()
    await user.type(codeField(), '123')

    await user.click(screen.getByText(mfa.useRecoveryCode))

    expect(screen.queryByLabelText(mfa.code)).not.toBeInTheDocument()
    const recovery = recoveryField()
    await waitFor(() => expect(recovery).toHaveFocus())
    expect(recovery).toHaveAttribute('dir', 'ltr')
    expect(recovery).toHaveAttribute('autocomplete', 'off')
    expect(recovery).toHaveAttribute('placeholder', 'XXXXX-XXXXX')
    expect(recovery).toHaveClass('mfa-code-input', 'mfa-code-input--recovery')
    expect(screen.getByText(mfa.recoveryIntro)).toBeInTheDocument()

    // A look-alike symbol is refused here, never sent.
    await user.type(recovery, 'ABCDE-FGHJ0{Enter}')
    expect(await screen.findByText(mfa.recoveryCodeFormat)).toBeInTheDocument()
    expect(complete).not.toHaveBeenCalled()

    // A used or wrong recovery code: the step stays, the field is emptied.
    complete.mockRejectedValueOnce(refused(401, 'mfa_code_invalid'))
    await user.clear(recoveryField())
    await user.type(recoveryField(), 'zzzzz zzzzz{Enter}')
    expect(await screen.findByText(mfa.errors.recovery_code_invalid)).toBeInTheDocument()
    expect(complete).toHaveBeenLastCalledWith(challenge.challenge, { recoveryCode: 'ZZZZZ-ZZZZZ' })
    expect(recoveryField()).toHaveValue('')

    // Back to the authenticator's code: an empty field again.
    await waitFor(() => expect(screen.getByText(mfa.useAuthenticatorCode).closest('button')).toBeEnabled())
    await user.click(screen.getByText(mfa.useAuthenticatorCode))
    expect(screen.queryByLabelText(mfa.recoveryCode)).not.toBeInTheDocument()
    expect(codeField()).toHaveValue('')

    // And a good recovery code signs in, sent as XXXXX-XXXXX whatever was typed.
    await user.click(screen.getByText(mfa.useRecoveryCode))
    const signedIn = makeUser()
    complete.mockResolvedValueOnce(signedIn)
    await user.type(recoveryField(), 'abcde fghjk{Enter}')
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    expect(complete).toHaveBeenLastCalledWith(challenge.challenge, { recoveryCode: 'ABCDE-FGHJK' })
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('hands the visitor back to the password form, with the reason, when the server says the challenge is over', async () => {
    const { complete, onRestart, onSuccess } = renderStep()
    complete.mockRejectedValue(refused(401, 'mfa_challenge_invalid'))

    await userEvent.type(codeField(), '123456{Enter}')

    await waitFor(() => expect(onRestart).toHaveBeenCalledTimes(1))
    expect(onRestart).toHaveBeenCalledWith('ended')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('tells a locked account how many minutes to wait and empties the field', async () => {
    const { complete, onRestart } = renderStep()
    complete.mockRejectedValue(refused(423, 'account_locked', { retryAfterSeconds: 841 }))

    await userEvent.type(codeField(), '123456{Enter}')

    expect(await screen.findByText(i18n.t('login.errors.account_locked', { minutes: 15 }))).toBeInTheDocument()
    expect(codeField()).toHaveValue('')
    expect(onRestart).not.toHaveBeenCalled()
  })

  it.each([
    [429, 'rate_limited', ar.login.errors.rate_limited],
    [503, 'mfa_unavailable', ar.login.errors.mfa_unavailable],
    [403, 'account_suspended', ar.login.errors.account_suspended],
    [500, 'internal', ar.login.errors.server],
  ])('words a %i %s above the field and never shows the raw code', async (status, code, message) => {
    const { complete, onRestart } = renderStep()
    complete.mockRejectedValue(refused(status, code))

    await userEvent.type(codeField(), '123456{Enter}')

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(code))).not.toBeInTheDocument()
    expect(codeField()).toHaveValue('')
    expect(onRestart).not.toHaveBeenCalled()
  })

  it('keeps the typed code when the server could not be reached, so it can be sent again', async () => {
    const { complete, onSuccess } = renderStep()
    complete.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await userEvent.type(codeField(), '123456{Enter}')

    expect(await screen.findByText(ar.login.errors.network)).toBeInTheDocument()
    expect(codeField()).toHaveValue('123456')

    const signedIn = makeUser()
    complete.mockResolvedValueOnce(signedIn)
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await userEvent.click(submitButton())
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    // The error of the first try is gone once the next one starts.
    expect(screen.queryByText(ar.login.errors.network)).not.toBeInTheDocument()
  })

  it('goes back to the password form when the visitor asks for it', async () => {
    const { complete, onRestart } = renderStep()

    await userEvent.click(screen.getByText(mfa.backToSignIn))

    expect(onRestart).toHaveBeenCalledTimes(1)
    expect(onRestart).toHaveBeenCalledWith('back')
    expect(complete).not.toHaveBeenCalled()
  })

  describe('the step’s clock', () => {
    afterEach(() => {
      // The spies wrap the fake timers: take them off first, then put the real timers back.
      vi.restoreAllMocks()
      vi.useRealTimers()
    })

    const advance = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms)
      })

    /** Fakes the timers and watches the step's own one-second clock among Ant Design's timers. */
    function watchClock() {
      vi.useFakeTimers()
      const set = vi.spyOn(window, 'setInterval')
      const clear = vi.spyOn(window, 'clearInterval')
      return {
        /** Ids of the one-second intervals started so far. */
        started: () => set.mock.results.filter((_, index) => set.mock.calls[index]?.[1] === 1000).map((result) => result.value as unknown),
        cleared: () => clear.mock.calls.map(([id]) => id as unknown),
      }
    }

    it('counts the minutes down, then says the step expired and offers to sign in again', () => {
      const clock = watchClock()
      vi.setSystemTime(new Date('2026-11-16T09:30:00.000Z'))
      const { complete, onRestart } = renderStep({
        challenge: mfaChallengeResponse({ expiresAt: '2026-11-16T09:35:00.000Z' }),
      })
      expect(screen.getByText(i18n.t('login.mfa.expiresInMinutes', { minutes: 5 }))).toBeInTheDocument()

      advance(2 * 60_000 + 30_000)
      expect(screen.getByText(i18n.t('login.mfa.expiresInMinutes', { minutes: 3 }))).toBeInTheDocument()
      advance(60_000)
      expect(screen.getByText(mfa.expiresInTwoMinutes)).toBeInTheDocument()
      advance(60_000)
      expect(screen.getByText(mfa.expiresSoon)).toBeInTheDocument()
      expect(screen.getByLabelText(mfa.code)).toBeInTheDocument()

      advance(30_000)
      expect(screen.getByText(mfa.expired)).toBeInTheDocument()
      expect(screen.queryByLabelText(mfa.code)).not.toBeInTheDocument()
      expect(screen.queryByText(mfa.expiresSoon)).not.toBeInTheDocument()
      expect(onRestart).not.toHaveBeenCalled()
      // The clock stopped by itself once the time was up.
      expect(clock.started()).toHaveLength(1)
      expect(clock.cleared()).toContain(clock.started()[0])

      fireEvent.click(screen.getByText(mfa.signInAgain))
      expect(onRestart).toHaveBeenCalledTimes(1)
      expect(onRestart).toHaveBeenCalledWith('back')
      expect(complete).not.toHaveBeenCalled()
    })

    it('stops its timer when the step unmounts', () => {
      const clock = watchClock()
      const { unmount } = renderStep()
      expect(clock.started()).toHaveLength(1)
      expect(clock.cleared()).not.toContain(clock.started()[0])

      unmount()

      expect(clock.cleared()).toContain(clock.started()[0])
    })

    it('does not call a fresh challenge expired because this device’s clock is ahead', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-16T09:50:00.000Z'))
      // Issued a moment ago by a server whose clock says 09:30 — this device says 09:50.
      renderStep({ challenge: mfaChallengeResponse({ expiresAt: '2026-11-16T09:35:00.000Z' }) })

      expect(screen.getByLabelText(mfa.code)).toBeInTheDocument()
      expect(screen.queryByText(mfa.expired)).not.toBeInTheDocument()
      expect(screen.getByText(i18n.t('login.mfa.expiresInMinutes', { minutes: 5 }))).toBeInTheDocument()

      advance(5 * 60_000)
      expect(screen.getByText(mfa.expired)).toBeInTheDocument()
    })
  })
})
