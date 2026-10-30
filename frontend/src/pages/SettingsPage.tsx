// Academy settings. The general tab is still the prototype form on mock data
// (MOD-14 is planned); the "roles & permissions" tab is real (MOD-03-T13) and
// lives under /settings/roles behind `roles.manage` alone — a holder of that
// permission reaches it even without the rest of the settings (D-R06, ADR-027).
import { App, Button, Card, Form, Input, Select, Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { canAccess } from '../layout/navigation'
import { mockAcademySettings } from '../mock/data'
import type { MockAcademySettings } from '../mock/data'
import { RolesManager } from '../roles/RolesManager'
import { ForbiddenPage } from './ForbiddenPage'

export type SettingsSection = 'general' | 'roles'

const SECTION_PATHS: Readonly<Record<SettingsSection, string>> = { general: '/settings', roles: '/settings/roles' }

export function SettingsPage({ section = 'general' }: { section?: SettingsSection }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const canManageRoles = hasPermission('roles.manage')
  // The general tab follows the role matrix of the /settings route until T15 moves navigation to permissions.
  const canSeeGeneral = canAccess(user?.role ?? null, 'settings')

  if (section === 'roles' && !canManageRoles) return <ForbiddenPage />

  const tabs = [
    ...(canSeeGeneral ? [{ key: 'general', label: t('settings.tabs.general') }] : []),
    ...(canManageRoles ? [{ key: 'roles', label: t('settings.tabs.roles') }] : []),
  ]

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={section === 'roles' ? t('rolesAdmin.subtitle') : t('settings.subtitle')} />
      {tabs.length > 1 ? (
        <Tabs activeKey={section} items={tabs} onChange={(key) => navigate(SECTION_PATHS[key as SettingsSection])} style={{ marginBottom: 16 }} />
      ) : null}
      {section === 'roles' ? <RolesManager /> : <GeneralSettingsForm />}
    </>
  )
}

/** Prototype on mock data until MOD-14 (nothing is sent to the server). */
function GeneralSettingsForm() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  return (
    <Card style={{ maxWidth: 640 }}>
      <Form<MockAcademySettings>
        layout="vertical"
        initialValues={mockAcademySettings}
        onFinish={() => message.success(t('settings.savedDemo'))}
      >
        <Form.Item name="nameAr" label={t('settings.academyNameAr')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="nameEn" label={t('settings.academyNameEn')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="defaultLanguage" label={t('settings.defaultLanguage')}>
          <Select
            options={[
              { value: 'ar', label: 'العربية' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Form.Item>
        <Form.Item name="timezone" label={t('settings.timezone')}>
          <Input />
        </Form.Item>
        <Form.Item name="currency" label={t('settings.currency')}>
          <Input />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          {t('common.save')}
        </Button>
      </Form>
    </Card>
  )
}
