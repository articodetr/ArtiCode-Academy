// The pure parts of the guard that keeps a drawer's unsaved work (KI-052, KI-054; since
// J-F27 also KI-055): the `beforeunload` listener behind the browser's own prompt (a
// reload, a tab close, a navigation to another document), and ONE «discard?» question
// per drawer, answered for the close button and for a router navigation the blocker
// holds (browser back/forward) alike — never two on screen at once. The hook
// useUnsavedChangesGuard puts the question on screen; NavigationBlocker holds the navigation.

/**
 * The `beforeunload` listener while unsaved work would be lost: the browser then asks
 * before it leaves the page, in its own words (no text of ours is shown).
 */
export function preventUnload(event: BeforeUnloadEvent): void {
  event.preventDefault()
  // Older browsers (Chrome and Edge before 119) ask only when `returnValue` is set.
  event.returnValue = ''
}

/** A router navigation the blocker holds (react-router's blocked Blocker): let it go on, or stay. */
export interface BlockedNavigation {
  proceed: () => void
  reset: () => void
}

/** The two answers of the «discard?» question. */
export interface DiscardAnswers {
  /** «Discard and close»: a held navigation goes on, then the work is dropped. */
  discard: () => void
  /** «Keep editing»: a held navigation is cancelled and the work stays. */
  keep: () => void
}

export interface DiscardQuestionOptions {
  /** Puts the question on screen with its two answers; returns how to take it down unanswered. */
  open: (answers: DiscardAnswers) => () => void
  /** Drops the unsaved work (the drawer closes). */
  discard: () => void
}

export interface DiscardQuestion {
  /** The close button while unsaved work is held: asks, unless the question is already on screen. */
  ask: () => void
  /**
   * The navigation the router blocker holds now, or null once it holds none (answered, or
   * the blocker gone): a held navigation joins the question on screen, or asks it.
   */
  hold: (navigation: BlockedNavigation | null) => void
  /** The drawer left the page: takes a question on screen down, unanswered. */
  dispose: () => void
}

export function createDiscardQuestion({ open, discard }: DiscardQuestionOptions): DiscardQuestion {
  /** The question on screen (how to take it down), or null. */
  let onScreen: { takeDown: () => void } | null = null
  /** The navigation the blocker holds — answered together with the question on screen. */
  let held: BlockedNavigation | null = null

  const ask = () => {
    if (onScreen) return
    const question = { takeDown: () => {} }
    onScreen = question
    /** Each question settles once: a late or repeated answer, or one after a take-down, does nothing. */
    const settle = (answer: (navigation: BlockedNavigation | null) => void) => () => {
      if (onScreen !== question) return
      onScreen = null
      const navigation = held
      held = null
      answer(navigation)
    }
    question.takeDown = open({
      discard: settle((navigation) => {
        // The navigation first: closing the drawer takes its body, and the blocker with it, away.
        navigation?.proceed()
        discard()
      }),
      keep: settle((navigation) => navigation?.reset()),
    })
  }

  return {
    ask,
    hold: (navigation) => {
      held = navigation
      if (navigation) ask()
    },
    dispose: () => {
      const question = onScreen
      onScreen = null
      held = null
      question?.takeDown()
    },
  }
}
