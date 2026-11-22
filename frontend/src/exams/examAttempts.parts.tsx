// Small pieces the «attempts» tab, its attempt panel and the results sheet of
// an online exam share (MOD-09 phase 2 — OEX-T07): a number out of another
// («7.25 من 10»), the status of an attempt, where a result came from, and the
// note naming the exam's zone when it is not this device's (D-R41).
import { Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ExamAttemptStatus } from '../api/examAttempts'
import type { ExamResultSource } from '../api/examResults'
import { differsFromDevice } from '../assignments/assignments.zone'
import { ATTEMPT_STATUS_COLORS, RESULT_SOURCE_COLORS } from './examAttempts.view'

/**
 * «7.25 من 10» — a score out of the maximum, or a count out of a total, as the
 * server sent the two numbers. Each number sits in its own `<bdi dir="ltr">`
 * and the word between them stays in the text's own direction: one LTR isolate
 * around the whole phrase would reorder an Arabic line into «7.25 10 من».
 */
export function OutOf({ value, total }: { value: number; total: number }) {
  const { t } = useTranslation()
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <bdi dir="ltr">{value}</bdi> {t('examAttempts.outOf')} <bdi dir="ltr">{total}</bdi>
    </span>
  )
}

/** The status of one attempt: in progress, submitted by the student, or closed by the server at its deadline. */
export function AttemptStatusTag({ status }: { status: ExamAttemptStatus }) {
  const { t } = useTranslation()
  return <Tag color={ATTEMPT_STATUS_COLORS[status]}>{t(`examAttempts.status.${status}`)}</Tag>
}

/** Where a result came from: the student's counted attempt (`online`) or the results sheet (`manual`). */
export function ResultSourceTag({ source }: { source: ExamResultSource }) {
  const { t } = useTranslation()
  return <Tag color={RESULT_SOURCE_COLORS[source]}>{t(`examAttempts.source.${source}`)}</Tag>
}

/** Says once that the times on screen are the exam's zone, and names it — only when it is not this device's. */
export function ExamZoneNote({ zone, testId }: { zone: string; testId?: string }) {
  const { t } = useTranslation()
  if (!differsFromDevice(zone)) return null
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }} data-testid={testId}>
      {t('examAttempts.zone')} (<bdi dir="ltr">{zone}</bdi>)
    </Typography.Text>
  )
}
