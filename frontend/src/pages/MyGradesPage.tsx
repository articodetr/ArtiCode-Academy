// «My grades» (MOD-09 — J-F50): GET /api/me/grades (API-129) for a student
// (their own enrollments, `relation: self`, with `grades.read_own`) and a
// guardian (their linked children's, `relation: child`, with
// `grades.read_linked` while they hold the `guardian` role — the server
// decides, D-R48). One card per owned `active`/`completed` enrollment, in the
// server's order: the class and course, the student with the self/child tag
// for a guardian, the enrollment, the class's assignments (no drafts — the
// latest graded attempt, with the late penalty exactly as the server applied
// it) and published exams (scored, absent — counted 0 — or excused) with
// their weights and maximum scores, and the final grade once the class is
// finalized — percent, band label and letter, pass, the date — or a «not
// fixed yet» state. No running average and no calculation here (D-R48): every
// number is the server's. The student and class filters read «my classes»
// (API-060 — the same ownership); no pagination. A caller holding neither key
// gets 403 permission_denied, which the page words in place of the grades;
// one key alone hides its relation, which the page says too. Each card wraps
// its rows (no table), so a phone shows them without a sideways scroll. The
// route opens to the holders of the `student` or `guardian` server role key
// only (nav entry `myGrades`).
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Divider, Empty, Flex, Select, Space, Spin, Tag, Typography, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { MyFinalGrade, MyGradeComponent, MyGradeItem } from '../api/myGrades'
import { scoreText } from '../assignments/myAssignments.view'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { useMyClasses } from '../enrollments/useMyClasses'
import { describeMyGradesFailure, failureMessage } from '../grades/myGrades.errors'
import { GRADE_CELL_COLORS, bandText, hiddenRelations, isNarrowed, isWeighted, percentText, scoreCellOf, scoreFromEarlierAttempt, statusKeyOf } from '../grades/myGrades.view'
import { useMyGrades } from '../grades/useMyGrades'
import { useLocalized } from '../i18n/useLocalized'
import { classOptionsOf, showsStudents, studentOptionsOf } from '../lessons/myLessons.view'
import { displayNameOf, formatDateTime, localizedLabel } from '../users/users.format'

/** A control keeps its width on a wide screen and narrows with a phone's (no sideways page scroll). */
function fluid(width: number) {
  return { width, maxWidth: '100%' }
}

function ComponentScore({ component }: { component: MyGradeComponent }) {
  const { t } = useTranslation()
  const cell = scoreCellOf(component)
  if (cell.kind === 'none') {
    return (
      <span>
        <Typography.Text type="secondary">{t('myGrades.outOf', { max: component.maxScore })}</Typography.Text>
        {component.status === 'excused' ? (
          <>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('myGrades.excusedNote')}
            </Typography.Text>
          </>
        ) : null}
      </span>
    )
  }
  return (
    <span>
      <Typography.Text strong>
        <span dir="ltr">{scoreText(cell.kind === 'score' ? cell.score : cell.value, component.maxScore)}</span>
      </Typography.Text>
      {cell.kind === 'score' && cell.adjusted !== null ? (
        <>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {`${t('myGrades.afterPenalty')} `}
            <span dir="ltr">{scoreText(cell.adjusted, component.maxScore)}</span>
          </Typography.Text>
        </>
      ) : null}
      {scoreFromEarlierAttempt(component) ? (
        <>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('myGrades.earlierAttempt')}
          </Typography.Text>
        </>
      ) : null}
    </span>
  )
}

/** The class's assignments then its published exams, in the server's order: one wrapping row each. */
function GradeComponents({ item }: { item: MyGradeItem }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { token } = theme.useToken()
  if (item.components.length === 0) return <Typography.Text type="secondary">{t('myGrades.noComponents')}</Typography.Text>
  return (
    <ul aria-label={t('myGrades.components')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {item.components.map((component, index) => (
        <li
          key={`${component.kind}:${component.id}`}
          data-testid="my-grade-component"
          style={{ padding: '8px 0', borderTop: index === 0 ? undefined : `1px solid ${token.colorBorderSecondary}` }}
        >
          <Flex justify="space-between" align="center" wrap gap={8}>
            <Space size={6} wrap>
              <Tag color={component.kind === 'exam' ? 'purple' : 'cyan'}>{t(`myGrades.kind.${component.kind}`)}</Tag>
              <Typography.Text strong>{localizedLabel(component.title, language)}</Typography.Text>
            </Space>
            <Space size={8} wrap align="center">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {isWeighted(component) ? t('myGrades.weight', { weight: component.weight }) : t('myGrades.informational')}
              </Typography.Text>
              <Tag color={GRADE_CELL_COLORS[component.status]}>{t(`myGrades.status.${statusKeyOf(component)}`)}</Tag>
              {component.late ? <Tag color="volcano">{t('myGrades.late')}</Tag> : null}
              <ComponentScore component={component} />
            </Space>
          </Flex>
        </li>
      ))}
    </ul>
  )
}

/** The final grade as the server fixed it, or the «not fixed yet» state — never a running average (D-R48). */
function FinalGrade({ final }: { final: MyFinalGrade | null }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <div data-testid="my-final-grade" style={{ flex: '0 1 auto', minWidth: 0 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('myGrades.final.title')}
      </Typography.Text>
      {final ? (
        <>
          <div>
            <Typography.Text strong style={{ fontSize: 22 }}>
              <span dir="ltr">{percentText(final.percent)}</span>
            </Typography.Text>
          </div>
          <Space size={4} wrap>
            <Typography.Text strong>{bandText(final, language)}</Typography.Text>
            <Tag color={final.isPass ? 'green' : 'red'}>{t(final.isPass ? 'myGrades.final.pass' : 'myGrades.final.fail')}</Tag>
          </Space>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('myGrades.final.finalizedAt', { date: formatDateTime(final.finalizedAt, language) })}
            </Typography.Text>
          </div>
        </>
      ) : (
        <>
          <div>
            <Typography.Text strong>{t('myGrades.final.pending')}</Typography.Text>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('myGrades.final.pendingHint')}
          </Typography.Text>
        </>
      )}
    </div>
  )
}

function GradeCard({ item, showStudent }: { item: MyGradeItem; showStudent: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <Card size="small" data-testid="my-grade-card">
      <Flex justify="space-between" align="flex-start" wrap gap={16}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <Space size={8} wrap>
            <Typography.Text dir="ltr" strong>
              {item.class.code}
            </Typography.Text>
            <Typography.Text strong>{localizedLabel(item.class.name, language)}</Typography.Text>
          </Space>
          <div>
            <Typography.Text type="secondary">{localizedLabel(item.class.course.name, language)}</Typography.Text>
          </div>
          <Space size={4} wrap style={{ marginTop: 6 }}>
            {showStudent ? (
              <>
                <span>{displayNameOf(item.student)}</span>
                <Tag color={item.relation === 'self' ? 'green' : 'blue'}>{t(`myClasses.relation.${item.relation}`)}</Tag>
              </>
            ) : null}
            <Tag color={item.enrollmentStatus === 'active' ? 'green' : 'default'}>{t(`myGrades.enrollment.${item.enrollmentStatus}`)}</Tag>
          </Space>
        </div>
        <FinalGrade final={item.final} />
      </Flex>
      <Divider style={{ margin: '12px 0' }} />
      <GradeComponents item={item} />
    </Card>
  )
}

export function MyGradesPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const roleKeys = user?.roles ?? []
  const grades = useMyGrades()
  const myClasses = useMyClasses()
  const { filters } = grades
  const students = studentOptionsOf(myClasses.items)
  const classes = classOptionsOf(myClasses.items, filters.studentId)
  const showStudent = showsStudents(roleKeys, grades.items)
  // The student filter helps whoever owns grades through more than one student (a guardian, or a student who is also one).
  const canPickStudent = students.length > 1 || students.some((student) => student.relation === 'child')
  const hidden = hiddenRelations(roleKeys, user?.permissions ?? [])
  const failure = grades.error ? describeMyGradesFailure(grades.error) : null
  const noEnrollment = !myClasses.loading && !myClasses.error && myClasses.items.length === 0
  const emptyText = isNarrowed(filters) ? t('myGrades.empty.filtered') : noEnrollment ? t('myGrades.empty.noEnrollment') : t('myGrades.empty.none')

  const selectStudent = (studentId: string | undefined) => {
    // A class the newly chosen student is not enrolled in would match nothing: drop it.
    const stillOwned = !filters.classId || classOptionsOf(myClasses.items, studentId).some((option) => option.id === filters.classId)
    grades.setFilters({ studentId, classId: stillOwned ? filters.classId : undefined })
  }

  const header = <PageHeader title={t('myGrades.title')} subtitle={t('myGrades.subtitle')} />

  // Neither grades key (403 permission_denied): no retry can change it, so the reason replaces the grades.
  if (failure?.forbidden) {
    return (
      <>
        {header}
        <Alert type="warning" showIcon title={failureMessage(t, failure)} />
      </>
    )
  }

  return (
    <>
      {header}

      <Card>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 12 }}>
          {canPickStudent ? (
            <Select<string | undefined>
              allowClear
              placeholder={t('myGrades.filters.allStudents')}
              aria-label={t('myGrades.filters.student')}
              value={filters.studentId}
              onChange={(value) => selectStudent(value)}
              options={students.map((student) => ({
                value: student.id,
                label: student.relation === 'self' ? `${displayNameOf(student)} (${t('myClasses.relation.self')})` : displayNameOf(student),
              }))}
              style={fluid(200)}
            />
          ) : null}
          <Select<string | undefined>
            allowClear
            placeholder={t('myGrades.filters.allClasses')}
            aria-label={t('myGrades.filters.class')}
            value={filters.classId}
            onChange={(value) => grades.setFilters({ classId: value })}
            options={classes.map((option) => ({ value: option.id, label: `${option.code} — ${localizedLabel(option.name, language)}` }))}
            style={fluid(220)}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              grades.reload()
              myClasses.reload()
            }}
            aria-label={t('myGrades.refresh')}
          />
        </Flex>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('myGrades.weightsHint')}
        </Typography.Paragraph>

        {hidden.map((relation) => (
          <Alert key={relation} type="info" showIcon title={t(`myGrades.hidden.${relation}`)} style={{ marginBottom: 12 }} />
        ))}

        {myClasses.error ? <Alert type="warning" showIcon title={t('myGrades.optionsFailed')} style={{ marginBottom: 12 }} /> : null}

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={grades.reload}>
                {t('myGrades.refresh')}
              </Button>
            }
            style={{ marginBottom: 12 }}
          />
        ) : null}

        <Spin spinning={grades.loading}>
          {grades.items.length > 0 ? (
            <Flex vertical gap={16}>
              {grades.items.map((item) => (
                <GradeCard key={item.enrollmentId} item={item} showStudent={showStudent} />
              ))}
            </Flex>
          ) : grades.loading || failure ? (
            <div style={{ minHeight: 120 }} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
          )}
        </Spin>
      </Card>
    </>
  )
}
