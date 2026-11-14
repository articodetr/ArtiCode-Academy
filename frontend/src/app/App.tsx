import { App as AntdApp, ConfigProvider } from 'antd'
import arEG from 'antd/locale/ar_EG'
import enUS from 'antd/locale/en_US'
import { useTranslation } from 'react-i18next'
import { AuthProvider } from '../auth/AuthProvider'
import { DEFAULT_LANGUAGE, directionOf, isLanguage } from '../i18n/language'
import { appTheme } from '../theme/tokens'
import { AppRouter } from './router'

export default function App() {
  const { i18n } = useTranslation()
  const language = isLanguage(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : DEFAULT_LANGUAGE

  return (
    <ConfigProvider
      direction={directionOf(language)}
      locale={language === 'ar' ? arEG : enUS}
      theme={appTheme}
    >
      <AntdApp>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </AntdApp>
    </ConfigProvider>
  )
}
