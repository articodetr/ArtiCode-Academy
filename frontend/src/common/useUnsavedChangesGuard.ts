// The guard of a drawer that holds unsaved work (KI-052, KI-054; KI-055 since J-F27).
// The drawer hands it its aggregated `unsaved` flag and its `close`, and gets back:
// - `requestClose` for its `onClose` (the close button; Escape and a mask click too while
//   nothing is unsaved): closes at once, or asks «discard?» (common.unsaved.*);
// - `holdNavigation` for <NavigationBlocker onBlocked> inside the drawer: a router navigation
//   held while unsaved (browser back/forward) asks the same question — «discard» lets it
//   go on and closes the drawer, «keep editing» stays. Both share ONE question: a navigation
//   held while the close button's question is open joins it instead of asking again;
// - while unsaved, a `beforeunload` listener, so a reload, a tab close or a navigation to
//   another document gets the browser's own prompt. It goes once the work is saved or
//   discarded, and with the drawer.
import { App } from 'antd'
import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { createDiscardQuestion, preventUnload } from './unsavedChanges'
import type { BlockedNavigation, DiscardQuestion } from './unsavedChanges'

export interface UnsavedChangesGuard {
  /** The drawer's `onClose`: closes at once while nothing is unsaved, else asks «discard?» first. */
  requestClose: () => void
  /** NavigationBlocker's `onBlocked`: a held navigation joins the question on screen, or asks it. */
  holdNavigation: (navigation: BlockedNavigation | null) => void
}

/** What the question reads when it opens or is answered — always the drawer's latest render. */
interface LatestRender {
  t: ReturnType<typeof useTranslation>['t']
  modal: ReturnType<typeof App.useApp>['modal']
  discard: () => void
}

/** The «discard?» question on antd's `modal.confirm` (common.unsaved.*); reads `latest` only when used, never while rendering. */
function createUnsavedQuestion(latest: RefObject<LatestRender>): DiscardQuestion {
  return createDiscardQuestion({
    open: (answers) => {
      const { t, modal } = latest.current
      const confirm = modal.confirm({
        title: t('common.unsaved.title'),
        content: t('common.unsaved.content'),
        okText: t('common.unsaved.ok'),
        okButtonProps: { danger: true },
        cancelText: t('common.unsaved.cancel'),
        // Without parameters: antd closes the dialog itself after the answer.
        onOk: () => answers.discard(),
        onCancel: () => answers.keep(),
      })
      return () => confirm.destroy()
    },
    discard: () => latest.current.discard(),
  })
}

export function useUnsavedChangesGuard(unsaved: boolean, discard: () => void): UnsavedChangesGuard {
  const { t } = useTranslation()
  const { modal } = App.useApp()

  // The latest render, assigned in an effect (react(immutability)).
  const latest = useRef<LatestRender>({ t, modal, discard })
  useEffect(() => {
    latest.current = { t, modal, discard }
  })

  // One question for the drawer's lifetime, made on first use — in a handler or an effect, never while
  // rendering (react(refs)): it knows whether it is on screen.
  const question = useRef<DiscardQuestion | null>(null)
  const questionOf = useCallback(() => (question.current ??= createUnsavedQuestion(latest)), [])

  // KI-055: a reload, a tab close or a navigation to another document — the browser asks first.
  useEffect(() => {
    if (!unsaved) return
    const listener = (event: BeforeUnloadEvent) => preventUnload(event)
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [unsaved])

  // The drawer left the page: a question still on screen goes with it.
  useEffect(() => () => question.current?.dispose(), [])

  // Stable, so NavigationBlocker's effects do not run again on every render of the drawer.
  const holdNavigation = useCallback((navigation: BlockedNavigation | null) => questionOf().hold(navigation), [questionOf])

  return {
    requestClose: () => (unsaved ? questionOf().ask() : discard()),
    holdNavigation,
  }
}
