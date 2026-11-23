// The exams of the learner home (J-F63): what can be taken now with «start the exam» — the same control and the same
// confirmation as «my exams» (OnlineTake, StartAttemptModal), which read the server's `canStart`, `inProgress` and
// `blocker` — then what is announced. A guardian sees the state and never a button (the server's `not_self`).
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { MyExamItem } from '../api/myExams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { examTitle } from '../exams/exams.format'
import { myExamKey } from '../exams/myExams.view'
import type { OnlineMyExamItem } from '../exams/myExams.view'
import { useLocalized } from '../i18n/useLocalized'
import { formatClock } from '../lessons/lessons.format'
import { OnlineTake } from '../takeExam/MyExamOnline'
import { StartAttemptModal } from '../takeExam/StartAttemptModal'
import { labelIn, wallDate } from './dashboard.data'
import { daysUntil, examBoardOf } from './learner.data'
import { Loading, Panel } from './LearnerPanel'
import type { DayContext, StudentName } from './LearnerPanel'
import type { Reloadable } from './useLoad'

interface ExamsPanelProps {
  exams: Reloadable<MyExamItem[]>
  day: DayContext
  showStudent: boolean
  studentName: StudentName
}

export function ExamsPanel({ exams, day, showStudent, studentName }: ExamsPanelProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [starting, setStarting] = useState<OnlineMyExamItem | null>(null)
  const localized = (text: Parameters<typeof labelIn>[0]) => labelIn(text, language)
  const board = exams.data ? examBoardOf(exams.data, day.zone, day.today) : null

  // An exam whose opening time has just passed: the server is asked once, and its answer decides.
  const opened = (board?.upcoming ?? [])
    .filter((item) => item.online?.blocker === 'not_open_yet' && item.scheduledAt !== null && Date.parse(item.scheduledAt) <= day.now)
    .map(myExamKey)
    .join(',')
  const asked = useRef('')
  const { retry } = exams
  useEffect(() => {
    if (!opened || asked.current === opened) return
    asked.current = opened
    retry()
  }, [opened, retry])

  const whenText = (item: MyExamItem) => {
    if (!item.scheduledAt) return ''
    const days = daysUntil(wallDate(item.scheduledAt, day.zone), day.today)
    const time = formatClock(item.scheduledAt, language, item.timeZone)
    if (days <= 0) return t('dashboard.learner.examToday', { time })
    if (days === 1) return t('dashboard.learner.examTomorrow', { time })
    return t('dashboard.learner.examOn', {
      day: new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: item.timeZone }).format(new Date(item.scheduledAt)),
    })
  }
  const who = (item: MyExamItem) => (showStudent ? ` · ${studentName(item.student)}` : '')

  return (
    <Panel title={t('dashboard.learner.exams')} extra={<Link to="/my-exams">{t('dashboard.learner.allExams')}</Link>}>
      <Loading loaded={exams}>
        {() => {
          if (!board || (!board.now.length && !board.upcoming.length)) return <p className="db-muted">{t('dashboard.learner.examsEmpty')}</p>
          return (
            <div className="lh-stack">
              {board.now.map((item) => (
                <article key={myExamKey(item)} className="lh-exam">
                  <div className="lh-exam__head">
                    <span className="lh-pill lh-pill--open">{t('dashboard.learner.examOpen')}</span>
                    <h3>{examTitle(item, language)}</h3>
                    <small>
                      {localized(item.class.name)}
                      {who(item)}
                      {item.online.closesAt ? ` · ${t('dashboard.learner.examCloses', { date: formatZonedDateTime(item.online.closesAt, item.timeZone, language) })}` : ''}
                    </small>
                  </div>
                  <OnlineTake item={item} onStart={setStarting} onStale={exams.retry} startLabel={t('dashboard.learner.startExam')} />
                </article>
              ))}
              {board.upcoming.length ? (
                <div>
                  <h3 className="lh-day">{t('dashboard.learner.examsUpcoming')}</h3>
                  <ul className="db-todo">
                    {board.upcoming.slice(0, 4).map((item) => (
                      <li key={myExamKey(item)}>
                        <span className="db-todo__text">
                          {examTitle(item, language)}
                          <small>
                            {whenText(item)} · {localized(item.class.name)}
                            {who(item)}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {board.upcoming.length > 4 ? (
                    <Link className="lh-more-link" to="/my-exams">
                      {t('dashboard.learner.more', { count: board.upcoming.length - 4 })}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        }}
      </Loading>
      {/* Any refusal of the start means the row is out of date: the list is read again (the dialog words the refusal). */}
      <StartAttemptModal item={starting} onClose={() => setStarting(null)} onRefused={exams.retry} />
    </Panel>
  )
}
