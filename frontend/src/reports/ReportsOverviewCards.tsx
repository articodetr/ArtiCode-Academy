// The dashboard's numbers (J-F53, MOD-13-T06): API-164 as the server answers
// it — the general section for any report key, and one card per section the
// caller's keys open (a null section has no card: staff hold no academic key by
// seed). Every figure is the server's (D-R67: the same totals as the detailed
// reports), and each card links to the reports it summarizes.
import { BarChartOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Flex, Row, Spin, Statistic, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { OverviewAcademic, OverviewAttendance, OverviewFinancial, ReportPeriod } from '../api/reports'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { formatDay } from '../users/users.format'
import type { ReportKey } from './reports.catalog'
import { describeReportsFailure, failureMessage } from './reports.errors'
import { formatMoney, formatNumber, formatPercent } from './reports.format'
import { useReportsOverview } from './useReportsOverview'

function ReportLink({ report, children }: { report: ReportKey; children: ReactNode }) {
  return (
    <Link to={`/reports?report=${report}`}>
      <BarChartOutlined /> {children}
    </Link>
  )
}

function PeriodLine({ period }: { period: ReportPeriod }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {t('dashboard.period', { from: formatDay(period.from, language), to: formatDay(period.to, language) })}
    </Typography.Text>
  )
}

function AttendanceCard({ section }: { section: OverviewAttendance }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <Card
      title={t('dashboard.attendance.title')}
      actions={[
        <ReportLink key="classes" report="attendance-classes">
          {t('dashboard.attendance.byClass')}
        </ReportLink>,
        <ReportLink key="students" report="attendance-students">
          {t('dashboard.attendance.byStudent')}
        </ReportLink>,
      ]}
      style={{ height: '100%' }}
    >
      <Flex vertical gap={8}>
        <PeriodLine period={section.period} />
        <Statistic title={t('dashboard.attendance.rate')} value={formatPercent(section.attendanceRate, language)} />
        <Typography.Text>
          {t('dashboard.attendance.records', {
            present: formatNumber(section.records.present, language),
            late: formatNumber(section.records.late, language),
            absent: formatNumber(section.records.absent, language),
            excused: formatNumber(section.records.excused, language),
          })}
        </Typography.Text>
      </Flex>
    </Card>
  )
}

function AcademicCard({ section }: { section: OverviewAcademic }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <Card
      title={t('dashboard.academic.title')}
      actions={[
        <ReportLink key="classes" report="academic-classes">
          {t('dashboard.academic.byClass')}
        </ReportLink>,
        <ReportLink key="assignments" report="academic-assignments">
          {t('dashboard.academic.assignments')}
        </ReportLink>,
      ]}
      style={{ height: '100%' }}
    >
      <Flex vertical gap={8}>
        <PeriodLine period={section.period} />
        <Row gutter={[12, 12]}>
          <Col span={12}>
            <Statistic title={t('dashboard.academic.averagePercent')} value={formatPercent(section.averagePercent, language)} />
          </Col>
          <Col span={12}>
            <Statistic title={t('dashboard.academic.passRate')} value={formatPercent(section.passRate, language)} />
          </Col>
          <Col span={12}>
            <Statistic title={t('dashboard.academic.finalGrades')} value={formatNumber(section.finalGrades, language)} />
          </Col>
          <Col span={12}>
            <Statistic title={t('dashboard.academic.awaitingReview')} value={formatNumber(section.awaitingReview, language)} />
          </Col>
        </Row>
      </Flex>
    </Card>
  )
}

function FinancialCard({ section }: { section: OverviewFinancial }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <Card
      title={t('dashboard.financial.title')}
      actions={[
        <ReportLink key="collections" report="financial-collections">
          {t('dashboard.financial.collections')}
        </ReportLink>,
        <ReportLink key="receivables" report="financial-receivables">
          {t('dashboard.financial.receivables')}
        </ReportLink>,
      ]}
      style={{ height: '100%' }}
    >
      <Flex vertical gap={12}>
        <section aria-label={t('dashboard.financial.collected')}>
          <Typography.Text strong>{t('dashboard.financial.collected')}</Typography.Text>
          <div>
            <PeriodLine period={section.period} />
          </div>
          {section.collected.length === 0 ? (
            <Typography.Text type="secondary">{t('dashboard.financial.noCollections')}</Typography.Text>
          ) : (
            section.collected.map((line) => (
              <Flex key={line.currency} justify="space-between" gap={8} wrap>
                <Typography.Text strong>{formatMoney(line.amount, line.currency, language)}</Typography.Text>
                <Typography.Text type="secondary">{t('dashboard.financial.payments', { count: formatNumber(line.payments, language) })}</Typography.Text>
              </Flex>
            ))
          )}
        </section>
        <section aria-label={t('dashboard.financial.outstanding')}>
          <Typography.Text strong>{t('dashboard.financial.outstanding')}</Typography.Text>
          {section.outstanding.length === 0 ? (
            <div>
              <Typography.Text type="secondary">{t('dashboard.financial.noOutstanding')}</Typography.Text>
            </div>
          ) : (
            section.outstanding.map((line) => (
              <Flex key={line.currency} vertical gap={2}>
                <Typography.Text>
                  {t('dashboard.financial.balance')}: <Typography.Text strong>{formatMoney(line.balance, line.currency, language)}</Typography.Text>
                </Typography.Text>
                <Typography.Text type={line.overdue > 0 ? 'danger' : 'secondary'}>
                  {t('dashboard.financial.overdue', { amount: formatMoney(line.overdue, line.currency, language), count: formatNumber(line.studentsOverdue, language) })}
                </Typography.Text>
              </Flex>
            ))
          )}
        </section>
      </Flex>
    </Card>
  )
}

/** Mounted only for a holder of a report key: anyone else never sends API-164. */
export function ReportsOverviewCards() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { overview, loading, error, reload } = useReportsOverview()
  const failure = error ? describeReportsFailure(error) : null

  const failureAlert = failure ? (
    <Alert
      type="error"
      showIcon
      title={failureMessage(t, failure)}
      action={
        <Button size="small" onClick={reload} loading={loading}>
          {t('dashboard.retry')}
        </Button>
      }
    />
  ) : null

  if (!overview) {
    return (
      failureAlert ?? (
        <Flex justify="center" style={{ padding: 32 }}>
          <Spin />
        </Flex>
      )
    )
  }

  const { general } = overview
  const tiles = [
    { key: 'activeStudents', value: general.activeStudents },
    { key: 'openClasses', value: general.openClasses },
    { key: 'runningClasses', value: general.runningClasses },
    { key: 'lessonsToday', value: general.lessonsToday },
  ]

  return (
    <Flex vertical gap={16}>
      {failureAlert}
      <Row gutter={[16, 16]}>
        {tiles.map((tile) => (
          <Col key={tile.key} xs={24} sm={12} xl={6}>
            <Card>
              <Statistic title={t(`dashboard.general.${tile.key}`)} value={formatNumber(tile.value, language)} />
            </Card>
          </Col>
        ))}
      </Row>
      {overview.attendance || overview.academic || overview.financial ? (
        <Row gutter={[16, 16]}>
          {overview.attendance ? (
            <Col xs={24} lg={8}>
              <AttendanceCard section={overview.attendance} />
            </Col>
          ) : null}
          {overview.academic ? (
            <Col xs={24} lg={8}>
              <AcademicCard section={overview.academic} />
            </Col>
          ) : null}
          {overview.financial ? (
            <Col xs={24} lg={8}>
              <FinancialCard section={overview.financial} />
            </Col>
          ) : null}
        </Row>
      ) : null}
      <Typography.Text type="secondary" data-testid="overview-as-of">
        {t('dashboard.asOf', {
          date: formatDay(overview.asOf, language),
          zone: overview.timeZone,
          time: formatLessonDateTime(overview.generatedAt, language, overview.timeZone),
        })}
      </Typography.Text>
    </Flex>
  )
}
