// The sitting of one attempt for the exam page: creates the session
// (attemptSession.ts) for the page's lifetime, follows its snapshot, and hands
// it the events of the page it cannot see by itself — the tab hidden or shown
// again, the page leaving, the network coming back.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createAttemptSession } from './attemptSession'
import type { AttemptSession, SessionSnapshot } from './attemptSession'

export interface AttemptSessionHandle {
  session: AttemptSession
  snapshot: SessionSnapshot
}

/** Mount the caller with `key={attemptId}`: one session per attempt. */
export function useAttemptSession(attemptId: string): AttemptSessionHandle {
  const [session] = useState(() => createAttemptSession(attemptId))
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)

  useEffect(() => {
    session.start()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') session.pageHidden()
      else session.pageVisible()
    }
    // `pagehide` too: a browser does not always report a page that is being left as hidden first.
    const onPageHide = () => session.pageHidden()
    const onOnline = () => session.retrySave()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('online', onOnline)
      session.stop()
    }
  }, [session])

  return { session, snapshot }
}
