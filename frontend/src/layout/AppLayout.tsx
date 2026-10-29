import { LogoutOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Dropdown, Layout, Menu, Tag, Typography, theme } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { RoleSwitcher } from '../components/RoleSwitcher'
import { navForRole } from './navigation'
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

  const navItems = navForRole(user.role)
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
    { key: 'role', label: t(`roles.${user.role}`), disabled: true },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('common.logout'),
      onClick: () => {
        logout()
        navigate('/login')
      },
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
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
          {collapsed ? null : (
            <span className="app-brand__sub">{t('common.academyName')}</span>
          )}
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
          <Typography.Text strong className="app-header__title">
            {t('common.academyName')}
          </Typography.Text>

          <div className="app-header__actions">
            <Tag color="gold" style={{ margin: 0 }}>
              {t('common.demoMode')}
            </Tag>
            <RoleSwitcher />
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
