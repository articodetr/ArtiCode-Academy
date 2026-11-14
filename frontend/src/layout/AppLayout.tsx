import { LogoutOutlined, MenuOutlined, ProfileOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Button, Drawer, Dropdown, Layout, Menu, Tag, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { directionOf, isLanguage } from '../i18n/language'
import { HeaderBrand, SiderAcademyName } from './AcademyBrand'
import { NAV_GROUPS, navFor } from './navigation'
import type { NavItem } from './navigation'
import { useIsPhone } from './useIsPhone'
import './AppLayout.css'

const { Header, Sider, Content } = Layout

function selectedPath(pathname: string, paths: string[]): string | undefined {
  if (pathname === '/') return '/'
  return paths
    .filter((path) => path !== '/' && pathname.startsWith(path))
    .sort((a, b) => b.length - a.length)[0]
}

/** The entries the viewer sees, as side-menu sections in NAV_GROUPS order; a section with no entry is left out. */
function groupedMenu(items: NavItem[], t: (key: string) => string): MenuProps['items'] {
  return NAV_GROUPS.flatMap((group) => {
    const children = items
      .filter((item) => item.group === group)
      .map((item) => ({ key: item.path, icon: item.icon, label: t(item.labelKey) }))
    return children.length ? [{ type: 'group' as const, key: `group:${group}`, label: t(`nav.groups.${group}`), children }] : []
  })
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

  // Entries by permission where the module has an API, by the role matrix elsewhere (MOD-03-T15).
  const navItems = navFor(user)
  const selected = selectedPath(
    location.pathname,
    navItems.map((item) => item.path),
  )
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'ar'

  const menu = (
    <Menu
      className="app-menu"
      mode="inline"
      theme="dark"
      items={groupedMenu(navItems, t)}
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
            <Tag className="app-header__demo">{t('common.demoMode')}</Tag>
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
