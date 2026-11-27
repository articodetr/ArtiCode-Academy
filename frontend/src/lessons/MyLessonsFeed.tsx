// A guardian's «دروسي» since J-F67 (CH-0243, Jallal's request; a student gets the course panels instead —
// `learn/hub/AllCoursesLessons.tsx`): every lesson of their children's classes from API-101, newest first, drawn like the lessons panel of a course in «دوراتي» (`learn/hub/hub.css`:
// the panel head with its pills, one rounded row per lesson with its badges and one button). One row per lesson ×
// student, as the table it replaces (`MyLessonsList`, which one class's page keeps). The pills are the list's views:
// «كل الدروس» (newest first — the default), «اليوم والقادمة» (oldest first) and «السابقة» (newest first). Each row
// shows its times in the lesson's own zone and the days are the academy's (D-R41) — without the note naming the zones
// that the table shows (removed at Jallal's request); the student's OWN attendance only,
// never the teacher's note (the DTO does not carry it). Pages follow the server's cursor. Since J-F80 a student's
// «دروسي» shows this feed too (`variant: 'student'` — its own title and hint: the class lessons their teachers add),
// and every row (`MyLessonRow` — shared with «دوراتي» since J-F81) that is not cancelled offers the lesson's video («مشاهدة الفيديو») beside the join link and lists
// its books and links (J-F77).
import { Alert, Button, Skeleton } from 'antd'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/auth-context'
import type { useMyClasses } from '../enrollments/useMyClasses'
import { describeLessonsFailure, failureMessage } from './lessons.errors'
import { MyLessonRow } from './MyLessonRow'
import { myLessonKey, showsStudents } from './myLessons.view'
import type { MyLessonView } from './myLessons.view'
import { useMyLessons } from './useMyLessons'

/** The views the pills offer; a custom range stays on one class's page. */
const FEED_VIEWS: readonly MyLessonView[] = ['all', 'upcoming', 'past']

interface MyLessonsFeedProps {
  /** The zone of «today»: the academy's, or this device's when the academy could not be read. */
  dayZone: string
  /** «My courses» (API-060): it tells a learner without any enrollment why the list is empty. */
  myClasses: ReturnType<typeof useMyClasses>
  /** J-F80: `student` = the class lessons panel of a student's «دروسي» (its own title and hint); a guardian's feed by default. */
  variant?: 'guardian' | 'student'
}

export function MyLessonsFeed({ dayZone, myClasses, variant = 'guardian' }: MyLessonsFeedProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const list = useMyLessons(dayZone)
  const { filters } = list
  const showStudent = showsStudents(user?.roles ?? [], list.items)
  const failure = list.error ? describeLessonsFailure(list.error) : null
  const noEnrollment = !myClasses.loading && !myClasses.error && myClasses.items.length === 0
  const student = variant === 'student'
  const title = t(student ? 'myLessons.feed.classTitle' : 'myLessons.feed.title')
  const emptyText = noEnrollment ? t('myLessons.empty.noEnrollment') : t(`myLessons.empty.${filters.view === 'range' ? 'all' : filters.view}`)

  return (
    <section className="hub-panel" aria-label={title}>
      <div className="hub-panel__head">
        <div>
          <h2 className="hub-panel__title">{title}</h2>
          <p className="hub-panel__hint">{t(student ? 'myLessons.feed.classHint' : filters.view === 'upcoming' ? 'myLessons.feed.hintUpcoming' : 'myLessons.feed.hint')}</p>
        </div>
        <div className="hub-panel__tools">
          <div className="hub-pills" role="group" aria-label={t('myLessons.views.label')}>
            {FEED_VIEWS.map((view) => (
              <button
                key={view}
                type="button"
                className={`hub-pill${filters.view === view ? ' is-active' : ''}`}
                aria-pressed={filters.view === view}
                // «كل الدروس» is newest first here; the other two fix their own order.
                onClick={() => list.setFilters(view === 'all' ? { view, order: 'desc' } : { view })}
              >
                {t(`myLessons.views.${view}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={() => (failure.key.endsWith('cursor_invalid') ? list.setFilters({}) : list.reload())}>
              {t('myLessons.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {list.loading && list.items.length === 0 ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : list.items.length === 0 ? (
        failure ? null : (
          <div className="hub-empty">
            <h3>{emptyText}</h3>
          </div>
        )
      ) : (
        <ol className="hub-list" aria-busy={list.loading}>
          {list.items.map((item) => (
            <MyLessonRow key={myLessonKey(item)} item={item} showStudent={showStudent} />
          ))}
        </ol>
      )}

      {list.canGoBack || list.nextCursor ? (
        <div className="hub-feed__pages">
          <button type="button" className="hub-btn hub-btn--open" onClick={list.back} disabled={!list.canGoBack || list.loading}>
            {t('lessons.pagination.previous')}
          </button>
          <span>{t('lessons.pagination.page', { page: list.pageNumber })}</span>
          <button type="button" className="hub-btn hub-btn--open" onClick={list.next} disabled={!list.nextCursor || list.loading}>
            {t('lessons.pagination.next')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
