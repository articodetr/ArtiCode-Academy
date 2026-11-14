import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import './StatusTag.css'

/**
 * The tone of each value of the shared `labels.*` vocabulary (redesign, 2026-11-14): five tones of the
 * Classroom palette instead of antd's rainbow — `ok` done or healthy, `live` running or in effect, `attention`
 * (chalk yellow) waits for someone, `bad` refused or late, `neutral` everything at rest. A value missing here is
 * neutral.
 */
export type StatusTone = 'ok' | 'live' | 'attention' | 'bad' | 'neutral'

const TONES: Record<string, StatusTone> = {
  active: 'ok',
  inactive: 'neutral',
  pending: 'attention',
  invited: 'live',
  suspended: 'bad',
  published: 'ok',
  draft: 'neutral',
  archived: 'neutral',
  scheduled: 'live',
  completed: 'ok',
  cancelled: 'bad',
  open: 'live',
  // MOD-05 class statuses (J-F01); open/completed/cancelled above
  planned: 'neutral',
  running: 'live',
  // MOD-05 enrollment status (J-F04); active/completed/cancelled/pending above
  withdrawn: 'attention',
  closed: 'neutral',
  grading: 'attention',
  graded: 'ok',
  in_progress: 'live',
  paid: 'ok',
  overdue: 'bad',
  live: 'live',
  recorded: 'neutral',
  // MOD-06 delivery modes (J-F09); recorded above
  in_person: 'neutral',
  live_online: 'live',
  hybrid: 'neutral',
  inApp: 'neutral',
  email: 'neutral',
  sms: 'neutral',
  academic: 'neutral',
  financial: 'neutral',
  attendance: 'neutral',
}

function toneOf(value: string): StatusTone {
  return TONES[value] ?? 'neutral'
}

export function StatusTag({ value }: { value: string }) {
  const { t } = useTranslation()
  return <Tag className={`status-tag status-tag--${toneOf(value)}`}>{t(`labels.${value}`)}</Tag>
}
