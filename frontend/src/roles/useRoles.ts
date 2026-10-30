// State of the roles screen (MOD-03-T13): the role list (API-022) and the
// active permission catalog (API-023) loaded together, reloadable, and kept
// in sync with what the server returned for every write (no optimism —
// the list shows the role exactly as the response carries it).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listPermissions, listRoles } from '../api/roles'
import type { PermissionGroup, Role } from '../api/roles'

interface RolesState {
  /** Identifies the request this state answers; a different key on screen means loading. */
  key: number
  roles: Role[]
  catalog: PermissionGroup[]
  error: unknown
}

const INITIAL: RolesState = { key: -1, roles: [], catalog: [], error: null }

/** System roles first, then custom roles, each group by key — the order of API-022. */
export function sortRoles(roles: readonly Role[]): Role[] {
  return [...roles].sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.key.localeCompare(b.key))
}

export function useRoles() {
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<RolesState>(INITIAL)
  const loading = state.key !== tick

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([listRoles(controller.signal), listPermissions(controller.signal)])
      .then(([roles, catalog]) => {
        if (controller.signal.aborted) return
        setState({ key: tick, roles: roles.items, catalog: catalog.groups, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        // Keep what was on screen behind the error message.
        setState((current) => ({ ...current, key: tick, error }))
      })
    return () => controller.abort()
  }, [tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])

  /** After a successful POST: the created role joins the list in server order. */
  const addRole = useCallback((role: Role) => {
    setState((current) => ({ ...current, roles: sortRoles([...current.roles.filter((item) => item.id !== role.id), role]) }))
  }, [])

  /** After a successful PATCH: the row shows the role as the response returned it. */
  const replaceRole = useCallback((role: Role) => {
    setState((current) => ({ ...current, roles: current.roles.map((item) => (item.id === role.id ? role : item)) }))
  }, [])

  /** After a successful DELETE (204). */
  const removeRole = useCallback((id: string) => {
    setState((current) => ({ ...current, roles: current.roles.filter((item) => item.id !== id) }))
  }, [])

  return useMemo(
    () => ({
      roles: state.roles,
      catalog: state.catalog,
      /** Number of active keys in the catalog. */
      catalogSize: state.catalog.reduce((sum, group) => sum + group.permissions.length, 0),
      loading,
      error: state.error,
      reload,
      addRole,
      replaceRole,
      removeRole,
    }),
    [state, loading, reload, addRole, replaceRole, removeRole],
  )
}
