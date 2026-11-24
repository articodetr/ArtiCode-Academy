// «My classes» (MOD-05 — J-F04): GET /api/me/classes (API-060) for a student
// (their own enrollments, `relation: self`) and a guardian (the enrollments of
// the students linked to them, `relation: child`, while they hold the
// `guardian` role — the server decides). Ownership, no permission key: the
// page shows exactly what the server returns — the class, its course and its
// lead teacher by name — and never contact fields, rosters or other students.
// `active` and `completed` enrollments by default; the status filter asks the
// server for one status (withdrawn or cancelled ones included).
// Since J-F61 (CH-0237) it is also the learner's way into their courses, in place of «مدرستي»: each row carries the
// progress and the action of API-229 (joined on the enrollment id; a failed read never hides the classes), and a
// student has a second tab, «طلبات الاشتراك» (API-222/223), kept in the URL as `?section=requests`.
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Badge, Button, Card, Flex, Select, Skeleton, Space, Table, Tabs, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { ENROLLMENT_STATUSES } from '../api/enrollments'
import type { EnrollmentStatus, MyClassItem } from '../api/enrollments'
import type { MyLearningCourse } from '../api/learning'
import { useAuth } from '../auth/auth-context'
import { useMyRequests } from '../catalog/useMyRequests'
import { describeClassesFailure, failureMessage } from '../classes/classes.errors'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { ClassLearnButton, ClassLearningProgress } from '../enrollments/MyClassLearning'
import { MyEnrollmentRequests } from '../enrollments/MyEnrollmentRequests'
import { useMyClasses } from '../enrollments/useMyClasses'
import { useLocalized } from '../i18n/useLocalized'
import { classLessonsPath, hasClassLessons } from '../lessons/myLessons.view'
import { SECTION_PARAM, isPendingRequest, mySchoolFailureKey } from '../mySchool/mySchool.view'
import { SourceAlert } from '../mySchool/SourceAlert'
import { useIsPhone, useMyLearning } from '../mySchool/useMyLearning'
import { displayNameOf, formatDateTime, formatDay, localizedLabel } from '../users/users.format'

const DASH = '—'
const REQUESTS_SECTION = 'requests'
const CLASSES_SECTION = 'classes'

export function MyClassesPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const my = useMyClasses()
  const learning = useMyLearning()
  const phone = useIsPhone()
  // Only a student has requests of their own: API-222 would answer a guardian an empty list.
  const isStudent = user?.roles.includes('student') ?? false
  const requests = useMyRequests(isStudent)
  const section = isStudent && params.get(SECTION_PARAM) === REQUESTS_SECTION ? REQUESTS_SECTION : CLASSES_SECTION
  const learningOf = new Map((learning.data ?? []).map((item) => [item.enrollmentId, item]))
  // The student column matters only to a guardian (or whenever the server returned a child's enrollment).
  const showStudent = (user?.roles.includes('guardian') ?? false) || my.items.some((item) => item.relation === 'child')

  const chooseSection = (next: string) => {
    const nextParams = new URLSearchParams(params)
    if (next === REQUESTS_SECTION) nextParams.set(SECTION_PARAM, REQUESTS_SECTION)
    else nextParams.delete(SECTION_PARAM)
    setParams(nextParams, { replace: true })
  }

  const reloadClasses = () => {
    my.reload()
    learning.retry()
  }

  /** A row's API-229 cell: the answer, a placeholder while it is on its way, a dash for an enrollment it does not list. */
  const learningCell = (row: MyClassItem, render: (item: MyLearningCourse) => ReactNode, empty: ReactNode) => {
    const item = learningOf.get(row.enrollmentId)
    if (item) return render(item)
    return learning.loading ? <Skeleton.Input active size="small" style={{ width: 96, minWidth: 96 }} /> : empty
  }

  const columns: TableProps<MyClassItem>['columns'] = [
    {
      title: t('myClasses.columns.class'),
      key: 'class',
      render: (_, row) => (
        <Space orientation="vertical" size={phone ? 6 : 0}>
          {/* J-F62: the name opens the class's own lessons; API-101 has none for a withdrawn, cancelled or pending enrollment. */}
          {hasClassLessons(row.enrollmentStatus) ? (
            <Link to={classLessonsPath(row, my.items)} title={t('myClasses.classLessons.open')} style={{ fontWeight: 600 }}>
              {localizedLabel(row.class.name, language)}
            </Link>
          ) : (
            <Typography.Text strong>{localizedLabel(row.class.name, language)}</Typography.Text>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <bdi dir="ltr">{row.class.code}</bdi>
          </Typography.Text>
          {/* On a phone the way into the lessons stays in the first column, never behind a sideways scroll of the table. */}
          {phone
            ? learningCell(
                row,
                (item) => (
                  <>
                    <ClassLearningProgress item={item} />
                    <ClassLearnButton item={item} />
                  </>
                ),
                null,
              )
            : null}
        </Space>
      ),
    },
    { title: t('common.course'), key: 'course', render: (_, row) => localizedLabel(row.class.course.name, language) },
    ...(phone
      ? []
      : [
          { title: t('myClasses.columns.progress'), key: 'progress', render: (_: unknown, row: MyClassItem) => learningCell(row, (item) => <ClassLearningProgress item={item} />, DASH) },
          { title: t('myClasses.columns.learn'), key: 'learn', render: (_: unknown, row: MyClassItem) => learningCell(row, (item) => <ClassLearnButton item={item} />, null) },
        ]),
    {
      title: t('common.teacher'),
      key: 'teacher',
      render: (_, row) => (row.class.leadTeacher ? displayNameOf(row.class.leadTeacher) : <Typography.Text type="secondary">{t('classes.noTeacher')}</Typography.Text>),
    },
    {
      title: t('myClasses.columns.period'),
      key: 'period',
      render: (_, row) => (row.class.startsOn || row.class.endsOn ? `${formatDay(row.class.startsOn, language)} – ${formatDay(row.class.endsOn, language)}` : DASH),
    },
    { title: t('myClasses.columns.classStatus'), key: 'classStatus', render: (_, row) => <StatusTag value={row.class.status} /> },
    {
      title: t('myClasses.columns.enrollmentStatus'),
      key: 'enrollmentStatus',
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <StatusTag value={row.enrollmentStatus} />
          {row.enrollmentStatus === 'completed' && row.completedAt ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTime(row.completedAt, language)}
            </Typography.Text>
          ) : null}
          {row.enrollmentStatus === 'withdrawn' && row.withdrawnAt ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTime(row.withdrawnAt, language)}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    { title: t('myClasses.columns.enrolledAt'), key: 'enrolledAt', render: (_, row) => formatDateTime(row.enrolledAt, language) },
  ]
  if (showStudent) {
    columns.splice(1, 0, {
      title: t('myClasses.columns.student'),
      key: 'student',
      render: (_, row) => (
        <Space size={4} wrap>
          <span>{displayNameOf(row.student)}</span>
          <Tag color={row.relation === 'self' ? 'green' : 'blue'}>{t(`myClasses.relation.${row.relation}`)}</Tag>
        </Space>
      ),
    })
  }

  const failure = my.error ? describeClassesFailure(my.error) : null

  const classes = (
    <Card>
      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <Select<EnrollmentStatus | undefined>
          allowClear
          placeholder={t('myClasses.defaultStatuses')}
          aria-label={t('myClasses.filterLabel')}
          value={my.status}
          onChange={(value) => my.setStatus(value)}
          options={ENROLLMENT_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
          style={{ minWidth: 200 }}
        />
        <Button icon={<ReloadOutlined />} onClick={reloadClasses} aria-label={t('myClasses.refresh')} />
      </Flex>

      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={my.reload}>
              {t('myClasses.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {learning.error ? <SourceAlert title={t('myClasses.learningError')} description={t(mySchoolFailureKey(learning.error))} onRetry={learning.retry} /> : null}

      <Table<MyClassItem>
        rowKey="enrollmentId"
        columns={columns}
        dataSource={my.items}
        loading={my.loading}
        pagination={false}
        // `true`, not 'max-content' (the users and courses tables — KI-094/KI-095): the table keeps its box's width
        // wherever its columns fit, and only a screen too narrow for them scrolls it in its own box.
        scroll={{ x: true }}
        locale={{ emptyText: my.status ? t('myClasses.emptyFiltered') : t('myClasses.empty') }}
      />
    </Card>
  )

  return (
    <>
      <PageHeader title={t('myClasses.title')} subtitle={t('myClasses.subtitle')} />

      {isStudent ? (
        <Tabs
          activeKey={section}
          onChange={chooseSection}
          items={[
            { key: CLASSES_SECTION, label: t('myClasses.sections.classes'), children: classes },
            {
              key: REQUESTS_SECTION,
              label: (
                <Space size={6}>
                  {t('myClasses.sections.requests')}
                  <Badge count={requests.items.filter(isPendingRequest).length} size="small" />
                </Space>
              ),
              children: <MyEnrollmentRequests source={requests} />,
            },
          ]}
        />
      ) : (
        classes
      )}
    </>
  )
}
