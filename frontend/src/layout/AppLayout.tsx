import { BellOutlined, LogoutOutlined, MenuOutlined, ProfileOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Badge, Button, Drawer, Dropdown, Layout, Menu, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { createElement, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { directionOf, isLanguage } from '../i18n/language'
import { HeaderBrand, SiderAcademyName } from './AcademyBrand'
import { isLearnerOnly } from '../dashboard/learner.data'
import { NAV_GROUPS, navFor } from './navigation'
import type { NavItem } from './navigation'
import { useUnreadCount } from '../notifications/useUnreadCount'
import { useIsPhone } from './useIsPhone'
import './AppLayout.css'

const { Header, Sider, Content } = Layout

function selectedPath(pathname: string, paths: string[]): string | undefined {
  if (pathname === '/') return '/'
  return paths
    .filter((path) => path !== '/' && pathname.startsWith(path))
    .sort((a, b) => b.length - a.length)[0]
}

/**
 * The entries the viewer sees, as side-menu sections in NAV_GROUPS order; a section with no entry is left out. For a
 * student or guardian the «teaching» section is headed «my studies» — the same entries, seen from the other side.
 */
function groupedMenu(items: NavItem[], t: (key: string) => string, learner: boolean): MenuProps['items'] {
  return NAV_GROUPS.flatMap((group) => {
    const children = items
      .filter((item) => item.group === group)
      .map((item) => ({ key: item.path, icon: item.icon, label: t(item.labelKey) }))
    return children.length ? [{ type: 'group' as const, key: `group:${group}`, label: t(`nav.groups.${learner && group === 'teaching' ? 'study' : group}`), children }] : []
  })
}

const SETTINGS_ENTRY_KEY = 'settings'

/** Folds the /settings/* entries into one «settings» entry at the place of the first of them. */
function withOneSettingsEntry(items: NavItem[]): NavItem[] {
  const settings = items.filter((item) => item.path === '/settings' || item.path.startsWith('/settings/'))
  if (settings.length <= 1) return items
  const first = settings[0]!
  const merged = { ...first, key: SETTINGS_ENTRY_KEY, labelKey: 'nav.settings', icon: createElement(SettingOutlined) } as NavItem
  return items.flatMap((item) => (item === first ? [merged] : settings.includes(item) ? [] : [item]))
}

/** The product mark and the academy's name at the top of the side menu (and of the phone drawer). */
function SiderBrand({ compact }: { compact: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={compact ? 'app-brand app-brand--compact' : 'app-brand'}>
      <span className="app-brand__mark" aria-hidden="true" />
      {compact ? null : (
        <span className="app-brand__text">
          <span className="app-brand__title">{t('common.appName')}</span>
          <SiderAcademyName />
        </span>
      )}
    </div>
  )
}

export function AppLayout() {
  const { t, i18n } = useTranslation()
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const isPhone = useIsPhone()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (!user) return <Navigate to="/login" replace />

  // Entries by permission where the module has an API, by the role matrix elsewhere (MOD-03-T15). The settings
  // pages (general, branches, rooms, grade schemes, roles) are tabs of one screen, so the menu shows them as one
  // entry (redesign) — it opens the first tab the viewer may use and stays selected on every /settings path.
  const navItems = withOneSettingsEntry(navFor(user))
  const settingsEntry = navItems.find((item) => item.key === SETTINGS_ENTRY_KEY)
  const selected =
    settingsEntry && location.pathname.startsWith('/settings')
      ? settingsEntry.path
      : selectedPath(
          location.pathname,
          navItems.map((item) => item.path),
        )
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'ar'

  const menu = (
    <Menu
      className="app-menu"
      mode="inline"
      theme="dark"
      items={groupedMenu(navItems, t, isLearnerOnly(user.roles))}
      selectedKeys={selected ? [selected] : []}
      onClick={({ key }) => {
        // Choosing an entry also closes the phone menu.
        setDrawerOpen(false)
        navigate(key)
      }}
    />
  )

  const userMenu: MenuProps['items'] = [
    { key: 'role', label: user.role ? t(`roles.${user.role}`) : t('profile.noRoles'), disabled: true },
    { type: 'divider' },
    {
      key: 'profile',
      icon: <ProfileOutlined />,
      label: t('common.profile'),
      onClick: () => navigate('/profile'),
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('common.logout'),
      onClick: () => {
        void logout().finally(() => navigate('/login', { replace: true }))
      },
    },
  ]

  return (
    <Layout className="app-shell">
      {isPhone ? (
        <Drawer
          className="app-drawer"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          placement={directionOf(language) === 'rtl' ? 'right' : 'left'}
          size={272}
          closable={false}
          styles={{ body: { padding: 0 } }}
        >
          <SiderBrand compact={false} />
          {menu}
        </Drawer>
      ) : (
        <Sider
          className="app-sider"
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={248}
          collapsedWidth={72}
        >
          <SiderBrand compact={collapsed} />
          {menu}
        </Sider>
      )}

      <Layout>
        <Header className="app-header">
          <div className="app-header__start">
            {isPhone ? (
              <Button
                type="text"
                className="app-header__menu"
                icon={<MenuOutlined />}
                aria-label={t('nav.openMenu')}
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              />
            ) : null}
            {/* The academy's name and logo from API-035 (J-F13); no name until they arrive, the static one after a failure (J-F24). */}
            <HeaderBrand />
          </div>

          <div className="app-header__actions">
            <NotificationBell />
            <LanguageSwitcher />
            <Dropdown menu={{ items: userMenu }} trigger={['click']}>
              <span className="app-user">
                <Avatar size="small" icon={<UserOutlined />} />
                <Typography.Text className="app-user__name">{user.name}</Typography.Text>
              </span>
            </Dropdown>
          </div>
        </Header>

        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

/** The bell in the header (redesign, 2026-11-14): the unread count of «my notifications» (API-168, polled every 60 s). */
function NotificationBell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { unread } = useUnreadCount()
  const count = unread ?? 0
  return (
    <Badge count={count} size="small" overflowCount={99} color="var(--c-mark)" className="app-bell">
      <Button
        type="text"
        shape="circle"
        icon={<BellOutlined />}
        aria-label={count > 0 ? t('nav.unreadNotifications', { count }) : t('nav.notifications')}
        onClick={() => navigate('/notifications')}
      />
    </Badge>
  )
}
