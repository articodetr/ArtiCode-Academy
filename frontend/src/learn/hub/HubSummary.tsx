// The summary header of «دروسي» for a student (J-F64; J-F67): the title and the learner's courses, lessons and
// completed lessons over the courses they study (`studyCourses()`). Every count is API-229's (D-R133), or the latest
// answer of a lessons panel on the page (`live`); a pending or failed read shows a dash.
import { BookOutlined, CheckSquareOutlined, PlayCircleOutlined, ReadOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { MyLearningCourse, ProgressCounts } from '../../api/learning'
import { hubTotals } from './hub.view'

export function HubSummary({ courses, live }: { courses: readonly MyLearningCourse[] | null; live: Readonly<Record<string, ProgressCounts>> }) {
  const { t } = useTranslation()
  const totals = courses ? hubTotals(courses, live) : null

  return (
    <header className="hub-header">
      <div className="hub-header__info">
        <h1 className="hub-header__title">
          <ReadOutlined aria-hidden /> {t('myLessons.hub.title')}
        </h1>
        <p className="hub-header__text">{t('myLessons.hub.description')}</p>
      </div>
      <div className="hub-stats">
        <Stat icon={<BookOutlined aria-hidden />} value={totals?.courses ?? null} label={t('myLessons.hub.stats.courses')} />
        <Stat icon={<PlayCircleOutlined aria-hidden />} value={totals?.lessons ?? null} label={t('myLessons.hub.stats.lessons')} />
        <Stat icon={<CheckSquareOutlined aria-hidden />} value={totals?.completed ?? null} label={t('myLessons.hub.stats.completed')} />
      </div>
    </header>
  )
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number | null; label: string }) {
  return (
    <div className="hub-stat">
      {icon}
      <div>
        <strong className="hub-stat__value">{value ?? '—'}</strong>
        <span className="hub-stat__label">{label}</span>
      </div>
    </div>
  )
}
