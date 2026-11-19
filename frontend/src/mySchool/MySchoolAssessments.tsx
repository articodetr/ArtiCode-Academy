// «Exams and assignments» of «My School» (MOD-20): a compact view of what is
// waiting — the open assignments still waiting for their student (API-112
// `pending=true`) and the scheduled exams from now on (API-121) — each with its
// date in its own zone (D-R41), the course and, for a guardian, the student;
// the full lists, submitting and the results live on «my assignments», «my
// exams» and «my grades». Each list loads, fails and retries on its own.
import { Button, Card, Empty, Skeleton, Space, Tag } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import type { MyAssignmentItem } from '../api/myAssignments'
import type { MyExamItem } from '../api/myExams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import type { Reloadable } from '../dashboard/useLoad'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, localizedLabel } from '../users/users.format'
import { mySchoolFailureKey } from './mySchool.view'
import { SourceAlert } from './SourceAlert'
import type { FirstPage } from './useMyLearning'

const ASSIGNMENTS_PATH = '/my-assignments'
const EXAMS_PATH = '/my-exams'
const GRADES_PATH = '/my-grades'

interface ListPanelProps<T> {
  testId: string
  title: string
  path: string
  source: Reloadable<FirstPage<T>>
  errorTitle: string
  emptyText: string
  renderRow: (item: T) => ReactNode
}

function ListPanel<T>({ testId, title, path, source, errorTitle, emptyText, renderRow }: ListPanelProps<T>) {
  const { t } = useTranslation()
  let body: ReactNode
  if (source.loading) body = <Skeleton active title={false} paragraph={{ rows: 3 }} />
  else if (source.error || source.data === null) body = <SourceAlert title={errorTitle} description={t(mySchoolFailureKey(source.error))} onRetry={source.retry} />
  else if (source.data.items.length === 0) body = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
  else
    body = (
      <>
        <ul className="ms-list">{source.data.items.map(renderRow)}</ul>
        {source.data.more ? <Link to={path}>{t('mySchool.assessments.more')}</Link> : null}
      </>
    )
  return (
    <Card size="small" title={title} data-testid={testId}>
      {body}
    </Card>
  )
}

export function MySchoolAssessments({ assignments, exams }: { assignments: Reloadable<FirstPage<MyAssignmentItem>>; exams: Reloadable<FirstPage<MyExamItem>> }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()

  const studentOf = (item: { relation: 'self' | 'child'; student: { fullName: string; displayName: string | null } }) =>
    item.relation === 'child' ? ` · ${t('mySchool.card.student', { name: displayNameOf(item.student) })}` : ''

  return (
    <>
      <div className="ms-grid">
        <ListPanel
          testId="my-school-assignments"
          title={t('mySchool.assessments.assignmentsTitle')}
          path={ASSIGNMENTS_PATH}
          source={assignments}
          errorTitle={t('mySchool.assessments.assignmentsError')}
          emptyText={t('mySchool.assessments.assignmentsEmpty')}
          renderRow={(item) => (
            <li key={`${item.id}:${item.student.id}`} className="ms-list__row" data-testid={`assignment-${item.id}-${item.student.id}`}>
              <span className="ms-list__main">
                <Link to={ASSIGNMENTS_PATH}>{localizedLabel(item.title, language)}</Link>
                <span className="ms-list__meta">
                  {localizedLabel(item.class.course.name, language)}
                  {studentOf(item)}
                </span>
              </span>
              <span className="ms-list__meta">
                {item.dueAt ? t('mySchool.assessments.due', { date: formatZonedDateTime(item.dueAt, item.timeZone, language) }) : t('mySchool.assessments.noDue')}
              </span>
            </li>
          )}
        />
        <ListPanel
          testId="my-school-exams"
          title={t('mySchool.assessments.examsTitle')}
          path={EXAMS_PATH}
          source={exams}
          errorTitle={t('mySchool.assessments.examsError')}
          emptyText={t('mySchool.assessments.examsEmpty')}
          renderRow={(item) => (
            <li key={`${item.id}:${item.student.id}`} className="ms-list__row" data-testid={`exam-${item.id}-${item.student.id}`}>
              <span className="ms-list__main">
                <Space size={6} wrap>
                  <Link to={EXAMS_PATH}>{localizedLabel(item.title, language)}</Link>
                  <Tag>{t(`exams.types.${item.type}`)}</Tag>
                </Space>
                <span className="ms-list__meta">
                  {localizedLabel(item.class.course.name, language)}
                  {studentOf(item)}
                </span>
              </span>
              {item.scheduledAt ? (
                <span className="ms-list__meta">{t('mySchool.assessments.scheduledAt', { date: formatZonedDateTime(item.scheduledAt, item.timeZone, language) })}</span>
              ) : null}
            </li>
          )}
        />
      </div>
      <Space size={[8, 8]} wrap>
        <Button onClick={() => navigate(ASSIGNMENTS_PATH)}>{t('mySchool.assessments.allAssignments')}</Button>
        <Button onClick={() => navigate(EXAMS_PATH)}>{t('mySchool.assessments.allExams')}</Button>
        <Button onClick={() => navigate(GRADES_PATH)}>{t('mySchool.assessments.grades')}</Button>
      </Space>
    </>
  )
}
