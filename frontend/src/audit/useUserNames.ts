// The names of the users an audit page mentions (redesign, 2026-11-14): API-011 carries ids only, so the page
// reads each actor (and each `users` entity) once through API-013 for a holder of `users.read`, and keeps the
// answers for the visit. A failed read leaves the short id in place; nothing is sent without the key.
import { useEffect, useState } from 'react'
import { getUser } from '../api/users'

const known = new Map<string, string | null>()

export function useUserNames(ids: readonly string[], enabled: boolean): ReadonlyMap<string, string | null> {
  const [, setVersion] = useState(0)
  const missing = enabled ? [...new Set(ids)].filter((id) => !known.has(id)) : []
  const wanted = missing.join(',')

  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    const list = wanted.split(',')
    for (const id of list) known.set(id, null)
    void Promise.all(
      list.map((id) =>
        getUser(id, { signal: controller.signal }).then(
          (user) => known.set(id, user.displayName || user.fullName),
          () => known.delete(id),
        ),
      ),
    ).then(() => {
      if (!controller.signal.aborted) setVersion((value) => value + 1)
    })
    return () => controller.abort()
  }, [wanted])

  return known
}

/** For tests: forget every name read so far. */
export function forgetUserNames(): void {
  known.clear()
}
