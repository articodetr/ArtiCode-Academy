// The design tokens of the "Classroom" direction (redesign, 2026-11-14): navy for the frame and the main
// actions, chalk yellow only for what needs the user's attention, a cool grey page. Every colour used by a
// screen comes from here — through the antd theme (theme.ts) or the CSS variables of index.css, which
// repeat these values; keep the two in sync.
import type { ThemeConfig } from 'antd'

export const colors = {
  /** The navy of the side menu, primary buttons, links and selected states. */
  ink: '#16305c',
  inkHover: '#21427a',
  inkActive: '#0f2447',
  /** A pale navy for selected rows, lesson blocks and neutral tags. */
  inkSoft: '#e6ecf6',
  /** Text on the navy menu. */
  sideText: '#d8e1f0',
  sideMuted: '#93a6c6',
  /** Chalk yellow: only for things that need the user (attention counts, unrecorded attendance…). */
  mark: '#e9b949',
  markSoft: '#fbf0d3',
  markText: '#7a5a0b',
  paper: '#f4f6f9',
  surface: '#ffffff',
  line: '#dde3ec',
  text: '#1b2433',
  muted: '#5d6779',
  /** The red "now" line of the timelines and real errors. */
  now: '#c2412d',
  ok: '#2f7d5b',
  okSoft: '#e3f2ea',
  bad: '#b4432f',
  badSoft: '#f8e4df',
} as const

/** One family for both scripts: IBM Plex Sans Arabic carries Latin glyphs too, served by the app (@fontsource). */
export const FONT_FAMILY =
  "'IBM Plex Sans Arabic', 'IBM Plex Sans', 'Noto Sans Arabic', system-ui, sans-serif"

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: colors.ink,
    colorInfo: colors.ink,
    colorLink: colors.ink,
    colorLinkHover: colors.inkHover,
    colorSuccess: colors.ok,
    colorWarning: '#c9971f',
    colorError: colors.bad,
    colorText: colors.text,
    colorTextSecondary: colors.muted,
    colorTextTertiary: '#7c8597',
    colorBorder: '#cdd5e1',
    colorBorderSecondary: colors.line,
    colorBgLayout: colors.paper,
    colorBgContainer: colors.surface,
    borderRadius: 8,
    borderRadiusLG: 12,
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    // A hairline shadow instead of antd's default blur: cards are told apart by their border.
    boxShadowTertiary: '0 1px 2px rgba(22, 48, 92, 0.05)',
  },
  components: {
    Layout: { siderBg: colors.ink, headerBg: colors.surface, bodyBg: colors.paper, headerHeight: 64, headerPadding: '0 28px' },
    Menu: {
      darkItemBg: colors.ink,
      darkSubMenuItemBg: colors.ink,
      darkItemColor: colors.sideText,
      darkItemHoverBg: 'rgba(255, 255, 255, 0.07)',
      darkItemHoverColor: '#ffffff',
      darkItemSelectedBg: 'rgba(255, 255, 255, 0.12)',
      darkItemSelectedColor: '#ffffff',
      darkGroupTitleColor: colors.sideMuted,
      itemHeight: 38,
      itemBorderRadius: 6,
      itemMarginInline: 10,
      groupTitleFontSize: 12,
    },
    Card: { headerFontSize: 16 },
    Table: { headerBg: '#fafbfd', headerColor: colors.muted, headerSplitColor: 'transparent', rowSelectedBg: colors.inkSoft, rowSelectedHoverBg: '#dbe4f2' },
    Tabs: { itemColor: colors.muted, itemSelectedColor: colors.ink, inkBarColor: colors.ink },
    Tag: { defaultBg: colors.inkSoft, defaultColor: colors.ink },
    Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
  },
}
