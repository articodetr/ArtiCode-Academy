import type { ThemeConfig } from 'antd'

/**
 * The scoped Ant Design theme of the «درس جديد» window (J-F79, Jallal's request — the look of a calendar's «new
 * event» window): taller, rounder fields and buttons, a bigger title and a rounder window. The colours stay the
 * app's (the primary colour is inherited from app/App.tsx); only sizes and corners change.
 */
export const LESSON_MODAL_THEME: ThemeConfig = {
  token: {
    borderRadius: 10,
    borderRadiusLG: 16,
    controlHeight: 46,
    fontSize: 15,
  },
  components: {
    Modal: { titleFontSize: 21 },
  },
}
