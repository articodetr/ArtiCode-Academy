import type { ThemeConfig } from 'antd'

/**
 * Self-hosted TabseetCourse typography stack (bundled in publicCatalog/publicFonts.css — no external CDN,
 * keeping deploy/Caddyfile's `default-src 'self'` CSP intact): variable Cairo (200..1000) for Arabic and
 * Poppins (400..700) for Latin/digits.
 */
export const TABSEET_FONT_FAMILY =
  "'Public Cairo', 'Public Poppins', 'Segoe UI', Tahoma, 'Noto Sans Arabic', 'Noto Sans', system-ui, sans-serif"

/** Scoped Ant Design theme for «دروسي» (hub + sessions table) and `/my-classes/:classId` (J-F66). */
export const HUB_ANTD_THEME: ThemeConfig = {
  token: {
    fontFamily: TABSEET_FONT_FAMILY,
    colorPrimary: '#113464',
    borderRadius: 10,
  },
}
