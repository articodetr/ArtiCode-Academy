import { BellOutlined, LogoutOutlined, ProfileOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Badge, Button, Dropdown, Layout, Menu, Typography, theme } from 'antd'
import type { MenuProps } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { installMenuSpaceActivation } from '../common/menuSpaceKey'
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
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userButton = useRef<HTMLButtonElement>(null)
  // Set by an Escape pressed inside the open user menu, read when it closes (changeUserMenuOpen): the menu's own keydown
  // runs before the popup's Escape listener on the window that closes it.
  const escapedUserMenu = useRef(false)
  const { token } = theme.useToken()
  // Space picks a focused item of every menu under the layout — the side menu and every dropdown's actions — as Enter
  // does (KI-108; @rc-component/menu acts on Enter only).
  useEffect(() => installMenuSpaceActivation(), [])

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

  const changeUserMenuOpen = (open: boolean, info?: { source: 'trigger' | 'menu' }) => {
    const byEscape = escapedUserMenu.current
    escapedUserMenu.current = false
    setUserMenuOpen(open)
    // A menu closed from the keyboard (Escape) or by a picked item while it holds the focus hands it back to its button
    // (KI-120): the popup's own Escape listener (@rc-component/portal) closes it synchronously and unmounts the listener
    // of @rc-component/dropdown that would do it, which left the focus on a hidden item. Never for a press outside:
    // @rc-component/trigger closes the menu on that mousedown, the focus still on an item, and the button's focus would
    // pull a scrolled page back to the header before the click lands. No scroll either way (`preventScroll`).
    if (open || !(byEscape || info?.source === 'menu')) return
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.app-user-menu')) userButton.current?.focus({ preventScroll: true })
  }

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
            {/*
              The user menu opens from a real button (KI-120): Tab reaches it and Enter or Space opens the menu (the
              button's own click), ArrowDown too. `autoFocus` (antd's own prop) puts the focus on the menu's first item
              once it is open, so the arrows, Enter and Space (common/menuSpaceKey.ts — on the items only, never on this
              button) work at once, and Escape closes it back to the button (changeUserMenuOpen); a span left the
              profile and the sign-out to the mouse.
            */}
            <Dropdown
              menu={{
                items: userMenu,
                onKeyDown: (event) => {
                  if (event.key === 'Escape') escapedUserMenu.current = true
                },
              }}
              trigger={['click']}
              open={userMenuOpen}
              onOpenChange={changeUserMenuOpen}
              autoFocus
              // Unmounted once its closing motion ends, so a menu opened again starts on its first item (an open menu
              // remembers the last item it focused).
              destroyOnHidden
              rootClassName="app-user-menu"
            >
              <button
                ref={userButton}
                type="button"
                className="app-user"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' || userMenuOpen) return
                  // No page scroll: the arrow opens the menu, as Enter and Space do.
                  event.preventDefault()
                  setUserMenuOpen(true)
                }}
              >
                {/* Decorative: the user's name alone names the button. */}
                <Avatar size="small" icon={<UserOutlined />} aria-hidden />
                {/* An isolate in the name's own direction (KI-108): a name mixing Arabic and Latin words keeps its order in either UI. */}
                <Typography.Text>
                  <bdi dir="auto">{user.name}</bdi>
                </Typography.Text>
              </button>
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
