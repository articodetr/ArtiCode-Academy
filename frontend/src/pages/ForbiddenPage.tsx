import { useTranslation } from 'react-i18next'
import { StatusPage } from '../components/StatusPage'

export function ForbiddenPage() {
  const { t } = useTranslation()
  return <StatusPage code="403" message={t('errors.forbidden')} />
}
