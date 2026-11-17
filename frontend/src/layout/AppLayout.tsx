import { BellOutlined, LogoutOutlined, ProfileOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Badge, Button, Dropdown, Layout, Menu, Typography, theme } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { HeaderBrand, SiderAcademyName } from './AcademyBrand'
import { navFor } from './navigation'
import { useUnreadCount } from '../notifications/useUnreadCount'
import { GlobalSearch } from '../search/GlobalSearch'
import './AppLayout.css'

const { Header, Sider, Content } = Layout

function selectedPath(pathname: string, paths: string[]): string | undefined {
  if (pathname === '/') return '/'
  return paths
    .filter((path) => path !== '/' && pathname.startsWith(path))
    .sort((a, b) => b.length - a.length)[0]
}

export function AppLayout() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const { token } = theme.useToken()

  if (!user) return <Navigate to="/login" replace />

  // Entries by permission where the module has an API, by the role matrix elsewhere (MOD-03-T15).
  const navItems = navFor(user)
  const menuItems: MenuProps['items'] = navItems.map((item) => ({
    key: item.path,
    icon: item.icon,
    label: t(item.labelKey),
  }))
  const selected = selectedPath(
    location.pathname,
    navItems.map((item) => item.path),
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
    <Layout style={{ minHeight: '100vh' }}>
      {/* `app-sider`: the print rules of the reports page hide the side menu by this class (reports.css). */}
      <Sider
        className="app-sider"
        theme="light"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        width={240}
        style={{ borderInlineEnd: `1px solid ${token.colorBorderSecondary}` }}
      >
        <div
          className="app-brand"
          style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
        >
          <span className="app-brand__title" style={{ color: token.colorPrimary }}>
            {collapsed ? 'AC' : t('common.appName')}
          </span>
          {collapsed ? null : <SiderAcademyName />}
        </div>
        <Menu
          mode="inline"
          items={menuItems}
          selectedKeys={selected ? [selected] : []}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 0 }}
        />
      </Sider>

      <Layout>
        <Header
          className="app-header"
          style={{
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {/* The academy's name and logo from API-035 (J-F13); no name until they arrive, the static one after a failure (J-F24). */}
          <HeaderBrand />

          <div className="app-header__actions">
            {/* The global search (Ctrl/Cmd+K or «/») and the unread bell — ported from the redesign branch. */}
            <GlobalSearch />
            <NotificationBell />
            <LanguageSwitcher />
            <Dropdown menu={{ items: userMenu }} trigger={['click']}>
              <span className="app-user">
                <Avatar size="small" icon={<UserOutlined />} />
                <Typography.Text>{user.name}</Typography.Text>
              </span>
            </Dropdown>
          </div>
        </Header>

        <Content className="app-content" style={{ background: token.colorBgLayout }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

/** The unread notifications (API-168, every 60 s while visible) — a click opens the notifications page. */
function NotificationBell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { unread } = useUnreadCount()
  const count = unread ?? 0
  return (
    <Badge count={count} size="small" overflowCount={99}>
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
