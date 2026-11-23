// One course of «My School» (MOD-20, API-229; PORTAL-04 redesign of the
// course cards, in the identity of /home and /explore): a 16:9 cover (or a
// tinted placeholder of the course) with the state badge, the code and level,
// the course, its class, the lead teacher by name, the server's progress — the
// percentage, a quiet bar and the counts of required lessons, or «no required
// lessons yet», or «no lesson published yet» —, the last lesson opened, and
// ONE action by the server's `action`: start, continue or review, each opening
// the learning workspace, which resumes by itself where the server says. The
// class's next session (D-R143 — API-229 `nextSession`) in its own zone
// (D-R41) with the meeting link. A guardian's card about a child names the
// student and has no action and no meeting link: a guardian follows, never
// studies. `featured`: the course the student was last on, wide at the head of
// «قيد التعلم» with «تابع من حيث توقفت» — the same data, the same one action.
import { BookOutlined, CalendarOutlined, ReadOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Button, Progress, Tag, Typography } from 'antd'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { MyLearningCourse, NextSession } from '../api/learning'
import { coverSrc } from '../catalog/catalog.view'
import { differsFromDevice } from '../common/timeZone'
import { useLocalized } from '../i18n/useLocalized'
import { isHttpsUrl } from '../learn/learn.format'
import { isSessionLive } from '../learn/learn.sessions'
import { formatLessonDay, formatLessonTimes } from '../lessons/lessons.format'
import { placeholderTintOf } from '../publicCatalog/publicCatalog.view'
import { displayNameOf, localizedLabel } from '../users/users.format'
import { COURSE_STATE_COLORS, cardActionOf, courseStateOf, isCourseDone, learnPath } from './mySchool.view'

/** The course image, decorative (`alt=""` — the title names the course); a failed load falls back to the placeholder. */
function Cover({ url, courseId }: { url: string | null; courseId: string }) {
  const [broken, setBroken] = useState(false)
  const src = coverSrc(url)
  if (!src || broken) {
    return (
      <div className={`ms-ccard__placeholder ms-ccard__placeholder--t${placeholderTintOf(courseId)}`} aria-hidden="true" data-testid="course-cover-placeholder">
        <BookOutlined className="ms-ccard__placeholder-icon" />
      </div>
    )
  }
  return <img className="ms-ccard__cover" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} data-testid="course-cover" />
}

/** The day an instant falls on, in this device's zone, with Latin digits (as every date of the app); null when unreadable. */
function dayOf(iso: string | null, language: string): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { dateStyle: 'medium' }).format(date)
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

export function MySchoolCourseCard({ item, featured = false }: { item: MyLearningCourse; featured?: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const titleId = useId()
  const action = cardActionOf(item)
  const state = courseStateOf(item)
  const { progress } = item
  const child = item.relation === 'child'
  const cover = coverSrc(item.course.coverImageUrl)
  // PORTAL-04: no published lesson yet (the server's `total` counts the published lessons) — said plainly, and the
  // button only opens the course (its class sessions live there) instead of promising lessons to learn.
  const noLessons = progress.total === 0
  const level = item.course.level ? localizedLabel(item.course.level.name, language) : null
  // «ابدأ/واصل التعلم» stand out; reviewing a finished course or opening one without lessons is a quieter step.
  const primaryAction = action !== null && action !== 'review' && !noLessons
  // A finished course says when (the enrollment's completion, else the server's last required lesson) — PORTAL-04.
  const doneOn = isCourseDone(item) ? dayOf(item.enrollment.completedAt ?? progress.completedAt, language) : null

  return (
    <article className={featured ? 'ms-ccard ms-ccard--featured' : 'ms-ccard'} data-testid={`course-card-${item.enrollmentId}`} aria-labelledby={titleId}>
      <div className="ms-ccard__media">
        <Cover key={cover ?? 'none'} url={item.course.coverImageUrl} courseId={item.course.id} />
        <span className="ms-ccard__badge">
          <Tag color={COURSE_STATE_COLORS[state]}>{t(`mySchool.card.states.${state}`)}</Tag>
        </span>
      </div>

      <div className="ms-ccard__body">
        {featured ? <span className="ms-ccard__eyebrow">{t('mySchool.card.resume')}</span> : null}
        <div className="ms-ccard__meta">
          <bdi dir="ltr" className="ms-ccard__code">
            {item.course.code}
          </bdi>
          {level ? <span className="ms-ccard__level">{level}</span> : null}
        </div>
        <h3 className="ms-ccard__title" id={titleId}>
          {localizedLabel(item.course.name, language)}
        </h3>

        <div className="ms-ccard__class">
          <span className="ms-ccard__class-name">{localizedLabel(item.class.name, language)}</span>
          <Tag color={item.enrollment.status === 'active' ? 'green' : 'default'}>{t(`mySchool.card.enrollment.${item.enrollment.status}`)}</Tag>
        </div>

        {child ? <Typography.Text strong>{t('mySchool.card.student', { name: displayNameOf(item.student) })}</Typography.Text> : null}
        {item.leadTeacher ? <span className="ms-ccard__muted">{t('mySchool.card.teacher', { name: displayNameOf(item.leadTeacher) })}</span> : null}

        {item.nextSession ? <NextSessionLine session={item.nextSession} withLink={!child} /> : null}

        {noLessons ? (
          <p className="ms-ccard__note" data-testid="course-no-lessons">
            {t('mySchool.card.noLessons')}
          </p>
        ) : progress.percent === null ? (
          <p className="ms-ccard__note">{t('mySchool.card.noRequired')}</p>
        ) : (
          <div className="ms-ccard__progress" data-testid="course-progress">
            <div className="ms-ccard__progress-head">
              <span className="ms-ccard__muted">{t('mySchool.card.progress')}</span>
              <bdi dir="ltr" className="ms-ccard__percent">{`${progress.percent}%`}</bdi>
            </div>
            <Progress
              percent={progress.percent}
              showInfo={false}
              status={progress.isComplete ? 'success' : 'normal'}
              size={{ height: 8 }}
              aria-label={t('mySchool.card.progress')}
            />
            <span className="ms-ccard__muted">
              {t(child ? 'mySchool.card.childLessonsDone' : 'mySchool.card.lessonsDone', { count: progress.required, completed: progress.completedRequired })}
            </span>
          </div>
        )}

        {doneOn ? (
          <span className="ms-ccard__muted" data-testid="course-done-on">
            {t('mySchool.card.completedOn', { date: doneOn })}
          </span>
        ) : null}

        {item.lastLesson ? (
          <div className="ms-ccard__last">
            <ReadOutlined aria-hidden className="ms-ccard__last-icon" />
            <Typography.Text ellipsis={{ tooltip: true }}>{t('mySchool.card.lastLesson', { title: localizedLabel(item.lastLesson.title, language) })}</Typography.Text>
          </div>
        ) : null}

        {action ? (
          <Button
            type={primaryAction ? 'primary' : 'default'}
            size={featured ? 'large' : 'middle'}
            block={!featured}
            className="ms-ccard__action"
            onClick={() => navigate(learnPath(item.course.id))}
          >
            {t(noLessons ? 'mySchool.card.actions.open' : `mySchool.card.actions.${action}`)}
          </Button>
        ) : null}
      </div>
    </article>
  )
}
