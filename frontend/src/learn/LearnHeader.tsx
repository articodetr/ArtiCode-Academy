// The focused header of the course player (MOD-20): the academy's brand
// (small), the way back to «مدرستي», the language, on a narrow screen the
// button that opens the curriculum drawer, the breadcrumb مدرستي › course ›
// level › lesson, and the course progress as the server computed it (D-R135 —
// a bar with the percent and «n من m» of the required lessons).
import { ArrowLeftOutlined, ArrowRightOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { Breadcrumb, Button } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ProgressCounts } from '../api/learning'
import { useAcademyBrand } from '../academy/useAcademyBrand'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useLocalized } from '../i18n/useLocalized'

function LearnBrand() {
  const { name, logoSrc } = useAcademyBrand()
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null)
  const logo = logoSrc !== null && logoSrc !== brokenLogo ? logoSrc : null
  return (
    <div className="learn-brand">
      {logo ? <img className="learn-brand__logo" src={logo} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setBrokenLogo(logo)} /> : null}
      <bdi dir="auto" className="learn-brand__name" title={name || undefined}>
        {name}
      </bdi>
    </div>
  )
}

export function CourseProgressBar({ progress }: { progress: ProgressCounts }) {
  const { t } = useTranslation()
  if (progress.percent === null || progress.required === 0) {
    return (
      <div className="learn-progress">
        <span className="learn-muted">{t('learn.progress.noRequired')}</span>
      </div>
    )
  }
  const percent = Math.max(0, Math.min(100, progress.percent))
  const count = t('learn.progress.lessons', { count: progress.required, completed: progress.completedRequired })
  return (
    <div className="learn-progress">
      <div
        className="learn-progress__bar"
        role="progressbar"
        aria-label={t('learn.progress.label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${t('learn.progress.percent', { percent })} — ${count}`}
      >
        <span className="learn-progress__fill" style={{ inlineSize: `${percent}%` }} />
      </div>
      <span className="learn-progress__percent" data-testid="learn-course-percent">
        {t('learn.progress.percent', { percent })}
      </span>
      <span className="learn-muted learn-progress__count">{count}</span>
    </div>
  )
}

export interface LearnHeaderProps {
  /** Breadcrumb entries after «مدرستي» (course, level, lesson) — only those known. */
  trail?: readonly string[]
  progress?: ProgressCounts | null
  /** On a narrow screen: opens the curriculum drawer. */
  onOpenContents?: () => void
  /** Extra content under the bar (none by default). */
  children?: ReactNode
}

export function LearnHeader({ trail = [], progress = null, onOpenContents, children }: LearnHeaderProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const rtl = language === 'ar'
  const items = [
    { key: 'school', title: <Link to="/my-school">{t('learn.header.mySchool')}</Link> },
    ...trail.map((entry, index) => ({ key: `trail-${index}`, title: <bdi dir="auto">{entry}</bdi> })),
  ]
  return (
    <header className="learn-header">
      <div className="learn-header__row">
        <LearnBrand />
        <Link className="learn-header__back" to="/my-school">
          {rtl ? <ArrowRightOutlined aria-hidden /> : <ArrowLeftOutlined aria-hidden />}
          <span>{t('learn.header.backToMySchool')}</span>
        </Link>
        <span className="learn-header__spacer" />
        {onOpenContents ? (
          <Button icon={<UnorderedListOutlined aria-hidden />} onClick={onOpenContents}>
            {t('learn.header.openContents')}
          </Button>
        ) : null}
        <LanguageSwitcher />
      </div>
      {trail.length > 0 ? (
        <Breadcrumb className="learn-header__crumbs" aria-label={t('learn.header.breadcrumb')} separator="›" items={items} />
      ) : null}
      {progress ? <CourseProgressBar progress={progress} /> : null}
      {children}
    </header>
  )
}
