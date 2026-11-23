// `?create=<what>` opens a list page's creation form (J-F59 — the quick actions of the admin dashboard link there, e.g.
// `/users?create=teacher`, `/courses?create=course`): the value is handed to the page once and the parameter is
// removed, so a reload or the back button does not open the form again. The page decides what a value means and
// whether the caller may create (the same permission that shows its own «add» button); an unknown value, or a caller
// without that key, opens nothing — the parameter is removed either way. The server stays the boundary.
import { useEffect } from 'react'
import { useSearchParams } from 'react-router'

export const CREATE_PARAM = 'create'

/** The `?create=` value of /courses (a user kind is the value of /users). */
export const CREATE_COURSE = 'course'

/** A link that opens `path`'s creation form for `what`, e.g. `createLink('/users', 'teacher')`. */
export function createLink(path: string, what: string): string {
  return `${path}?${CREATE_PARAM}=${encodeURIComponent(what)}`
}

export function useCreateFromLink(open: (what: string) => void): void {
  const [params, setParams] = useSearchParams()
  const what = params.get(CREATE_PARAM)
  useEffect(() => {
    if (what === null) return
    open(what)
    // From the address as it is now, so another parameter removed in the same render (`?open=`) stays removed.
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete(CREATE_PARAM)
        return next
      },
      { replace: true },
    )
    // Runs for a new value only; `open` sets the page's state from what it reads at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [what])
}
