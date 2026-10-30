// Module × key matrix of the active permission catalog (API-023): one card
// per module with a "whole module" checkbox, one row per key with its
// localized description. Controlled (`value`/`onChange`), so it sits inside
// a Form.Item; locked keys are the ones the caller cannot grant.
import { Card, Checkbox, Flex, Space, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import type { PermissionGroup } from '../api/roles'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'

interface PermissionMatrixProps {
  groups: PermissionGroup[]
  /** Ticked keys (sorted on every change). */
  value?: string[]
  onChange?: (keys: string[]) => void
  /** Nothing can be ticked (academy_admin, or a caller without the right to change the set). */
  readOnly?: boolean
  /** Keys the caller cannot grant: shown, never ticked here (roles.policy.ts — lockedPermissions). */
  locked?: ReadonlySet<string>
}

const NO_LOCKS: ReadonlySet<string> = new Set()

export function PermissionMatrix({ groups, value = [], onChange, readOnly = false, locked = NO_LOCKS }: PermissionMatrixProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const selected = new Set(value)

  const emit = (next: Set<string>) => onChange?.([...next].sort())

  const toggleKey = (key: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(key)
    else next.delete(key)
    emit(next)
  }

  const toggleModule = (group: PermissionGroup, checked: boolean) => {
    const next = new Set(selected)
    for (const permission of group.permissions) {
      if (locked.has(permission.key)) continue
      if (checked) next.add(permission.key)
      else next.delete(permission.key)
    }
    emit(next)
  }

  if (groups.length === 0) return <Typography.Text type="secondary">{t('rolesAdmin.matrix.none')}</Typography.Text>

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      {groups.map((group) => {
        const togglable = group.permissions.filter((permission) => !locked.has(permission.key))
        const ticked = group.permissions.filter((permission) => selected.has(permission.key)).length
        const togglableTicked = togglable.filter((permission) => selected.has(permission.key)).length
        return (
          <Card
            key={group.module}
            size="small"
            title={
              <Flex justify="space-between" align="center" gap={12} wrap>
                <Checkbox
                  aria-label={t('rolesAdmin.matrix.selectAll', { module: group.module })}
                  disabled={readOnly || togglable.length === 0}
                  checked={togglable.length > 0 && togglableTicked === togglable.length}
                  indeterminate={togglableTicked > 0 && togglableTicked < togglable.length}
                  onChange={(event) => toggleModule(group, event.target.checked)}
                >
                  <Typography.Text strong dir="ltr">
                    {group.module}
                  </Typography.Text>
                </Checkbox>
                <Typography.Text type="secondary">
                  {t('rolesAdmin.matrix.selectedCount', { count: ticked, total: group.permissions.length })}
                </Typography.Text>
              </Flex>
            }
          >
            <Space orientation="vertical" size={4} style={{ width: '100%' }}>
              {group.permissions.map((permission) => {
                const description = permission.description ? localizedLabel(permission.description, language) : ''
                return (
                  <Checkbox
                    key={permission.key}
                    aria-label={description ? `${permission.key} ${description}` : permission.key}
                    checked={selected.has(permission.key)}
                    disabled={readOnly || locked.has(permission.key)}
                    onChange={(event) => toggleKey(permission.key, event.target.checked)}
                  >
                    <Typography.Text code dir="ltr">
                      {permission.key}
                    </Typography.Text>
                    {description ? (
                      <Typography.Text type="secondary" style={{ marginInlineStart: 8 }}>
                        {description}
                      </Typography.Text>
                    ) : null}
                  </Checkbox>
                )
              })}
            </Space>
          </Card>
        )
      })}
    </Space>
  )
}
