// A finance status (invoice, payment state, receipt) as an antd tag in its preset colour: the finance values
// have their own words under `payments.status.*`.
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { StatusTone } from './payments.format'
import { financeToneOf } from './payments.format'

const COLORS: Record<StatusTone, string> = { ok: 'green', live: 'blue', attention: 'gold', bad: 'red', neutral: 'default' }

export function FinanceTag({ value }: { value: string }) {
  const { t } = useTranslation()
  return <Tag color={COLORS[financeToneOf(value)]}>{t(`payments.status.${value}`)}</Tag>
}
