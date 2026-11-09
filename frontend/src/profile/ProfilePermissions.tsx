// The signed-in user's permissions on the profile page (J-F36): one collapsed
// panel per area with its translated heading and key count, so the 57 keys of
// an academy admin read as 23 short lines; a panel opens on its keys, each in
// a left-to-right code form.
import { Collapse, Flex, Tag, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { groupPermissions, permissionAreaLabel } from './profile.permissions'

interface ProfilePermissionsProps {
  /** Permission keys of the session user (API-005..010 `permissions`). */
  permissions: readonly string[]
}

export function ProfilePermissions({ permissions }: ProfilePermissionsProps) {
  const { t } = useTranslation()
  const areas = useMemo(() => groupPermissions(permissions), [permissions])

  if (areas.length === 0) return <Typography.Text type="secondary">{t('profile.noPermissions')}</Typography.Text>

  return (
    <Collapse
      size="small"
      items={areas.map((area) => ({
        key: area.area,
        // An area the catalog mirror does not know shows its prefix, left to right like the keys.
        label: area.labelKey ? permissionAreaLabel(area, t) : <bdi dir="ltr">{area.area}</bdi>,
        extra: <Tag variant="filled">{area.keys.length}</Tag>,
        children: (
          <Flex wrap gap={6}>
            {area.keys.map((key) => (
              <Typography.Text key={key} code>
                <bdi dir="ltr">{key}</bdi>
              </Typography.Text>
            ))}
          </Flex>
        ),
      }))}
    />
  )
}
