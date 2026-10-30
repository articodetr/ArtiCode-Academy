import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'

// Colors for the shared `labels.*` vocabulary in the translation files.
const COLORS: Record<string, string> = {
  active: 'green',
  inactive: 'default',
  pending: 'gold',
  invited: 'blue',
  suspended: 'red',
  published: 'green',
  draft: 'default',
  archived: 'default',
  scheduled: 'blue',
  completed: 'green',
  cancelled: 'red',
  open: 'blue',
  closed: 'default',
  grading: 'gold',
  graded: 'green',
  in_progress: 'processing',
  paid: 'green',
  overdue: 'red',
  live: 'magenta',
  recorded: 'purple',
  inApp: 'blue',
  email: 'cyan',
  sms: 'geekblue',
  academic: 'blue',
  financial: 'gold',
  attendance: 'green',
}

export function StatusTag({ value }: { value: string }) {
  const { t } = useTranslation()
  return <Tag color={COLORS[value] ?? 'default'}>{t(`labels.${value}`)}</Tag>
}
