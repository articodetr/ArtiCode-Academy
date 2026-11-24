// «الجدول الدراسي» on the admin home (J-F59): the lessons of today, or the coming lessons of the next seven days, read
// from API-093 GET /api/lessons (lessons.read; `classes.manage` sees every class, anyone else their own — D-R16).
// «Today» and the week are the academy's days; each lesson's time shows in its own zone (D-R41), with the zone named
// when it is not the day's (LessonZoneNote). A lesson opens in /lessons (`?open=<id>`) for a viewer the menu lets in,
// and its meeting link shows while it is not cancelled. Only one week is ever read — never a whole month or year.
import { Empty, Segmented, Typography } from 'antd'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { Lesson } from '../../api/lessons'
import { StatusTag } from '../../components/StatusTag'
import { useLocalized } from '../../i18n/useLocalized'
import { formatLessonTimes, lessonTitle } from '../../lessons/lessons.format'
import { LessonZoneNote } from '../../lessons/LessonZone'
import { addDays } from '../../timetable/timetable.dates'
import type { CalendarDate } from '../../timetable/timetable.dates'
import { CardContent } from '../DashboardCards'
import { labelIn } from '../dashboard.data'
import type { Reloadable } from '../useLoad'
import { formatDayHeading } from './admin.format'
import { byDay, lessonsToShow } from './admin.lessons'
import type { ScheduleView } from './admin.lessons'

interface AdminUpcomingLessonsProps {
  loaded: Reloadable<Lesson[]>
  view: ScheduleView
  onViewChange: (view: ScheduleView) => void
  /** The academy's zone and today in it. */
  zone: string
  today: CalendarDate
  now: number
  /** Whether /lessons opens for this viewer (the details link). */
  canOpenLessons: boolean
}

export function AdminUpcomingLessons({ loaded, view, onViewChange, zone, today, now, canOpenLessons }: AdminUpcomingLessonsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const headingId = useId()

  const dayLabel = (date: CalendarDate) =>
    date === today ? t('dashboard.admin.schedule.today') : date === addDays(today, 1) ? t('dashboard.admin.schedule.tomorrow') : formatDayHeading(date, language)

  return (
    <section className="admin-panel" aria-labelledby={headingId}>
      <header className="admin-panel__header">
        <div>
          <Typography.Title level={2} id={headingId} className="admin-section__title">
            {t('dashboard.admin.schedule.title')}
          </Typography.Title>
          <Typography.Text type="secondary">
            <time dateTime={today}>{formatDayHeading(today, language, true)}</time>
          </Typography.Text>
        </div>
        <div className="admin-panel__tools">
          <Segmented<ScheduleView>
            value={view}
            onChange={onViewChange}
            options={[
              { value: 'day', label: t('dashboard.admin.schedule.dayView') },
              { value: 'week', label: t('dashboard.admin.schedule.weekView') },
            ]}
            aria-label={t('dashboard.admin.schedule.viewLabel')}
          />
          {canOpenLessons ? <Link to="/lessons">{t('dashboard.admin.schedule.all')}</Link> : null}
        </div>
      </header>

      <CardContent loaded={loaded}>
        {(items) => {
          const shown = lessonsToShow(items, view, now)
          if (shown.length === 0) {
            return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(view === 'day' ? 'dashboard.admin.schedule.emptyDay' : 'dashboard.admin.schedule.emptyWeek')} />
          }
          return (
            <>
              <LessonZoneNote timeZones={shown.map((lesson) => lesson.timeZone)} dayZone={zone} />
              {byDay(shown, zone).map((group) => (
                <div key={group.date} className="admin-lessons__day">
                  {view === 'week' ? (
                    <Typography.Text strong className="admin-lessons__day-title">
                      {dayLabel(group.date)}
                    </Typography.Text>
                  ) : null}
                  <ul className="admin-lessons">
                    {group.lessons.map((lesson) => (
                      <li key={lesson.id} className="admin-lesson" data-testid="admin-lesson">
                        <span className="admin-lesson__time tabular-nums">
                          <bdi dir="ltr">{formatLessonTimes(lesson.startsAt, lesson.endsAt, language, lesson.timeZone)}</bdi>
                        </span>
                        <span className="admin-lesson__body">
                          <Typography.Text strong className="admin-lesson__title">
                            <bdi dir="auto">{lessonTitle(lesson, language)}</bdi>
                          </Typography.Text>
                          <Typography.Text type="secondary" className="admin-lesson__class">
                            <bdi dir="auto">{labelIn(lesson.class.name, language)}</bdi>
                            {' · '}
                            <bdi dir="auto">{labelIn(lesson.class.course.name, language)}</bdi>
                          </Typography.Text>
                        </span>
                        <span className="admin-lesson__meta">
                          <StatusTag value={lesson.status} />
                          {lesson.meetingUrl && lesson.status !== 'cancelled' ? (
                            <a href={lesson.meetingUrl} target="_blank" rel="noopener noreferrer">
                              {t('dashboard.admin.schedule.join')}
                            </a>
                          ) : null}
                          {canOpenLessons ? <Link to={`/lessons?open=${encodeURIComponent(lesson.id)}`}>{t('dashboard.admin.schedule.details')}</Link> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )
        }}
      </CardContent>
    </section>
  )
}
