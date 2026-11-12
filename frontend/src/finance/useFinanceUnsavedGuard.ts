// The guard of a finance modal that holds unsaved work (J-F52), on the pattern
// of common/useUnsavedChangesGuard.ts (J-F27 — KI-052, KI-054, KI-055) but in
// the words of a window rather than a drawer (finance.unsaved.* — the owner's
// note 1 on #118: common.unsaved.content names a drawer). It hands back:
// - `requestClose` for the modal's `onCancel` (× and «إلغاء»; Escape and a mask
//   click too while nothing is unsaved): closes at once, or asks «discard?»;
// - `holdNavigation` for <NavigationBlocker onBlocked> in a modal opened from
//   the page (a modal inside a drawer reports its work to the drawer instead,
//   whose blocker holds the navigation — a router keeps one blocker at a time);
// - while unsaved, a `beforeunload` listener: a reload or a tab close gets the
//   browser's own prompt.
// Built on the shared pure parts (common/unsavedChanges.ts, imported as they are).
import { App } from 'antd'
import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { createDiscardQuestion, preventUnload } from '../common/unsavedChanges'
import type { BlockedNavigation, DiscardQuestion } from '../common/unsavedChanges'

export interface FinanceUnsavedGuard {
  /** The modal's `onCancel`: closes at once while nothing is unsaved, else asks «discard?» first. */
  requestClose: () => void
  /** NavigationBlocker's `onBlocked`: a held navigation joins the question on screen, or asks it. */
  holdNavigation: (navigation: BlockedNavigation | null) => void
}

interface LatestRender {
  t: ReturnType<typeof useTranslation>['t']
  modal: ReturnType<typeof App.useApp>['modal']
  discard: () => void
}

function createQuestion(latest: RefObject<LatestRender>): DiscardQuestion {
  return createDiscardQuestion({
    open: (answers) => {
      const { t, modal } = latest.current
      const confirm = modal.confirm({
        title: t('finance.unsaved.title'),
        content: t('finance.unsaved.content'),
        okText: t('finance.unsaved.ok'),
        okButtonProps: { danger: true },
        cancelText: t('finance.unsaved.cancel'),
        onOk: () => answers.discard(),
        onCancel: () => answers.keep(),
      })
      return () => confirm.destroy()
    },
    discard: () => latest.current.discard(),
  })
}

export function useFinanceUnsavedGuard(unsaved: boolean, discard: () => void): FinanceUnsavedGuard {
  const { t } = useTranslation()
  const { modal } = App.useApp()

  // The latest render, assigned in an effect (react(immutability)).
  const latest = useRef<LatestRender>({ t, modal, discard })
  useEffect(() => {
    latest.current = { t, modal, discard }
  })

  // One question for the modal's lifetime, made on first use (in a handler or an effect, never while rendering).
  const question = useRef<DiscardQuestion | null>(null)
  const questionOf = useCallback(() => (question.current ??= createQuestion(latest)), [])

  useEffect(() => {
    if (!unsaved) return
    const listener = (event: BeforeUnloadEvent) => preventUnload(event)
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [unsaved])

  // The modal left the page: a question still on screen goes with it.
  useEffect(() => () => question.current?.dispose(), [])

  const holdNavigation = useCallback((navigation: BlockedNavigation | null) => questionOf().hold(navigation), [questionOf])

  return {
    requestClose: () => (unsaved ? questionOf().ask() : discard()),
    holdNavigation,
  }
}
