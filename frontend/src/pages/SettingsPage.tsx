// Academy settings. The general tab is real since CH-0036 (MOD-02/MOD-14
// minimum: GET/PATCH /api/academy — read for everyone who reaches the screen,
// save for `academy.settings.manage`); the "roles & permissions" tab is real
// since MOD-03-T13 and lives under /settings/roles behind `roles.manage` alone —
// a holder of that permission reaches it even without the rest of the settings
// (D-R06, ADR-027); the "branches" tab (MOD-02-T06 screen, API-080..API-083)
// lives under /settings/branches behind `branches.manage` alone, and the "rooms"
// tab (J-F06 — MOD-07-T02 screen, API-084..API-087) under /settings/rooms behind
// `schedule.manage` alone, on the same pattern; and the "grade schemes" tab (J-F44 —
// MOD-09-T08 part a, API-122..API-125) under /settings/grade-schemes behind
// `academy.settings.manage` alone (reading the schemes needs no key, every write that one); and the "fee plans" tab
// (J-F52 — MOD-11-T07, API-140..API-143) under /settings/fee-plans behind `fee_plans.manage` or `invoices.manage` (either
// reads the plans — its nav entry decides; writing needs `fee_plans.manage`).
import { Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { GeneralSettingsForm } from '../academy/GeneralSettingsForm'
import { MANAGE_ACADEMY_SETTINGS_PERMISSION } from '../academy/academy.policy'
import { useAuth } from '../auth/auth-context'
import { RequireAccess } from '../auth/RequireAuth'
import { BranchesManager } from '../branches/BranchesManager'
import { MANAGE_BRANCHES_PERMISSION } from '../branches/branches.policy'
import { PageHeader } from '../components/PageHeader'
import { GradeSchemesManager } from '../grades/GradeSchemesManager'
import { FeePlansManager } from '../finance/FeePlansManager'
import { canAccess } from '../layout/navigation'
import { RolesManager } from '../roles/RolesManager'
import { RoomsManager } from '../rooms/RoomsManager'
import { MANAGE_SCHEDULE_PERMISSION } from '../rooms/rooms.policy'

export type SettingsSection = 'general' | 'branches' | 'rooms' | 'gradeSchemes' | 'feePlans' | 'roles'

const SECTION_PATHS: Readonly<Record<SettingsSection, string>> = {
  general: '/settings',
  branches: '/settings/branches',
  rooms: '/settings/rooms',
  gradeSchemes: '/settings/grade-schemes',
  feePlans: '/settings/fee-plans',
  roles: '/settings/roles',
}

/** The permission that gates a tab other than the general one (inside the page too — a direct render still answers 403). */
const SECTION_PERMISSIONS: Readonly<Partial<Record<SettingsSection, string>>> = {
  branches: MANAGE_BRANCHES_PERMISSION,
  rooms: MANAGE_SCHEDULE_PERMISSION,
  gradeSchemes: MANAGE_ACADEMY_SETTINGS_PERMISSION,
  roles: 'roles.manage',
}

/** A tab gated by its nav entry rather than one key (J-F52: the fee plans are read with fee_plans.manage OR invoices.manage). */
const SECTION_NAV_KEYS: Readonly<Partial<Record<SettingsSection, string>>> = {
  feePlans: 'feePlans',
}

export function SettingsPage({ section = 'general' }: { section?: SettingsSection }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const canManageRoles = hasPermission('roles.manage')
  const canManageBranches = hasPermission(MANAGE_BRANCHES_PERMISSION)
  const canManageRooms = hasPermission(MANAGE_SCHEDULE_PERMISSION)
  const canManageGradeSchemes = hasPermission(MANAGE_ACADEMY_SETTINGS_PERMISSION)
  const canSeeFeePlans = user ? canAccess(user, 'feePlans') : false
  // The general tab follows the gate of the /settings entry (`academy.settings.read` or `.manage` since CH-0036).
  const canSeeGeneral = user ? canAccess(user, 'settings') : false

  const tabs = [
    ...(canSeeGeneral ? [{ key: 'general', label: t('settings.tabs.general') }] : []),
    ...(canManageBranches ? [{ key: 'branches', label: t('settings.tabs.branches') }] : []),
    ...(canManageRooms ? [{ key: 'rooms', label: t('settings.tabs.rooms') }] : []),
    ...(canManageGradeSchemes ? [{ key: 'gradeSchemes', label: t('settings.tabs.gradeSchemes') }] : []),
    ...(canSeeFeePlans ? [{ key: 'feePlans', label: t('settings.tabs.feePlans') }] : []),
    ...(canManageRoles ? [{ key: 'roles', label: t('settings.tabs.roles') }] : []),
  ]

  const subtitle =
    section === 'roles'
      ? t('rolesAdmin.subtitle')
      : section === 'branches'
        ? t('branches.subtitle')
        : section === 'rooms'
          ? t('rooms.subtitle')
          : section === 'gradeSchemes'
            ? t('gradeSchemes.subtitle')
            : section === 'feePlans'
              ? t('feePlans.subtitle')
              : t('settings.subtitle')

  const content = (
    <>
      <PageHeader title={t('settings.title')} subtitle={subtitle} />
      {tabs.length > 1 ? (
        <Tabs activeKey={section} items={tabs} onChange={(key) => navigate(SECTION_PATHS[key as SettingsSection])} style={{ marginBottom: 16 }} />
      ) : null}
      {section === 'roles' ? (
        <RolesManager />
      ) : section === 'branches' ? (
        <BranchesManager />
      ) : section === 'rooms' ? (
        <RoomsManager />
      ) : section === 'gradeSchemes' ? (
        <GradeSchemesManager />
      ) : section === 'feePlans' ? (
        <FeePlansManager />
      ) : (
        <GeneralSettingsForm />
      )}
    </>
  )

  // The roles, branches, rooms and grade schemes tabs are gated by their permission inside the page too, so a direct render (and
  // the route without its guard) still answers 403 without it (D-R06; RequireAccess — T15).
  const permission = SECTION_PERMISSIONS[section]
  const navKey = SECTION_NAV_KEYS[section]
  return permission || navKey ? (
    <RequireAccess permission={permission} navKey={navKey}>
      {content}
    </RequireAccess>
  ) : (
    content
  )
}
