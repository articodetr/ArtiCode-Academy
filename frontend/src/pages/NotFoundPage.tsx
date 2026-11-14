import { useTranslation } from 'react-i18next'
import { StatusPage } from '../components/StatusPage'

export function NotFoundPage() {
  const { t } = useTranslation()
  return <StatusPage code="404" message={t('errors.notFound')} />
}
