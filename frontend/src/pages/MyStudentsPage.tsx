// «طلابي» for a teacher (CH-0370): the list of the students of the classes the
// teacher teaches (API-301) and one student's page (API-302) — read only.
// Kept deliberately simple for people who are not used to websites: one big
// search box, two plain filters, big cards with the name, the phone and the
// attendance, and on the student's page short sections with large numbers.
// Every number is the server's; the marks are the class gradebook's own row.
import { ArrowLeftOutlined, ArrowRightOutlined, MailOutlined, PhoneOutlined, ReloadOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Avatar, Button, Card, Col, Empty, Flex, Input, List, Row, Segmented, Select, Skeleton, Space, Statistic, Table, Tag, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { ApiError } from '../api/client'
import type { GradebookCell, GradebookComponent } from '../api/gradebook'
import { TEACHING_STUDENT_FILTERS, getTeachingStudent, listTeachingStudents } from '../api/teachingStudents'
import type { TeachingAttendanceCounts, TeachingStudentClass, TeachingStudentDetail, TeachingStudentFilter, TeachingStudentListItem } from '../api/teachingStudents'
import { ATTENDANCE_STATUS_COLORS } from '../attendance/attendance.format'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { GRADE_CELL_COLORS, bandText, percentText } from '../grades/myGrades.view'
import { useLocalized } from '../i18n/useLocalized'
import { rateColor } from '../teaching/myStudents.view'
import { displayNameOf, formatDateTime, localizedLabel } from '../users/users.format'

const SEARCH_DELAY_MS = 300

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

interface ListState {
  key: string
  items: TeachingStudentListItem[]
  truncated: boolean
  error: unknown
}

function RateTag({ attendance }: { attendance: TeachingAttendanceCounts | null }) {
  const { t } = useTranslation()
  if (!attendance) return null
  if (attendance.rate === null) return <Tag>{t('myStudents.noAttendance')}</Tag>
  return <Tag color={rateColor(attendance.rate)}>{t('myStudents.attendanceRate', { rate: attendance.rate })}</Tag>
}

/** `/my-students` — API-301. */
export function MyStudentsPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [classId, setClassId] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<TeachingStudentFilter>('active')
  const [reloadTick, setReloadTick] = useState(0)
  const q = useDebounced(text.trim(), SEARCH_DELAY_MS)
  const requestKey = JSON.stringify([q, classId, status, reloadTick])
  const [state, setState] = useState<ListState>({ key: '', items: [], truncated: false, error: null })
  const [classOptions, setClassOptions] = useState<{ value: string; label: string }[]>([])
  const loading = state.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    listTeachingStudents({ q, classId, status }, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setState({ key: requestKey, items: list.items, truncated: list.truncated, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [q, classId, status, requestKey])

  // The class filter lists every class the teacher has students in (one read, without the other filters).
  useEffect(() => {
    const controller = new AbortController()
    listTeachingStudents({ status: 'all' }, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        const seen = new Map<string, string>()
        for (const item of list.items) for (const entry of item.classes) seen.set(entry.class.id, `${localizedLabel(entry.class.name, language)} — ${localizedLabel(entry.class.course.name, language)}`)
        setClassOptions([...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [language, reloadTick])

  const filtered = q !== '' || classId !== undefined || status !== 'active'

  return (
    <>
      <PageHeader title={t('myStudents.title')} subtitle={t('myStudents.subtitle')} />
      <Flex vertical gap={12} style={{ marginBottom: 16 }}>
        <Input.Search size="large" allowClear placeholder={t('myStudents.search')} aria-label={t('myStudents.search')} value={text} onChange={(event) => setText(event.target.value)} maxLength={100} />
        <Flex wrap gap={12} align="center">
          <Select
            size="large"
            allowClear
            style={{ minWidth: 240, maxWidth: '100%' }}
            placeholder={t('myStudents.allClasses')}
            aria-label={t('myStudents.allClasses')}
            value={classId}
            onChange={(value: string | undefined) => setClassId(value)}
            options={classOptions}
          />
          <Segmented
            size="large"
            aria-label={t('myStudents.show.label')}
            value={status}
            onChange={(value) => setStatus(value as TeachingStudentFilter)}
            options={TEACHING_STUDENT_FILTERS.map((value) => ({ value, label: t(`myStudents.show.${value}`) }))}
          />
        </Flex>
      </Flex>

      {state.error && !loading ? (
        <Alert
          type="error"
          showIcon
          title={t('myStudents.loadError')}
          action={
            <Button icon={<ReloadOutlined />} onClick={() => setReloadTick((tick) => tick + 1)}>
              {t('myStudents.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {loading && state.key === '' ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : state.items.length === 0 && !state.error ? (
        <Empty description={filtered ? t('myStudents.emptyFiltered') : t('myStudents.empty')} />
      ) : (
        <>
          <Typography.Paragraph type="secondary" aria-live="polite">
            {t('myStudents.count', { count: state.items.length })}
          </Typography.Paragraph>
          {state.truncated ? <Alert type="info" showIcon title={t('myStudents.truncated')} style={{ marginBottom: 16 }} /> : null}
          <Row gutter={[12, 12]} style={{ opacity: loading ? 0.6 : 1 }}>
            {state.items.map((item) => (
              <Col key={item.student.id} xs={24} sm={12} md={8} lg={6}>
                <Card hoverable size="small" onClick={() => navigate(`/my-students/${item.student.id}`)} data-testid={`student-card-${item.student.id}`} style={{ height: '100%' }}>
                  <Flex vertical gap={6}>
                    <Flex gap={12} align="center">
                      <Avatar size={36} src={item.student.avatarUrl ?? undefined} icon={<UserOutlined />} />
                      <Typography.Title level={5} style={{ margin: 0 }}>
                        <bdi>{displayNameOf(item.student)}</bdi>
                      </Typography.Title>
                    </Flex>
                    {item.student.phone ? (
                      <Typography.Text>
                        <PhoneOutlined /> <bdi dir="ltr">{item.student.phone}</bdi>
                      </Typography.Text>
                    ) : null}
                    <Flex wrap gap={6}>
                      {item.classes.map((entry) => (
                        <Tag key={entry.enrollmentId}>{localizedLabel(entry.class.name, language)}</Tag>
                      ))}
                    </Flex>
                    <div>
                      <RateTag attendance={item.attendance} />
                    </div>
                    <Button type="primary" block>
                      {t('myStudents.open')}
                    </Button>
                  </Flex>
                </Card>
              </Col>
            ))}
          </Row>
        </>
      )}
    </>
  )
}

function markText(component: GradebookComponent, cell: GradebookCell | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!cell) return '—'
  const shown = cell.effectiveScore ?? cell.score
  if (shown === null) return '—'
  return `${shown} ${t('myGrades.outOf', { max: component.maxScore })}`
}

function stateKey(component: GradebookComponent, cell: GradebookCell | undefined): string {
  if (!cell) return component.kind === 'exam' ? 'missing_exam' : 'missing_assignment'
  return cell.status === 'missing' ? `missing_${component.kind}` : cell.status
}

function ClassSection({ entry }: { entry: TeachingStudentClass }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const grades = entry.grades
  const readsGrades = useAuth().hasPermission('grades.read_all')
  const cells = new Map((grades?.cells ?? []).map((cell) => [`${cell.kind}:${cell.id}`, cell]))
  return (
    <Card
      title={
        <Flex wrap gap={8} align="center">
          <span>
            <bdi>{localizedLabel(entry.class.name, language)}</bdi> — <bdi>{localizedLabel(entry.class.course.name, language)}</bdi>
          </span>
          <Tag color={entry.enrollmentStatus === 'active' ? 'green' : entry.enrollmentStatus === 'withdrawn' ? 'red' : 'blue'}>{t(`myStudents.student.enrollment.${entry.enrollmentStatus}`)}</Tag>
        </Flex>
      }
      style={{ marginBottom: 16 }}
      styles={{ header: { paddingBlock: 12 } }}
    >
      <Typography.Title level={5}>{t('myStudents.attendanceSection.title')}</Typography.Title>
      {entry.attendance ? (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 12 }}>
            {(['present', 'late', 'absent', 'excused'] as const).map((key) => (
              <Col key={key} xs={12} sm={6}>
                <Statistic title={t(`myStudents.attendanceSection.${key}`)} value={entry.attendance![key]} valueStyle={{ color: key === 'absent' && entry.attendance![key] > 0 ? '#cf1322' : undefined }} />
              </Col>
            ))}
          </Row>
          <Flex align="center" gap={8} style={{ marginBottom: 12 }}>
            <Typography.Text strong>{t('myStudents.attendanceSection.rate')}:</Typography.Text>
            {entry.attendance.rate === null ? (
              <Typography.Text>{t('myStudents.attendanceSection.noRate')}</Typography.Text>
            ) : (
              <Tag color={rateColor(entry.attendance.rate)} style={{ fontSize: 16, padding: '2px 10px' }}>
                {percentText(entry.attendance.rate)}
              </Tag>
            )}
          </Flex>
          {entry.attendance.lessons.length === 0 ? (
            <Typography.Paragraph type="secondary">{t('myStudents.attendanceSection.noLessons')}</Typography.Paragraph>
          ) : (
            <List
              size="small"
              bordered
              dataSource={entry.attendance.lessons}
              renderItem={(lesson) => (
                <List.Item>
                  <Flex wrap gap={8} justify="space-between" style={{ width: '100%' }}>
                    <span>
                      <bdi>{localizedLabel(lesson.title, language)}</bdi>
                      <Typography.Text type="secondary"> · {formatDateTime(lesson.startsAt, language)}</Typography.Text>
                    </span>
                    {lesson.status ? (
                      <Tag color={ATTENDANCE_STATUS_COLORS[lesson.status]}>
                        {t(`myStudents.attendanceSection.${lesson.status}`)}
                        {lesson.status === 'late' && lesson.minutesLate ? ` (${t('myStudents.attendanceSection.minutesLate', { count: lesson.minutesLate })})` : ''}
                      </Tag>
                    ) : (
                      <Tag>{t('myStudents.attendanceSection.notRecorded')}</Tag>
                    )}
                  </Flex>
                </List.Item>
              )}
            />
          )}
        </>
      ) : (
        <Typography.Paragraph type="secondary">{t('myStudents.attendanceSection.hidden')}</Typography.Paragraph>
      )}

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        {t('myStudents.gradesSection.title')}
      </Typography.Title>
      {!grades ? (
        <Typography.Paragraph type="secondary">{t(readsGrades ? 'myStudents.gradesSection.notListed' : 'myStudents.gradesSection.hidden')}</Typography.Paragraph>
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 12 }}>
            <Col xs={24} sm={12}>
              <Statistic title={t('myStudents.gradesSection.current')} value={grades.current === null ? t('myStudents.gradesSection.noCurrent') : percentText(grades.current)} />
              <Typography.Text type="secondary">{t('myStudents.gradesSection.currentHint')}</Typography.Text>
            </Col>
            <Col xs={24} sm={12}>
              <Statistic
                title={t('myStudents.gradesSection.final')}
                value={grades.final ? `${percentText(grades.final.percent)} — ${bandText(grades.final, language)}` : t('myStudents.gradesSection.noFinal')}
              />
            </Col>
          </Row>
          {grades.components.length === 0 ? (
            <Typography.Paragraph type="secondary">{t('myStudents.gradesSection.noItems')}</Typography.Paragraph>
          ) : (
            <Table
              size="small"
              pagination={false}
              scroll={{ x: true }}
              rowKey={(component) => `${component.kind}:${component.id}`}
              dataSource={grades.components}
              columns={[
                { key: 'title', title: t('myStudents.gradesSection.item'), render: (_: unknown, component: GradebookComponent) => <bdi>{localizedLabel(component.title, language)}</bdi> },
                { key: 'kind', title: t('myStudents.gradesSection.kind'), render: (_: unknown, component: GradebookComponent) => t(`myGrades.kind.${component.kind}`) },
                {
                  key: 'mark',
                  title: t('myStudents.gradesSection.mark'),
                  render: (_: unknown, component: GradebookComponent) => <bdi>{markText(component, cells.get(`${component.kind}:${component.id}`), t)}</bdi>,
                },
                {
                  key: 'state',
                  title: t('myStudents.gradesSection.state'),
                  render: (_: unknown, component: GradebookComponent) => {
                    const cell = cells.get(`${component.kind}:${component.id}`)
                    return <Tag color={cell ? GRADE_CELL_COLORS[cell.status] : 'default'}>{t(`myGrades.status.${stateKey(component, cell)}`)}</Tag>
                  },
                },
              ]}
            />
          )}
        </>
      )}
    </Card>
  )
}

interface DetailState {
  key: string
  detail: TeachingStudentDetail | null
  error: unknown
}

/** `/my-students/:studentId` — API-302. */
export function MyStudentPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { studentId = '' } = useParams()
  // «Back» points the way the page reads: right in Arabic, left in English.
  const BackIcon = i18n.dir() === 'rtl' ? ArrowRightOutlined : ArrowLeftOutlined
  const [reloadTick, setReloadTick] = useState(0)
  const requestKey = `${studentId}:${reloadTick}`
  const [state, setState] = useState<DetailState>({ key: '', detail: null, error: null })
  const loading = state.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    getTeachingStudent(studentId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) setState({ key: requestKey, detail, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key: requestKey, detail: null, error })
      })
    return () => controller.abort()
  }, [studentId, requestKey])

  const notFound = useMemo(() => state.error instanceof ApiError && (state.error.status === 404 || state.error.status === 400), [state.error])
  const back = (
    <Button size="large" icon={<BackIcon />} onClick={() => navigate('/my-students')} style={{ marginBottom: 16 }}>
      {t('myStudents.student.back')}
    </Button>
  )

  if (loading) {
    return (
      <>
        {back}
        <Skeleton active paragraph={{ rows: 8 }} />
      </>
    )
  }
  if (state.error || !state.detail) {
    return (
      <>
        {back}
        {notFound ? (
          <Empty description={t('myStudents.student.notFound')} />
        ) : (
          <Alert
            type="error"
            showIcon
            title={t('myStudents.student.loadError')}
            action={
              <Button icon={<ReloadOutlined />} onClick={() => setReloadTick((tick) => tick + 1)}>
                {t('myStudents.retry')}
              </Button>
            }
          />
        )}
      </>
    )
  }

  const { student, guardians, classes } = state.detail
  return (
    <>
      {back}
      <Card style={{ marginBottom: 16 }}>
        <Flex gap={16} align="center" wrap>
          <Avatar size={64} src={student.avatarUrl ?? undefined} icon={<UserOutlined />} />
          <Typography.Title level={2} style={{ margin: 0 }}>
            <bdi>{displayNameOf(student)}</bdi>
          </Typography.Title>
        </Flex>
        <Row gutter={[24, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} md={12}>
            <Typography.Title level={5}>{t('myStudents.student.contact')}</Typography.Title>
            {student.phone || student.email ? (
              <Flex vertical gap={8}>
                {student.phone ? (
                  <Space wrap>
                    <PhoneOutlined />
                    <bdi dir="ltr">{student.phone}</bdi>
                    <Button size="small" href={`tel:${student.phone.replace(/\s+/g, '')}`}>
                      {t('myStudents.student.call')}
                    </Button>
                  </Space>
                ) : null}
                {student.email ? (
                  <Space>
                    <MailOutlined />
                    <a href={`mailto:${student.email}`}>
                      <bdi dir="ltr">{student.email}</bdi>
                    </a>
                  </Space>
                ) : null}
              </Flex>
            ) : (
              <Typography.Text type="secondary">{t('myStudents.student.noContact')}</Typography.Text>
            )}
          </Col>
          <Col xs={24} md={12}>
            <Typography.Title level={5}>{t('myStudents.student.guardians')}</Typography.Title>
            {guardians.length === 0 ? (
              <Typography.Text type="secondary">{t('myStudents.student.noGuardians')}</Typography.Text>
            ) : (
              <Flex vertical gap={8}>
                {guardians.map((guardian) => (
                  <Space key={guardian.id} wrap>
                    <Typography.Text strong>
                      <bdi>{displayNameOf(guardian)}</bdi>
                    </Typography.Text>
                    <Tag>{t(`users.relationships.${guardian.relationship}`)}</Tag>
                    {guardian.isPrimary ? <Tag color="blue">{t('myStudents.student.primary')}</Tag> : null}
                    {guardian.phone ? (
                      <Button size="small" icon={<PhoneOutlined />} href={`tel:${guardian.phone.replace(/\s+/g, '')}`}>
                        <bdi dir="ltr">{guardian.phone}</bdi>
                      </Button>
                    ) : null}
                  </Space>
                ))}
              </Flex>
            )}
          </Col>
        </Row>
      </Card>
      {classes.map((entry) => (
        <ClassSection key={entry.enrollmentId} entry={entry} />
      ))}
    </>
  )
}
