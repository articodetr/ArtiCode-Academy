// A finance status (invoice, payment state, receipt) in the tones of the shared
// StatusTag: the finance values have their own words under `payments.status.*`.
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import '../components/StatusTag.css'
import { financeToneOf } from './payments.format'

export function FinanceTag({ value }: { value: string }) {
  const { t } = useTranslation()
  return <Tag className={`status-tag status-tag--${financeToneOf(value)}`}>{t(`payments.status.${value}`)}</Tag>
}
