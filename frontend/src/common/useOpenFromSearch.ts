// `?open=<id>` opens a record on a list page (redesign, 2026-11-14 — the global search links there): the page's
// selection is set once and the parameter is removed, so a reload or the back button does not reopen it.
import { useEffect } from 'react'
import { useSearchParams } from 'react-router'

export const OPEN_PARAM = 'open'

export function useOpenFromSearch(select: (id: string) => void): void {
  const [params, setParams] = useSearchParams()
  const id = params.get(OPEN_PARAM)
  useEffect(() => {
    if (!id) return
    select(id)
    const next = new URLSearchParams(params)
    next.delete(OPEN_PARAM)
    setParams(next, { replace: true })
    // Runs for a new id only; `select` is a state setter and `params` is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
}
