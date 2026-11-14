// The day timeline (redesign, 2026-11-14): lessons as blocks on an hour line, one row per lane, a red line at
// "now". Positions are shares of the shown hours (dayWindow), placed with logical CSS so the line runs from the
// start side in both directions. Each block opens the lessons page.
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { Lesson } from '../api/lessons'
import type { LocalizedLabel } from '../api/users'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonTimes } from '../lessons/lessons.format'
import { hoursOf, labelIn, lessonState, nowOffset, place } from './dashboard.data'
import type { DayWindow } from './dashboard.data'

export interface TimelineLane {
  key: string
  /** A label at the start of the row (teacher, room); none for the plain day view. */
  label?: ReactNode
  lessons: Lesson[]
}

interface DayTimelineProps {
  lanes: TimelineLane[]
  window: DayWindow
  zone: string
  now: number
  nowMinutes: number
  /** Whether the "now" line belongs on this day (only today's timeline shows it). */
  showNow: boolean
  /** Second line of a block: what the lane does not already say. */
  detail: 'roomAndTeacher' | 'room' | 'teacher'
}

export function DayTimeline({ lanes, window, zone, now, nowMinutes, showNow, detail }: DayTimelineProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const localized = (text: LocalizedLabel) => labelIn(text, language)
  const labelled = lanes.some((lane) => lane.label !== undefined)
  const nowAt = showNow ? nowOffset(window, nowMinutes) : null

  const detailOf = (lesson: Lesson) => {
    const room = lesson.room ? lesson.room.code : t('dashboard.online')
    const teacher = lesson.teacher ? lesson.teacher.fullName : t('dashboard.noTeacher')
    if (detail === 'room') return room
    if (detail === 'teacher') return teacher
    return `${room} · ${teacher}`
  }

  return (
    <div className="dt-scroll">
      <div className={labelled ? 'dt dt--labelled' : 'dt'}>
        <div className="dt-hours tabular-nums" aria-hidden="true">
          {labelled ? <span className="dt-label" /> : null}
          <div className="dt-hours__track">
            {hoursOf(window).map((hour, index, all) => (
              <span key={hour} style={{ insetInlineStart: `${(index / all.length) * 100}%` }}>
                {String(hour).padStart(2, '0')}
              </span>
            ))}
          </div>
        </div>
        {lanes.map((lane) => (
          <div className="dt-lane" key={lane.key}>
            {labelled ? <div className="dt-label">{lane.label}</div> : null}
            <div className="dt-track" style={{ backgroundSize: `${100 / hoursOf(window).length}% 100%` }}>
              {lane.lessons.map((lesson) => {
                const at = place(lesson, window, zone)
                const state = lessonState(lesson, now)
                const times = formatLessonTimes(lesson.startsAt, lesson.endsAt, language, zone)
                return (
                  <Link
                    key={lesson.id}
                    to="/lessons"
                    className={`dt-block dt-block--${state}`}
                    style={{ insetInlineStart: `${at.offset * 100}%`, width: `calc(${at.size * 100}% - 4px)` }}
                    title={`${localized(lesson.class.name)} — ${times} — ${t(`dashboard.state.${state}`)}`}
                  >
                    <b>{localized(lesson.class.name)}</b>
                    <span>{state === 'needsAttendance' || state === 'cancelled' ? t(`dashboard.state.${state}`) : detailOf(lesson)}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
        {nowAt !== null ? (
          <div className={labelled ? 'dt-now-layer dt-now-layer--labelled' : 'dt-now-layer'} aria-hidden="true">
            <div className="dt-now" style={{ insetInlineStart: `${nowAt * 100}%` }}>
              <span>{t('dashboard.now')}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
