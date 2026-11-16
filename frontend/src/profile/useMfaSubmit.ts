// One request at a time for a form of the two-step verification dialogs (API-207..API-210), and what a refusal
// does to it (mfa.errors.ts): a message that names a field goes onto that field — a refused code is cleared, since
// a code is good for one try — and the cursor returns to it; a state the card no longer shows closes the dialog
// through `onStale`; an expired setup goes to `onSetupExpired`; «already on» answered to the code that turns it
// on goes to `onCodesUnseen` (it is on, and nobody saw its recovery codes); anything else is `error`, shown above
// the form — and when no answer came at all, `onUnanswered` is told too: the server may have done it all the same.
// The form stays enabled while the request runs (only its buttons wait), so the cursor can be put back at once.
// Leaving the page while it runs is the dialog's business (useMfaLeaveGuard, told through `onBusyChange`).
import type { FormInstance } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { describeMfaFailure, isUnanswered } from './mfa.errors'
import type { MfaFactor, MfaField } from './mfa.errors'

interface MfaSubmitOptions {
  /** The form whose fields are named `password`, `code`, `recoveryCode`. */
  form: FormInstance
  /** Puts the cursor into a field (after its refusal is shown). */
  focus: (field: MfaField) => void
  /** The account's state is not what the card shows: close with this message (an i18n key) and re-read. */
  onStale: (messageKey: string) => void
  /** The setup was not confirmed in time (API-208 only): start again, with this message (an i18n key). */
  onSetupExpired?: (messageKey: string) => void
  /**
   * Given by the form whose request is the code that turns two-step verification on (API-208), and by no other:
   * that request was answered «already on» — an earlier answer was lost with its recovery codes. Close, and keep
   * this message (an i18n key) on the card.
   */
  onCodesUnseen?: (messageKey: string) => void
  /**
   * The request ended without an answer (the connection dropped, a gateway gave up) — said above the form like
   * any failure, but what the server did is unknown: whoever cares re-reads the truth later.
   */
  onUnanswered?: () => void
  /** Told whenever a request starts or ends, so the dialog cannot be closed in between. */
  onBusyChange?: (busy: boolean) => void
}

export interface MfaSubmit {
  busy: boolean
  /** A failure that names no field, already translated; null when there is none. */
  error: string | null
  /** Shows a refusal on a field and puts the cursor there; `clear` also empties the field (a refused code is typed again). */
  refuse: (field: MfaField, message: string, clear?: boolean) => void
  /** Sends `request` unless one is running; `done` gets the answer. `factor` is the second factor it carries. */
  run: <T>(request: () => Promise<T>, done: (result: T) => void, factor?: MfaFactor) => Promise<void>
}

export function useMfaSubmit({ form, focus, onStale, onSetupExpired, onCodesUnseen, onUnanswered, onBusyChange }: MfaSubmitOptions): MfaSubmit {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A second Enter before the first render after a submit must not send twice.
  const running = useRef(false)
  // An answer that arrives after the dialog closed is dropped: it must not reopen or re-read anything.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refuse = (field: MfaField, message: string, clear = false) => {
    form.setFields([clear ? { name: field, value: '', errors: [message] } : { name: field, errors: [message] }])
    focus(field)
  }

  const run = async <T>(request: () => Promise<T>, done: (result: T) => void, factor: MfaFactor = 'code') => {
    if (running.current) return
    running.current = true
    setBusy(true)
    onBusyChange?.(true)
    setError(null)
    let result: T
    try {
      result = await request()
    } catch (failure) {
      if (!mounted.current) return
      if (isUnanswered(failure)) onUnanswered?.()
      const described = describeMfaFailure(failure, factor, onCodesUnseen !== undefined)
      if (described.effect === 'status_changed') onStale(described.key)
      else if (described.effect === 'codes_unseen') onCodesUnseen?.(described.key)
      else if (described.effect === 'setup_expired' && onSetupExpired) onSetupExpired(described.key)
      // A password stays as typed (it may be one key off); a code the server refused is typed again.
      else if (described.field) refuse(described.field, t(described.key), described.field !== 'password')
      else setError(t(described.key))
      return
    } finally {
      running.current = false
      if (mounted.current) {
        setBusy(false)
        onBusyChange?.(false)
      }
    }
    if (mounted.current) done(result)
  }

  return { busy, error, refuse, run }
}
