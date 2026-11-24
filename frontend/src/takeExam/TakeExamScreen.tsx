// The page a learner takes an online exam on (MOD-09 phase 2 — roadmap §4r,
// OEX-T07): /take-exam/:attemptId, outside the app layout. It reads the
// learner's own attempt (API-277) and nothing else.
//
// While the attempt is in progress: a sticky header with the exam's title, the
// class, «المحاولة N», where the saving stands and the timer — the SERVER's
// time left (ExamTimer); one question at a time with «السابق» / «التالي» and
// a navigator of numbered buttons; answers that save themselves
// (attemptSession.ts); «مراجعة وتسليم», then a final confirmation before the
// one submit. Leaving never submits and the page says so; while an answer has
// not reached the server, leaving asks first (a reload or a tab close gets the
// browser's own prompt) and a hidden tab sends what is unsaved once more.
// When the time runs out the answers lock and the attempt is closed by the
// server; the finished state (AttemptFinished) shows a result and a review
// only when the server sent them.
//
// Moving between questions, opening the review and the end of the attempt move
// the focus to the heading of what came on screen.
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { Alert, App, Button, Skeleton, Spin } from 'antd'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { AttemptFinished } from './AttemptFinished'
import type { SessionStatus } from './attemptSession'
import { ExamTimer } from './ExamTimer'
import { QuestionCard } from './QuestionCard'
import { QuestionNavigator } from './QuestionNavigator'
import { ReviewPanel } from './ReviewPanel'
import { SaveStatus } from './SaveStatus'
import { openingIndex, unansweredNumbers } from './takeExam.answers'
import { takeFailureMessage } from './takeExam.errors'
import { MY_EXAMS_ROUTE } from './takeExam.format'
import { useAttemptSession } from './useAttemptSession'
import './takeExam.css'

/** The statuses in which the attempt is open on this page. */
function isLive(status: SessionStatus): boolean {
  return status === 'answering' || status === 'submitting' || status === 'closing'
}

const nothingToDiscard = () => undefined

interface FrameProps {
  /** The exam's title once it is known. */
  title: string
  /** The line under the title: the class and the attempt. */
  meta?: ReactNode
  /** The end of the sticky header: the saving and the timer. */
  side?: ReactNode
  children: ReactNode
}

/** J-F67: the screen inside the popup of a lesson's exam (learn/hub) — its window has its own way out and no topbar. */
const EmbeddedContext = createContext(false)

/** The page's own frame: the way back and the language, the sticky header, the content. */
function Frame({ title, meta, side, children }: FrameProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const embedded = useContext(EmbeddedContext)
  return (
    <div className={embedded ? 'take-page take-page--embedded' : 'take-page'}>
      {embedded ? null : (
      <div className="take-topbar">
        <Link to={MY_EXAMS_ROUTE} className="take-back-link">
          {language === 'ar' ? <ArrowRightOutlined aria-hidden /> : <ArrowLeftOutlined aria-hidden />}
          <span>{t('takeExam.page.back')}</span>
        </Link>
        <span className="take-topbar__spacer" />
        <LanguageSwitcher />
      </div>
      )}
      <header className="take-header">
        <div className="take-header__titles">
          <h1 className="take-header__title">
            <bdi dir="auto">{title}</bdi>
          </h1>
          {meta ? <p className="take-header__meta">{meta}</p> : null}
        </div>
        {side ? <div className="take-header__side">{side}</div> : null}
      </header>
      <main className="take-main" id="take-main">
        <div className="take-main__inner">{children}</div>
      </main>
    </div>
  )
}

interface TakeExamScreenProps {
  attemptId: string
  /** J-F67: inside the popup of a lesson's exam — no topbar (the popup closes itself). */
  embedded?: boolean
  /** J-F67: whether an answer has not reached the server yet, for the popup that holds the screen. */
  onUnsavedChange?: (unsaved: boolean) => void
}

export function TakeExamScreen({ embedded = false, ...props }: TakeExamScreenProps) {
  return (
    <EmbeddedContext.Provider value={embedded}>
      <TakeExamBody {...props} />
    </EmbeddedContext.Provider>
  )
}

function TakeExamBody({ attemptId, onUnsavedChange }: Omit<TakeExamScreenProps, 'embedded'>) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { modal } = App.useApp()
  const { session, snapshot } = useAttemptSession(attemptId)
  const { status, attempt, answers, save } = snapshot

  const [view, setView] = useState<'questions' | 'review'>('questions')
  // The question on screen; set once, when the attempt is first known (the first one without an answer).
  const [index, setIndex] = useState<number | null>(null)
  if (index === null && attempt !== null && status === 'answering') setIndex(openingIndex(attempt.questions, answers))
  // A «refresh» of the stalled state that changed nothing: say so.
  const [refreshFailed, setRefreshFailed] = useState(false)

  const questionHeading = useRef<HTMLHeadingElement>(null)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const outcomeHeading = useRef<HTMLHeadingElement>(null)
  /** The heading to focus once the question or the review the learner asked for is on screen. */
  const pendingFocus = useRef<'question' | 'review' | null>(null)
  /** The final confirmation on screen, if any (one at a time). */
  const confirmation = useRef<{ destroy: () => void } | null>(null)

  useEffect(() => {
    if (pendingFocus.current === 'question') questionHeading.current?.focus()
    else if (pendingFocus.current === 'review') reviewHeading.current?.focus()
    pendingFocus.current = null
  }, [index, view])

  // The attempt ended on this page: the confirmation (if open) goes, and the focus moves to what replaced the questions.
  const previousStatus = useRef(status)
  useEffect(() => {
    const before = previousStatus.current
    previousStatus.current = status
    if (before === status || !isLive(before)) return
    if (status !== 'answering' && status !== 'submitting') {
      confirmation.current?.destroy()
      confirmation.current = null
    }
    if (status === 'closing' || status === 'stalled' || status === 'finished') outcomeHeading.current?.focus()
  }, [status])

  // While an answer has not reached the server: a router navigation asks first, a reload or a tab close gets the
  // browser's own prompt. Leaving itself sends what is unsaved once more (the session's stop()).
  const unsaved = isLive(status) && save.unsaved
  const { holdNavigation } = useUnsavedChangesGuard(unsaved, nothingToDiscard, 'takeExam.leave.unsaved')
  useEffect(() => {
    onUnsavedChange?.(unsaved)
  }, [unsaved, onUnsavedChange])
  useEffect(() => () => onUnsavedChange?.(false), [onUnsavedChange])

  // --- Before the attempt is known ------------------------------------------------------------------------------
  if (status === 'not_found') {
    return (
      <Frame title={t('takeExam.title')}>
        <section className="take-card take-notice" data-testid="attempt-not-found">
          <h2 className="take-notice__title">{t('takeExam.page.notFoundTitle')}</h2>
          <p>{t('takeExam.page.notFoundText')}</p>
          <p>
            <Link to={MY_EXAMS_ROUTE} className="take-back-link">
              {t('takeExam.page.back')}
            </Link>
          </p>
        </section>
      </Frame>
    )
  }
  if (attempt === null) {
    return (
      <Frame title={t('takeExam.title')}>
        {status === 'failed' ? (
          <Alert
            type="error"
            showIcon
            title={t('takeExam.page.loadFailed')}
            description={snapshot.loadFailure ? takeFailureMessage(t, snapshot.loadFailure) : undefined}
            action={
              <Button size="small" onClick={session.reload}>
                {t('takeExam.page.retry')}
              </Button>
            }
          />
        ) : (
          <div role="status" aria-label={t('takeExam.page.loading')}>
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        )}
      </Frame>
    )
  }

  // --- The attempt ------------------------------------------------------------------------------------------------
  const { exam, questions } = attempt
  const zone = exam.timeZone
  const formatInstant = (iso: string) => formatZonedDateTime(iso, zone, language)
  const title = localizedLabel(exam.title, language)
  const meta = (
    <>
      <bdi dir="ltr">{exam.class.code}</bdi>
      {' — '}
      <bdi dir="auto">{localizedLabel(exam.class.name, language)}</bdi>
      {' · '}
      <span data-testid="attempt-number">{t('takeExam.page.attemptNo', { number: attempt.attemptNo })}</span>
    </>
  )

  if (status === 'finished') {
    return (
      <Frame title={title} meta={meta}>
        <AttemptFinished attempt={attempt} endedBy={snapshot.endedBy} lostAnswers={snapshot.lostAnswers} headingRef={outcomeHeading} />
      </Frame>
    )
  }

  if (status === 'stalled') {
    const byClock = snapshot.endedBy !== 'elsewhere'
    return (
      <Frame title={title} meta={meta}>
        <section className="take-card take-notice" data-testid="attempt-stalled">
          <h2 ref={outcomeHeading} tabIndex={-1} className="take-notice__title">
            {t(byClock ? 'takeExam.timeUp.stalledTitle' : 'takeExam.timeUp.closedTitle')}
          </h2>
          <p>{t(byClock ? 'takeExam.timeUp.stalledText' : 'takeExam.timeUp.closedText')}</p>
          {refreshFailed && !snapshot.refreshing ? <p className="take-muted">{t('takeExam.timeUp.refreshFailed')}</p> : null}
          <p>
            <Button
              type="primary"
              loading={snapshot.refreshing}
              onClick={() => {
                setRefreshFailed(false)
                void session.refresh().then(() => setRefreshFailed(session.getSnapshot().status === 'stalled'))
              }}
            >
              {t('takeExam.timeUp.refresh')}
            </Button>
          </p>
        </section>
      </Frame>
    )
  }

  const timer = <ExamTimer sync={snapshot.clock} active={status === 'answering' || status === 'submitting'} onElapsed={session.timeElapsed} onDisagreement={session.resync} />

  if (status === 'closing') {
    return (
      <Frame title={title} meta={meta} side={timer}>
        <section className="take-card take-notice" data-testid="attempt-closing">
          <h2 ref={outcomeHeading} tabIndex={-1} className="take-notice__title">
            {t('takeExam.timer.over')}
          </h2>
          <div className="take-status-line" role="status">
            <Spin size="small" />
            <span>{t('takeExam.timeUp.closing')}</span>
          </div>
        </section>
      </Frame>
    )
  }

  // --- In progress: answers are taken (or locked while the confirmed submit runs) ----------------------------------
  const locked = status !== 'answering'
  const last = questions.length - 1
  const current = Math.min(Math.max(index ?? 0, 0), Math.max(last, 0))
  const question = questions[current]
  const saveFailing = save.state === 'retrying' || save.state === 'held'

  const goTo = (target: number) => {
    if (view === 'questions' && target === current) {
      questionHeading.current?.focus()
      return
    }
    pendingFocus.current = 'question'
    setView('questions')
    setIndex(target)
  }

  const openReview = () => {
    pendingFocus.current = 'review'
    setView('review')
  }

  // The submit is final: ask once more, saying how many questions hold no answer.
  const askSubmit = () => {
    if (confirmation.current !== null || status !== 'answering') return
    const unanswered = unansweredNumbers(questions, answers).length
    const settle = () => {
      confirmation.current = null
    }
    confirmation.current = modal.confirm({
      title: t('takeExam.submit.confirmTitle'),
      content: (
        <>
          <p>{t('takeExam.submit.confirmFinal')}</p>
          <p>{unanswered === 0 ? t('takeExam.review.allAnswered') : t('takeExam.submit.confirmUnanswered', { count: unanswered })}</p>
        </>
      ),
      okText: t('takeExam.submit.confirmOk'),
      cancelText: t('takeExam.submit.confirmCancel'),
      onOk: () => {
        settle()
        void session.submit()
      },
      onCancel: settle,
    })
  }

  const submitFailure = snapshot.submitFailure
  const requestFailed = submitFailure !== null && submitFailure.key !== 'takeExam.submit.unsavedBlocked' && submitFailure.key !== 'takeExam.submit.failed'

  return (
    <Frame
      title={title}
      meta={meta}
      side={
        <>
          <SaveStatus save={save} onRetry={session.retrySave} />
          {timer}
        </>
      }
    >
      <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />

      {snapshot.answersReset ? <Alert type="warning" showIcon closable onClose={session.dismissAnswersReset} title={t('takeExam.page.answersReset')} data-testid="answers-reset" /> : null}

      {saveFailing ? (
        <Alert
          type="warning"
          showIcon
          title={t(`takeExam.save.${save.state}`)}
          description={
            <>
              {save.failure ? `${takeFailureMessage(t, save.failure, formatInstant)} ` : null}
              {t('takeExam.save.keptHere')}
            </>
          }
          action={
            <Button size="small" onClick={session.retrySave}>
              {t('takeExam.save.retry')}
            </Button>
          }
          data-testid="save-failure"
        />
      ) : null}

      {submitFailure ? (
        <Alert
          type="error"
          showIcon
          title={requestFailed ? t('takeExam.submit.failed') : t(submitFailure.key)}
          description={requestFailed ? takeFailureMessage(t, submitFailure, formatInstant) : undefined}
          data-testid="submit-failure"
        />
      ) : null}

      {exam.description ? (
        <details className="take-card take-instructions">
          <summary>{t('takeExam.page.instructions')}</summary>
          <div dir="auto" className="take-prompt">
            {localizedLabel(exam.description, language)}
          </div>
        </details>
      ) : null}

      {view === 'review' ? (
        <ReviewPanel
          questions={questions}
          answers={answers}
          save={save}
          submitting={status === 'submitting'}
          onBack={() => goTo(current)}
          onPick={goTo}
          onSubmit={askSubmit}
          headingRef={reviewHeading}
        />
      ) : (
        <div className="take-layout">
          <div className="take-layout__question">
            {question ? (
              <QuestionCard
                key={question.id}
                question={question}
                number={current + 1}
                total={questions.length}
                answer={answers.get(question.id)}
                disabled={locked}
                onAnswer={(answer) => session.answer(question.id, answer)}
                headingRef={questionHeading}
              />
            ) : (
              <section className="take-card">
                <p>{t('takeExam.question.none')}</p>
              </section>
            )}
            {locked ? (
              <div className="take-status-line take-muted" role="status">
                <Spin size="small" />
                <span>{t('takeExam.submit.submitting')}</span>
              </div>
            ) : null}
            <nav className="take-steps" aria-label={t('takeExam.question.steps')}>
              <Button onClick={() => goTo(current - 1)} disabled={current <= 0} icon={language === 'ar' ? <ArrowRightOutlined aria-hidden /> : <ArrowLeftOutlined aria-hidden />}>
                {t('takeExam.question.previous')}
              </Button>
              <Button
                onClick={() => goTo(current + 1)}
                disabled={current >= last}
                type={current >= last ? 'default' : 'primary'}
                icon={language === 'ar' ? <ArrowLeftOutlined aria-hidden /> : <ArrowRightOutlined aria-hidden />}
                iconPlacement="end"
              >
                {t('takeExam.question.next')}
              </Button>
              <span className="take-steps__spacer" />
              <Button type={current >= last ? 'primary' : 'default'} onClick={openReview} data-testid="open-review">
                {t('takeExam.review.open')}
              </Button>
            </nav>
          </div>
          <QuestionNavigator questions={questions} answers={answers} current={current} onPick={goTo} />
        </div>
      )}

      <p className="take-leave-note">{t('takeExam.page.leaveNote')}</p>
    </Frame>
  )
}
