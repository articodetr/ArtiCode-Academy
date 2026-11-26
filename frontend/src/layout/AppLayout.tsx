import { BellOutlined, LeftOutlined, LogoutOutlined, MenuOutlined, ProfileOutlined, RightOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Badge, Button, ConfigProvider, Drawer, Dropdown, Layout, Menu, Typography } from 'antd'
import type { DrawerProps, MenuProps, ThemeConfig } from 'antd'
import { useContext, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { useAcademyBrand } from '../academy/useAcademyBrand'
import { useAuth } from '../auth/auth-context'
import { installMenuSpaceActivation } from '../common/menuSpaceKey'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { isLearnerOnly } from '../dashboard/learner.data'
import { TABSEET_FONT_FAMILY } from '../learn/hub/hub.theme'
import { HeaderBrand, SiderBrand } from './AcademyBrand'
import { navFor, navGroupsFor, navLabelKey } from './navigation'
import type { NavItem, NavViewer } from './navigation'
import { useIsPhone } from './useIsPhone'
import { useUnreadCount } from '../notifications/useUnreadCount'
import { GlobalSearch } from '../search/GlobalSearch'
import '../publicCatalog/publicFonts.css'
import './AppLayout.css'

const { Header, Sider, Content } = Layout

/** The side menu's width on a desktop; the icon rail keeps antd's 80 px. */
const SIDER_WIDTH = 248
/** The phone drawer's width (a 320 px screen keeps a strip of the page beside it). */
const DRAWER_WIDTH = 280

/**
 * The dark side menu (the Sider, its trigger and the Menu, on a desktop and in the phone drawer): antd's own dark
 * theme with its colours pointed at the shell's palette — the CSS custom properties on `:root` in AppLayout.css,
 * defined once there so an academy's branding can override them later. None of these tokens goes through antd's colour
 * arithmetic (menu/style, layout/style), so a `var(...)` is passed through as it is. Scoped to the side menu: the rest
 * of the app keeps the global theme (app/App.tsx).
 */
const SIDE_MENU_THEME: ThemeConfig = {
  components: {
    Layout: {
      siderBg: 'var(--ac-sider-bg)',
      triggerBg: 'var(--ac-sider-trigger-bg)',
      triggerColor: 'var(--ac-sider-text)',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkPopupBg: 'var(--ac-sider-bg)',
      darkItemColor: 'var(--ac-sider-text)',
      darkItemHoverColor: 'var(--ac-sider-text-strong)',
      darkItemHoverBg: 'var(--ac-sider-hover-bg)',
      darkItemSelectedBg: 'var(--ac-sider-selected-bg)',
      darkItemSelectedColor: 'var(--ac-sider-selected-text)',
      darkGroupTitleColor: 'var(--ac-sider-muted)',
      colorSplit: 'var(--ac-sider-border)',
      // The keyboard focus ring of the items (antd's genFocusOutline), drawn outside the item on the dark background.
      colorPrimaryBorder: 'var(--ac-focus-ring)',
      lineWidthFocus: 2,
      itemBorderRadius: 10,
      itemMarginInline: 12,
    },
  },
}

/**
 * The horizontal pill navigation bar for learner-only viewers on desktop/tablet (J-F66), matching TabseetCourse's
 * pill bar (#113464 navy active pill, #C5A052 gold active icon, self-hosted Cairo 14px/700).
 */
const LEARNER_NAV_THEME: ThemeConfig = {
  token: {
    fontFamily: TABSEET_FONT_FAMILY,
    colorPrimary: '#113464',
    borderRadius: 10,
  },
  components: {
    Menu: {
      horizontalItemBorderRadius: 10,
      horizontalItemHoverBg: '#f1f5f9',
      horizontalItemHoverColor: '#113464',
      horizontalItemSelectedBg: '#113464',
      horizontalItemSelectedColor: '#ffffff',
      horizontalLineHeight: '36px',
      itemColor: '#64748b',
      itemBg: 'transparent',
      activeBarHeight: 0,
      activeBarBorderWidth: 0,
      colorPrimaryBorder: '#c5a052',
      lineWidthFocus: 2,
    },
  },
}

type MenuItems = NonNullable<MenuProps['items']>

/**
 * The entries a learner-only viewer's menu leaves out; their pages stay reachable from their links. «explore courses»
 * since J-F66; «واجباتي», «اختباراتي» and «درجاتي» since J-F67 (Jallal's request — a lesson's exam opens from its
 * row in «دروسي»/«دوراتي», and «اختباراتي» from the exam popup).
 */
const LEARNER_MENU_HIDDEN: ReadonlySet<string> = new Set(['catalog', 'myAssignments', 'myExams', 'myGrades'])

/**
 * The side menu's entries — those of `navFor()`. A learner-only viewer (a student or a guardian and nothing
 * else) keeps a flat list in the order of NAV_ITEMS, without headings and without the entries of LEARNER_MENU_HIDDEN
 * (each page stays reachable from its links, without crowding the learner's horizontal bar — J-F66, J-F67); anyone else gets
 * the titled sections of NAV_GROUPS, or — on the icon rail, where a heading does not fit — the same order with
 * a divider between sections.
 */
function sideMenuItems(viewer: NavViewer, rail: boolean, label: (key: string) => string): MenuItems {
  const entry = (item: NavItem) => ({ key: item.path, icon: item.icon, label: label(navLabelKey(item, viewer)) })
  if (isLearnerOnly(viewer.roles)) return navFor(viewer).filter((item) => !LEARNER_MENU_HIDDEN.has(item.key)).map(entry)
  const items: MenuItems = []
  navGroupsFor(viewer).forEach((group, index) => {
    if (rail) {
      if (index > 0) items.push({ type: 'divider', key: `divider:${group.key}` })
      items.push(...group.items.map(entry))
    } else if (group.labelKey === null) {
      items.push(...group.items.map(entry))
    } else {
      items.push({ type: 'group', key: `group:${group.key}`, label: label(group.labelKey), children: group.items.map(entry) })
    }
  })
  return items
}

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
  // Below 768 px the side menu is a drawer opened from the header (useIsPhone — `false` in jsdom = a desktop).
  const phone = useIsPhone()
  const drawerId = useId()
  // The drawer is open for the page it was opened on: any navigation (an entry, the search, the bell, the browser's
  // back) closes it, and so does leaving the phone layout.
  const [drawerOpenAt, setDrawerOpenAt] = useState<string | null>(null)
  if (!phone && drawerOpenAt !== null) setDrawerOpenAt(null)
  const drawerOpen = phone && drawerOpenAt === location.key
  // antd mirrors the layout for RTL but not a drawer's placement: the drawer slides in from the inline start.
  const { direction } = useContext(ConfigProvider.ConfigContext)
  const rtl = direction === 'rtl'
  // Space picks a focused item of every menu under the layout — the side menu and every dropdown's actions — as Enter
  // does (KI-108; @rc-component/menu acts on Enter only).
  useEffect(() => installMenuSpaceActivation(), [])
  // The desktop menu scrolls inside the side menu (AppLayout.css): the current page's entry is brought into its view —
  // the menu box alone, never the page.
  const siderNav = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = siderNav.current
    const entry = nav?.querySelector('.ant-menu-item-selected')
    if (!nav || !(entry instanceof HTMLElement)) return
    const box = nav.getBoundingClientRect()
    const item = entry.getBoundingClientRect()
    if (item.top < box.top) nav.scrollTop -= box.top - item.top + 8
    else if (item.bottom > box.bottom) nav.scrollTop += item.bottom - box.bottom + 8
  }, [location.pathname, collapsed, phone])

  if (!user) return <Navigate to="/login" replace />

  // Entries by permission where the module has an API, by the role matrix elsewhere (MOD-03-T15).
  const learnerOnly = isLearnerOnly(user.roles)
  const navItems = navFor(user)
  const selected = selectedPath(
    location.pathname,
    navItems.map((item) => item.path),
  )

  /**
   * The side menu (rendered inside SIDE_MENU_THEME), on the desktop Sider (`rail` while collapsed to icons) or in the
   * phone drawer (`onPick` closes it).
   */
  const sideMenu = (rail: boolean, onPick?: () => void, ref?: RefObject<HTMLElement | null>) => (
    <nav ref={ref} className="app-nav" aria-label={t('nav.mainMenu')}>
      <Menu
        theme="dark"
        mode="inline"
        inlineIndent={16}
        items={sideMenuItems(user, rail, (key) => t(key))}
        selectedKeys={selected ? [selected] : []}
        onClick={({ key }) => {
          onPick?.()
          navigate(key)
        }}
      />
    </nav>
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

  const hasDesktopSider = !phone && !learnerOnly

  return (
    <Layout className={`app-shell${learnerOnly ? ' app-shell--learner' : ''}`} hasSider={hasDesktopSider} style={{ minHeight: '100vh', background: 'var(--ac-content-bg)' }}>
      {phone ? (
        <NavDrawer id={drawerId} open={drawerOpen} placement={rtl ? 'right' : 'left'} onClose={() => setDrawerOpenAt(null)}>
          <ConfigProvider theme={SIDE_MENU_THEME}>{sideMenu(false, () => setDrawerOpenAt(null))}</ConfigProvider>
        </NavDrawer>
      ) : hasDesktopSider ? (
        <ConfigProvider theme={SIDE_MENU_THEME}>
          {/* `app-sider`: the print rules of the reports page hide the side menu by this class (reports.css). */}
          <Sider
            className="app-sider"
            theme="dark"
            collapsible
            collapsed={collapsed}
            onCollapse={setCollapsed}
            breakpoint="lg"
            width={SIDER_WIDTH}
            // A real button inside antd's trigger bar (whose own click toggles the rail): Tab reaches it, Enter and Space
            // press it. Its arrow points where the menu moves, as antd's default trigger does in either direction.
            trigger={
              <button type="button" className="app-sider__trigger" aria-label={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')} aria-expanded={!collapsed}>
                {collapsed !== rtl ? <RightOutlined aria-hidden /> : <LeftOutlined aria-hidden />}
              </button>
            }
          >
            <SiderBrand collapsed={collapsed} />
            {sideMenu(collapsed, undefined, siderNav)}
          </Sider>
        </ConfigProvider>
      ) : null}

      <Layout>
        <div className="app-top">
          <Header className="app-header" style={{ background: 'var(--ac-card-bg)', borderBottom: '1px solid var(--ac-border)' }}>
            <div className="app-header__start">
              {phone ? (
                <Button
                  type="text"
                  className="app-header__menu-button"
                  icon={<MenuOutlined />}
                  aria-label={t('nav.openMenu')}
                  aria-expanded={drawerOpen}
                  aria-controls={drawerId}
                  onClick={() => setDrawerOpenAt(location.key)}
                />
              ) : null}
              {/* The academy's name and logo from API-035 (J-F13); no name until they arrive, the static one after a failure (J-F24). */}
              <HeaderBrand />
            </div>

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

          {!phone && learnerOnly ? (
            <ConfigProvider theme={LEARNER_NAV_THEME}>
              <nav className="app-learner-nav" aria-label={t('nav.mainMenu')}>
                <div className="app-learner-nav__bar">
                  <Menu
                    mode="horizontal"
                    disabledOverflow
                    items={sideMenuItems(user, false, (key) => t(key))}
                    selectedKeys={selected ? [selected] : []}
                    onClick={({ key }) => navigate(key)}
                  />
                </div>
              </nav>
            </ConfigProvider>
          ) : null}
        </div>

        <Content className="app-content" style={{ background: 'var(--ac-content-bg)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

interface NavDrawerProps {
  id: string
  open: boolean
  placement: NonNullable<DrawerProps['placement']>
  onClose: () => void
  children: ReactNode
}

/**
 * The side menu on a phone: a drawer from the inline start, in the menu's dark colours, headed by the academy's name
 * (none while the first read runs — the drawer is then named by its label alone). Picking an entry closes it
 * (AppLayout); antd hands the focus back to the header's menu button when it closes.
 */
function NavDrawer({ id, open, placement, onClose, children }: NavDrawerProps) {
  const { t } = useTranslation()
  const { name } = useAcademyBrand()
  return (
    <Drawer
      id={id}
      open={open}
      onClose={onClose}
      placement={placement}
      size={DRAWER_WIDTH}
      rootClassName="app-nav-drawer"
      aria-label={t('nav.mainMenu')}
      closable={{ 'aria-label': t('nav.closeMenu') }}
      title={
        name ? (
          <bdi dir="auto" className="app-nav-drawer__title" title={name}>
            {name}
          </bdi>
        ) : undefined
      }
      styles={{
        section: { background: 'var(--ac-sider-bg)', color: 'var(--ac-sider-text)' },
        header: { borderBottom: '1px solid var(--ac-sider-border)' },
        title: { color: 'var(--ac-sider-text-strong)', minWidth: 0 },
        close: { color: 'var(--ac-sider-text)' },
        body: { padding: '8px 0' },
      }}
    >
      {children}
    </Drawer>
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
