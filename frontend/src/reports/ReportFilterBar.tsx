// The filters of the shown report (J-F53, MOD-13-T06): only the ones its query
// DTO accepts (reports.catalog.ts), applied as they change. The period is two
// calendar days in the academy's zone (D-R69) — empty means the server's last
// 30 days; a period the server would refuse (the first day after the last, or
// more than 366 days — reports.period.ts mirrors resolvePeriod()) is said under
// the fields and sends nothing, as is a threshold of the absences report that
// its DTO would refuse. The course and class pickers read API-042 / API-050, so
// they are offered to a holder of `courses.read` / `classes.read` only (the
// report itself needs neither); a new course clears the class.
import { ClearOutlined } from '@ant-design/icons'
import { Button, Checkbox, Flex, InputNumber, Select, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CLASS_STATUSES } from '../api/classes'
import { EXAM_TYPES } from '../api/exams'
import { REPORT_ASSIGNMENT_STATUSES, REPORT_MAX_PERIOD_DAYS, REPORT_PAYMENT_METHODS } from '../api/reports'
import { CoursePicker } from '../classes/ClassPickers'
import { useLocalized } from '../i18n/useLocalized'
import { dateFilterValue } from '../lessons/lessons.format'
import { ReportClassPicker } from './ReportPickers'
import { EMPTY_REPORT_FILTERS, hasActiveFilters } from './reports.catalog'
import type { ReportDefinition, ReportFilterName, ReportFilters } from './reports.catalog'
import type { ReportFilterIssues } from './reports.period'
import { refLabel } from './reports.sections'

interface ReportFilterBarProps {
  report: ReportDefinition
  filters: ReportFilters
  issues: ReportFilterIssues
  onChange: (next: ReportFilters) => void
  /** API-042 needs `courses.read`. */
  canPickCourse: boolean
  /** API-050 needs `classes.read`. */
  canPickClass: boolean
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex vertical gap={4} className="report-filter">
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      {children}
    </Flex>
  )
}

export function ReportFilterBar({ report, filters, issues, onChange, canPickCourse, canPickClass }: ReportFilterBarProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const shows = (name: ReportFilterName) => report.filters.includes(name)
  const patch = (next: Partial<ReportFilters>) => onChange({ ...filters, ...next })
  const label = (key: string) => t(`reports.filters.${key}`)

  return (
    <div className="report-filters report-no-print">
      <Flex gap={12} wrap align="flex-end">
        {shows('period') ? (
          <>
            <FilterField label={label('from')}>
              <input
                type="date"
                className="ant-input"
                aria-label={label('from')}
                aria-invalid={issues.period ? true : undefined}
                value={filters.from ?? ''}
                onChange={(event) => patch({ from: dateFilterValue(event.target.value) })}
                style={{ width: 170 }}
              />
            </FilterField>
            <FilterField label={label('to')}>
              <input
                type="date"
                className="ant-input"
                aria-label={label('to')}
                aria-invalid={issues.period ? true : undefined}
                value={filters.to ?? ''}
                onChange={(event) => patch({ to: dateFilterValue(event.target.value) })}
                style={{ width: 170 }}
              />
            </FilterField>
          </>
        ) : null}
        {shows('method') ? (
          <FilterField label={label('method')}>
            <Select
              aria-label={label('method')}
              allowClear
              placeholder={label('any')}
              value={filters.method}
              onChange={(method) => patch({ method })}
              options={REPORT_PAYMENT_METHODS.map((method) => ({ value: method, label: t(`reports.methods.${method}`) }))}
              style={{ minWidth: 160 }}
            />
          </FilterField>
        ) : null}
        {shows('course') && canPickCourse ? (
          <FilterField label={label('course')}>
            <CoursePicker
              aria-label={label('course')}
              allowClear
              placeholder={label('anyCourse')}
              value={filters.courseId}
              onChange={(courseId, course) =>
                patch({ courseId, courseLabel: course ? refLabel(course, language) : undefined, classId: undefined, classLabel: undefined })
              }
              style={{ minWidth: 220 }}
            />
          </FilterField>
        ) : null}
        {shows('class') && canPickClass ? (
          <FilterField label={label('class')}>
            <ReportClassPicker
              aria-label={label('class')}
              placeholder={label('anyClass')}
              courseId={filters.courseId}
              value={filters.classId}
              onChange={(classId, cls) => patch({ classId, classLabel: cls ? refLabel(cls, language) : undefined })}
              style={{ minWidth: 220 }}
            />
          </FilterField>
        ) : null}
        {shows('classStatus') ? (
          <FilterField label={label('classStatus')}>
            <Select
              aria-label={label('classStatus')}
              allowClear
              placeholder={label('any')}
              value={filters.classStatus}
              onChange={(classStatus) => patch({ classStatus })}
              options={CLASS_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
              style={{ minWidth: 150 }}
            />
          </FilterField>
        ) : null}
        {shows('minAbsences') ? (
          <FilterField label={label('minAbsences')}>
            <InputNumber<number>
              aria-label={label('minAbsences')}
              aria-invalid={issues.minAbsences ? true : undefined}
              status={issues.minAbsences ? 'error' : undefined}
              min={1}
              step={1}
              value={filters.minAbsences ?? null}
              onChange={(value) => patch({ minAbsences: value ?? undefined })}
              style={{ width: 150 }}
            />
          </FilterField>
        ) : null}
        {shows('minAbsenceRate') ? (
          <FilterField label={label('minAbsenceRate')}>
            <InputNumber<number>
              aria-label={label('minAbsenceRate')}
              aria-invalid={issues.minAbsenceRate ? true : undefined}
              status={issues.minAbsenceRate ? 'error' : undefined}
              min={0}
              max={100}
              step={1}
              value={filters.minAbsenceRate ?? null}
              onChange={(value) => patch({ minAbsenceRate: value ?? undefined })}
              style={{ width: 150 }}
            />
          </FilterField>
        ) : null}
        {shows('assignmentStatus') ? (
          <FilterField label={label('assignmentStatus')}>
            <Select
              aria-label={label('assignmentStatus')}
              allowClear
              placeholder={label('any')}
              value={filters.assignmentStatus}
              onChange={(assignmentStatus) => patch({ assignmentStatus })}
              options={REPORT_ASSIGNMENT_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
              style={{ minWidth: 150 }}
            />
          </FilterField>
        ) : null}
        {shows('examType') ? (
          <FilterField label={label('examType')}>
            <Select
              aria-label={label('examType')}
              allowClear
              placeholder={label('any')}
              value={filters.examType}
              onChange={(examType) => patch({ examType })}
              options={EXAM_TYPES.map((type) => ({ value: type, label: t(`exams.types.${type}`) }))}
              style={{ minWidth: 160 }}
            />
          </FilterField>
        ) : null}
        {shows('overdueOnly') ? (
          <Checkbox checked={filters.overdueOnly === true} onChange={(event) => patch({ overdueOnly: event.target.checked ? true : undefined })}>
            {label('overdueOnly')}
          </Checkbox>
        ) : null}
        {hasActiveFilters(report, filters) ? (
          <Button icon={<ClearOutlined />} onClick={() => onChange(EMPTY_REPORT_FILTERS)}>
            {label('reset')}
          </Button>
        ) : null}
      </Flex>
      {shows('period') ? (
        <Typography.Paragraph type={issues.period ? 'danger' : 'secondary'} role={issues.period ? 'alert' : undefined} style={{ margin: '8px 0 0', fontSize: 12 }}>
          {issues.period
            ? t(`reports.validation.period.${issues.period}`, { maxDays: REPORT_MAX_PERIOD_DAYS })
            : t('reports.filters.periodHint', { maxDays: REPORT_MAX_PERIOD_DAYS })}
        </Typography.Paragraph>
      ) : null}
      {issues.minAbsences ? (
        <Typography.Paragraph type="danger" role="alert" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {t('reports.validation.minAbsences')}
        </Typography.Paragraph>
      ) : null}
      {issues.minAbsenceRate ? (
        <Typography.Paragraph type="danger" role="alert" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {t('reports.validation.minAbsenceRate')}
        </Typography.Paragraph>
      ) : null}
    </div>
  )
}
