// One course of «my courses» (MOD-19): the reader's enrollments in its
// classes as «my classes» (API-060) returns them — the class, the lead teacher
// by name, the dates, the class and enrollment states, and for a guardian the
// child — with quick links to the learner pages, which already show only what
// an active or completed enrollment opens.
import { Button, Card, Descriptions, Space, Tag, Typography } from 'antd'
import type { DescriptionsProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDay, localizedLabel } from '../users/users.format'
import type { CourseGroup } from './catalog.view'

const QUICK_LINKS = [
  ['lessons', '/my-lessons'],
  ['assignments', '/my-assignments'],
  ['exams', '/my-exams'],
  ['grades', '/my-grades'],
  ['certificates', '/my-certificates'],
  ['schedule', '/schedule'],
] as const

const DASH = '—'

export function CourseGroupCard({ group, showStudent }: { group: CourseGroup; showStudent: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()

  return (
    <Card
      size="small"
      data-testid={`course-group-${group.course.id}`}
      title={
        <Space size={6} wrap>
          <span>{localizedLabel(group.course.name, language)}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <bdi dir="ltr">{group.course.code}</bdi>
          </Typography.Text>
        </Space>
      }
      styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
    >
      {group.items.map((item) => {
        const items: DescriptionsProps['items'] = [
          {
            key: 'class',
            label: t('myCourses.courses.class'),
            children: (
              <Space size={6} wrap>
                <span>{localizedLabel(item.class.name, language)}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <bdi dir="ltr">{item.class.code}</bdi>
                </Typography.Text>
              </Space>
            ),
          },
        ]
        if (showStudent) {
          items.push({
            key: 'student',
            label: t('myCourses.courses.student'),
            children: (
              <Space size={4} wrap>
                <span>{displayNameOf(item.student)}</span>
                <Tag color={item.relation === 'self' ? 'green' : 'blue'}>{t(`myClasses.relation.${item.relation}`)}</Tag>
              </Space>
            ),
          })
        }
        items.push(
          {
            key: 'teacher',
            label: t('myCourses.courses.teacher'),
            children: item.class.leadTeacher ? displayNameOf(item.class.leadTeacher) : <Typography.Text type="secondary">{t('myCourses.courses.noTeacher')}</Typography.Text>,
          },
          {
            key: 'period',
            label: t('myCourses.courses.period'),
            children: item.class.startsOn || item.class.endsOn ? `${formatDay(item.class.startsOn, language)} – ${formatDay(item.class.endsOn, language)}` : DASH,
          },
          { key: 'classStatus', label: t('myCourses.courses.classStatus'), children: <StatusTag value={item.class.status} /> },
          { key: 'enrollmentStatus', label: t('myCourses.courses.enrollmentStatus'), children: <StatusTag value={item.enrollmentStatus} /> },
        )
        return <Descriptions key={item.enrollmentId} size="small" column={1} bordered items={items} />
      })}
      <div>
        <Typography.Text type="secondary">{t('myCourses.courses.quickLinks')}</Typography.Text>
        <Space size={[8, 8]} wrap style={{ display: 'flex', marginTop: 6 }}>
          {QUICK_LINKS.map(([key, path]) => (
            <Button key={key} size="small" onClick={() => navigate(path)}>
              {t(`myCourses.links.${key}`)}
            </Button>
          ))}
        </Space>
      </div>
    </Card>
  )
}
