// One course of «My School» (MOD-20, API-229): the cover (or a neutral
// placeholder) with the state badge, the course and its class, the lead
// teacher by name, the server's progress — the bar and the counts of required
// lessons, or «no required lessons yet» —, the last lesson opened and ONE
// action by the server's `action`: start, continue or review, each opening the
// learning workspace, which resumes by itself. The class's next session
// (D-R143 — API-229 `nextSession`): its day and times on the wall clock of its
// own zone (D-R41), its title, and the meeting link — nothing when the class
// has none left. A guardian's card about a child names the student and has no
// action and no meeting link: a guardian follows, never studies.
import { BookOutlined, CalendarOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Button, Card, Progress, Space, Tag, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { MyLearningCourse, NextSession } from '../api/learning'
import { coverSrc } from '../catalog/catalog.view'
import { differsFromDevice } from '../common/timeZone'
import { useLocalized } from '../i18n/useLocalized'
import { isHttpsUrl } from '../learn/learn.format'
import { isSessionLive } from '../learn/learn.sessions'
import { formatLessonDay, formatLessonTimes } from '../lessons/lessons.format'
import { displayNameOf, localizedLabel } from '../users/users.format'
import { COURSE_STATE_COLORS, cardActionOf, courseStateOf, learnPath } from './mySchool.view'

const COVER_HEIGHT = 140

/** The course image, decorative (`alt=""` — the title names the course); a failed load falls back to the placeholder. */
function Cover({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false)
  const src = coverSrc(url)
  if (!src || broken) {
    return (
      <div className="ms-card__placeholder" aria-hidden="true" data-testid="course-cover-placeholder" style={{ height: COVER_HEIGHT }}>
        <BookOutlined />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      data-testid="course-cover"
      style={{ display: 'block', width: '100%', height: COVER_HEIGHT, objectFit: 'cover' }}
    />
  )
}

/** «الحصة القادمة» (D-R143), or «الحصة جارية الآن» while it runs; the meeting link only for the learner's own card. */
function NextSessionLine({ session, withLink }: { session: NextSession; withLink: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const zone = session.timeZone
  const title = localizedLabel(session.title, language)
  const link = withLink && isHttpsUrl(session.meetingUrl) ? session.meetingUrl : null
  return (
    <div className="ms-card__session" data-testid="next-session">
      <CalendarOutlined className="ms-card__session-icon" aria-hidden />
      <div className="ms-card__session-body">
        <Typography.Text strong style={{ fontSize: 13 }}>
          {t(isSessionLive(session) ? 'mySchool.card.nextSessionLive' : 'mySchool.card.nextSession', { title })}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {formatLessonDay(session.startsAt, language, zone)} · <bdi dir="ltr">{formatLessonTimes(session.startsAt, session.endsAt, language, zone)}</bdi>
          {differsFromDevice(zone) ? <> ({t('mySchool.card.sessionZone', { zone })})</> : null}
        </Typography.Text>
      </div>
      {link ? (
        <Button size="small" icon={<VideoCameraOutlined aria-hidden />} href={link} target="_blank" rel="noopener noreferrer">
          {t('mySchool.card.meetingLink')}
          <span className="ms-sr-only"> {t('mySchool.card.newTab')}</span>
        </Button>
      ) : null}
    </div>
  )
}

export function MySchoolCourseCard({ item }: { item: MyLearningCourse }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const action = cardActionOf(item)
  const state = courseStateOf(item)
  const { progress } = item
  const child = item.relation === 'child'
  const cover = coverSrc(item.course.coverImageUrl)

  return (
    <Card
      className="ms-card"
      data-testid={`course-card-${item.enrollmentId}`}
      cover={
        <div className="ms-card__cover">
          <Cover key={cover ?? 'none'} url={item.course.coverImageUrl} />
          <span className="ms-card__badge">
            <Tag color={COURSE_STATE_COLORS[state]}>{t(`mySchool.card.states.${state}`)}</Tag>
          </span>
        </div>
      }
      styles={{ body: { display: 'flex', flexDirection: 'column', gap: 10, flex: 1 } }}
    >
      <div>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 16 }}>
          {localizedLabel(item.course.name, language)}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <bdi dir="ltr">{item.course.code}</bdi>
        </Typography.Text>
      </div>

      {child ? <Typography.Text strong>{t('mySchool.card.student', { name: displayNameOf(item.student) })}</Typography.Text> : null}

      <Space size={[6, 4]} wrap>
        <Typography.Text type="secondary">{localizedLabel(item.class.name, language)}</Typography.Text>
        <Tag color={item.enrollment.status === 'active' ? 'green' : 'default'}>{t(`mySchool.card.enrollment.${item.enrollment.status}`)}</Tag>
      </Space>

      {item.leadTeacher ? <Typography.Text type="secondary">{t('mySchool.card.teacher', { name: displayNameOf(item.leadTeacher) })}</Typography.Text> : null}

      {item.nextSession ? <NextSessionLine session={item.nextSession} withLink={!child} /> : null}

      {progress.percent === null ? (
        <Typography.Text type="secondary">{t('mySchool.card.noRequired')}</Typography.Text>
      ) : (
        <div>
          <Progress
            percent={progress.percent}
            status={progress.isComplete ? 'success' : 'normal'}
            size="small"
            aria-label={t('mySchool.card.progress')}
            format={(percent) => <bdi dir="ltr">{`${percent ?? 0}%`}</bdi>}
          />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t(child ? 'mySchool.card.childLessonsDone' : 'mySchool.card.lessonsDone', { count: progress.required, completed: progress.completedRequired })}
          </Typography.Text>
        </div>
      )}

      {item.lastLesson ? (
        <Typography.Text ellipsis={{ tooltip: true }} style={{ fontSize: 13 }}>
          {t('mySchool.card.lastLesson', { title: localizedLabel(item.lastLesson.title, language) })}
        </Typography.Text>
      ) : null}

      {action ? (
        <Button type="primary" block className="ms-card__action" onClick={() => navigate(learnPath(item.course.id))}>
          {t(`mySchool.card.actions.${action}`)}
        </Button>
      ) : null}
    </Card>
  )
}
