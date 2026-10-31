// Academy settings. The general tab is real since CH-0036 (MOD-02/MOD-14
// minimum: GET/PATCH /api/academy — read for everyone who reaches the screen,
// save for `academy.settings.manage`); the "roles & permissions" tab is real
// since MOD-03-T13 and lives under /settings/roles behind `roles.manage` alone —
// a holder of that permission reaches it even without the rest of the settings
// (D-R06, ADR-027).
import { Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { GeneralSettingsForm } from '../academy/GeneralSettingsForm'
import { useAuth } from '../auth/auth-context'
import { RequireAccess } from '../auth/RequireAuth'
import { PageHeader } from '../components/PageHeader'
import { canAccess } from '../layout/navigation'
import { RolesManager } from '../roles/RolesManager'

export type SettingsSection = 'general' | 'roles'

const SECTION_PATHS: Readonly<Record<SettingsSection, string>> = { general: '/settings', roles: '/settings/roles' }

export function SettingsPage({ section = 'general' }: { section?: SettingsSection }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const canManageRoles = hasPermission('roles.manage')
  // The general tab follows the gate of the /settings entry (`academy.settings.read` or `.manage` since CH-0036).
  const canSeeGeneral = user ? canAccess(user, 'settings') : false

  const tabs = [
    ...(canSeeGeneral ? [{ key: 'general', label: t('settings.tabs.general') }] : []),
    ...(canManageRoles ? [{ key: 'roles', label: t('settings.tabs.roles') }] : []),
  ]

  const content = (
    <>
      <PageHeader title={t('settings.title')} subtitle={section === 'roles' ? t('rolesAdmin.subtitle') : t('settings.subtitle')} />
      {tabs.length > 1 ? (
        <Tabs activeKey={section} items={tabs} onChange={(key) => navigate(SECTION_PATHS[key as SettingsSection])} style={{ marginBottom: 16 }} />
      ) : null}
      {section === 'roles' ? <RolesManager /> : <GeneralSettingsForm />}
    </>
  )

  // The roles tab is gated by its permission inside the page too, so a direct render (and the
  // route without its guard) still answers 403 without `roles.manage` (D-R06; RequireAccess — T15).
  return section === 'roles' ? <RequireAccess permission="roles.manage">{content}</RequireAccess> : content
}
