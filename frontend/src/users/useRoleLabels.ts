// Role labels of the users screens (J-F12): GET /api/roles (API-022) read once
// per mount of the page that calls this hook, and shared by every role tag and
// the role filter of that page — never one request per row. API-022 requires
// `users.read`, so nothing is requested without it; then, and after any
// failure, the labels stay empty and roleLabel() shows the raw key. This is a
// decoration: it never shows an error of its own.
import { useEffect, useMemo, useState } from 'react'
import { listRoles } from '../api/roles'
import type { Role } from '../api/roles'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { roleLabelsOf } from './users.format'
import type { RoleLabels } from './users.format'

/** The permission API-022 requires (READ_ROLES_PERMISSION in backend/src/roles/roles.policy.ts). */
export const ROLE_LABELS_PERMISSION = 'users.read'

const NO_ROLES: readonly Role[] = []

export function useRoleLabels(): RoleLabels {
  const { hasPermission } = useAuth()
  const { language } = useLocalized()
  const allowed = hasPermission(ROLE_LABELS_PERMISSION)
  const [roles, setRoles] = useState<readonly Role[]>(NO_ROLES)

  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    listRoles(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setRoles(list.items)
      })
      // Silent on purpose: the tags keep their raw keys and the page carries on.
      .catch(() => undefined)
    return () => controller.abort()
  }, [allowed])

  // A permission lost after loading hides what was read under it.
  const shown = allowed ? roles : NO_ROLES
  return useMemo(() => roleLabelsOf(shown, language), [shown, language])
}
