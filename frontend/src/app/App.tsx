import { App as AntdApp, ConfigProvider } from 'antd'
import arEG from 'antd/locale/ar_EG'
import enUS from 'antd/locale/en_US'
import { useTranslation } from 'react-i18next'
import { AuthProvider } from '../auth/AuthProvider'
import { DEFAULT_LANGUAGE, directionOf, isLanguage } from '../i18n/language'
import { AppRouter } from './router'

const FONT_FAMILY =
  "'Segoe UI', Tahoma, 'Noto Sans Arabic', 'Noto Sans', system-ui, sans-serif"

export default function App() {
  const { i18n } = useTranslation()
  const language = isLanguage(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : DEFAULT_LANGUAGE

  return (
    <ConfigProvider
      direction={directionOf(language)}
      locale={language === 'ar' ? arEG : enUS}
      theme={{
        token: {
          colorPrimary: '#0f6cbd',
          borderRadius: 8,
          fontFamily: FONT_FAMILY,
        },
      }}
    >
      <AntdApp>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </AntdApp>
    </ConfigProvider>
  )
}
