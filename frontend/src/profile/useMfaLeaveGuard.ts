// What leaving the page must not take away while a dialog of the two-step verification card is open:
// - the recovery codes on screen — shown ONCE (API-208, API-210) — until they are ticked as saved;
// - the answer of a request still running: a secret or those codes would arrive at a page that is gone, and the
//   server never gives them a second time.
// Escape, the mask, × and «close» are the dialog's own business (off in both states). This is the rest, the two
// ways out of KI-055:
// - a router navigation (browser back/forward, the Android back button, a link): the dialog renders
//   <NavigationBlocker when={guarded} onBlocked={holdNavigation} />, which holds it. While a request runs it is
//   refused with a word why — the dialog cannot be left then by any other way either. Over unsaved codes ONE
//   worded question is asked (profile.mfa.leave.*): «leave without saving» lets the navigation go on and closes
//   the dialog, «stay» cancels it — the question of the drawers' guard (common/unsavedChanges.ts), in words that
//   say what is lost;
// - a reload, a tab close or a navigation to another document: the browser's own prompt (`beforeunload`).
// Nothing of the codes is read here: the guard knows only that they are on screen.
import { App } from 'antd'
import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { createDiscardQuestion, preventUnload } from '../common/unsavedChanges'
import type { BlockedNavigation, DiscardQuestion } from '../common/unsavedChanges'

interface MfaLeaveGuardOptions {
  /** A request of the dialog is running. */
  busy: boolean
  /** The once-only recovery codes are on screen and not ticked as saved yet. */
  codesUnsaved: boolean
  /** «Leave without saving» was chosen: the dialog goes (the held navigation has gone on first). */
  onLeave: () => void
}

export interface MfaLeaveGuard {
  /** Whether leaving is held now — the `when` of the dialog's NavigationBlocker. */
  guarded: boolean
  /** NavigationBlocker's `onBlocked`: refuses a navigation during a request, asks over unsaved codes. */
  holdNavigation: (navigation: BlockedNavigation | null) => void
}

/** One notice however often «back» is pressed while the request runs. */
const BUSY_NOTICE_KEY = 'profile-mfa-request-running'

/** What the guard reads when a navigation is held or the question is answered — always the dialog's latest render. */
interface LatestRender {
  t: ReturnType<typeof useTranslation>['t']
  modal: ReturnType<typeof App.useApp>['modal']
  message: ReturnType<typeof App.useApp>['message']
  busy: boolean
  codesUnsaved: boolean
  onLeave: () => void
}

/** «Leave before saving the recovery codes?» on antd's `modal.confirm`; reads `latest` only when used, never while rendering. */
function createLeaveQuestion(latest: RefObject<LatestRender>): DiscardQuestion {
  return createDiscardQuestion({
    open: (answers) => {
      const { t, modal } = latest.current
      const confirm = modal.confirm({
        title: t('profile.mfa.leave.title'),
        content: t('profile.mfa.leave.content'),
        okText: t('profile.mfa.leave.ok'),
        okButtonProps: { danger: true },
        cancelText: t('profile.mfa.leave.cancel'),
        // Staying is the safe answer: it is the one Enter and Escape give.
        focusable: { autoFocusButton: 'cancel' },
        // Without parameters: antd closes the question itself after the answer.
        onOk: () => answers.discard(),
        onCancel: () => answers.keep(),
      })
      return () => confirm.destroy()
    },
    discard: () => latest.current.onLeave(),
  })
}

export function useMfaLeaveGuard({ busy, codesUnsaved, onLeave }: MfaLeaveGuardOptions): MfaLeaveGuard {
  const { t } = useTranslation()
  const { modal, message } = App.useApp()
  const guarded = busy || codesUnsaved

  // The latest render, assigned in an effect (react(immutability)).
  const latest = useRef<LatestRender>({ t, modal, message, busy, codesUnsaved, onLeave })
  useEffect(() => {
    latest.current = { t, modal, message, busy, codesUnsaved, onLeave }
  })

  // One question for the dialog's lifetime, made on first use — in a handler or an effect, never while rendering.
  const question = useRef<DiscardQuestion | null>(null)
  const questionOf = useCallback(() => (question.current ??= createLeaveQuestion(latest)), [])

  // A reload, a tab close or a navigation to another document — the browser asks first.
  useEffect(() => {
    if (!guarded) return
    const listener = (event: BeforeUnloadEvent) => preventUnload(event)
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [guarded])

  // The dialog left the page: a question still on screen goes with it.
  useEffect(() => () => question.current?.dispose(), [])

  // Stable, so NavigationBlocker's effects do not run again on every render of the dialog.
  const holdNavigation = useCallback(
    (navigation: BlockedNavigation | null) => {
      const now = latest.current
      if (navigation === null) {
        // The blocker holds nothing any more: a question on screen keeps its answers, without a navigation.
        question.current?.hold(null)
      } else if (now.busy) {
        // The answer is on its way and comes once: stay for it. Nothing is asked — there is no leaving to offer.
        navigation.reset()
        now.message.info({ key: BUSY_NOTICE_KEY, content: now.t('profile.mfa.leave.busy') })
      } else if (now.codesUnsaved) {
        questionOf().hold(navigation)
      } else {
        // Nothing is held any more (the tick came just before): the navigation goes on.
        navigation.proceed()
      }
    },
    [questionOf],
  )

  return { guarded, holdNavigation }
}
