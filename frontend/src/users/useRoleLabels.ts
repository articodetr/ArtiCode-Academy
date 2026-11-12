// Role labels of the users screens (J-F12): GET /api/roles (API-022) read once
// per mount of the page that calls this hook, and shared by every role tag and
// the role filter of that page — never one request per row. API-022 requires
// `users.read`, so nothing is requested without it; then, and after any
// failure, the labels stay empty and roleLabel() shows the raw key. This is a
// decoration: it never shows an error of its own. Since J-F23 the roles read
// are handed out as `items` too, so the user drawer's roles tab reuses them
// instead of asking API-022 a second time in the same visit (PR #62 review,
// note 1); `items` stays null until they are read, and without the permission
// or after a failure, and the tab then reads them itself. With `enabled` false
// it asks nothing at all — the profile page reads the labels only for a user
// who holds a custom role (J-F36). `reload()` reads them again (the users
// page's refresh button — the owner's note 2 on #78): a role created or
// changed in /settings/roles meanwhile then reaches the labels, the role
// filter and the drawer's roles tab with its local locks; a failed re-read
// keeps the roles read last.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listRoles } from '../api/roles'
import type { Role } from '../api/roles'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { roleLabelsOf } from './users.format'
import type { RoleLabels } from './users.format'

/** The permission API-022 requires (READ_ROLES_PERMISSION in backend/src/roles/roles.policy.ts). */
export const ROLE_LABELS_PERMISSION = 'users.read'

/** The role labels of the page and the roles of API-022 they were built from. */
export interface PageRoles extends RoleLabels {
  /** The roles as API-022 returned them; null while the first read runs, without `users.read` and after a failed first read. */
  items: readonly Role[] | null
  /** Reads the roles again; nothing is asked without `users.read` or while disabled. */
  reload: () => void
}

const NO_ROLES: readonly Role[] = []

export function useRoleLabels(enabled = true): PageRoles {
  const { hasPermission } = useAuth()
  const { language } = useLocalized()
  const allowed = enabled && hasPermission(ROLE_LABELS_PERMISSION)
  const [roles, setRoles] = useState<readonly Role[] | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    listRoles(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setRoles(list.items)
      })
      // Silent on purpose: the tags keep their raw keys (or the labels read last) and the page carries on.
      .catch(() => undefined)
    return () => controller.abort()
  }, [allowed, reloadTick])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  // A permission lost after loading hides what was read under it.
  const shown = allowed ? roles : null
  return useMemo(() => ({ ...roleLabelsOf(shown ?? NO_ROLES, language), items: shown, reload }), [shown, language, reload])
}
