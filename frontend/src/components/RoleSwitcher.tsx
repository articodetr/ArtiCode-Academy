import { EyeOutlined } from '@ant-design/icons'
import { Select, Space, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/auth-context'
import { ROLES } from '../auth/roles'

/** Preview-only control: lets the demo user see the app as any academy role. */
export function RoleSwitcher() {
  const { t } = useTranslation()
  const { user, switchRole } = useAuth()
  if (!user) return null

  return (
    <Space size={6}>
      <EyeOutlined />
      <Typography.Text type="secondary">{t('common.viewAs')}</Typography.Text>
      <Select
        size="small"
        value={user.role}
        onChange={switchRole}
        style={{ minWidth: 140 }}
        options={ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) }))}
      />
    </Space>
  )
}
