// The frame of a course page, public (/explore/:courseId) or signed in (/catalog/:courseId): a turquoise band with the
// course's title, badges and short text, the enrollment card beside it and running into the white area below, and the
// sections under a bar of links. It holds no rule of its own: each page hands in what the server said and its own
// enrollment controls. A section with no data is simply not handed in, and the bar shows only with two or more.
import type { MouseEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { CourseBadges } from './CourseBadges'
import { CardMedia } from './PublicCourseCard'
import type { CourseBadge } from './publicCatalog.view'
import './publicCatalog.css'
import './publicCourse.css'

export interface CoursePageSection {
  /** The element's id, and the bar link's target. */
  id: string
  label: string
  content: ReactNode
}

export interface CoursePageLayoutProps {
  /** `public` spans the page; `app` sits inside the signed-in layout's content area. */
  variant: 'public' | 'app'
  title: string
  back?: ReactNode
  badges: readonly CourseBadge[]
  /** A short line under the badges: how many lessons and levels. */
  meta?: ReactNode
  summary?: ReactNode
  /** Whether the course takes an enrollment now. */
  status?: ReactNode
  aside: ReactNode
  sections: readonly CoursePageSection[]
  navLabel: string
}

export function CoursePageLayout({ variant, title, back, badges, meta, summary, status, aside, sections, navLabel }: CoursePageLayoutProps) {
  return (
    <div className={`course-page course-page--${variant}`}>
      <div className="course-page__grid">
        <div className="course-page__band" aria-hidden="true" />
        <header className="course-page__hero">
          {back ? <div className="course-page__back">{back}</div> : null}
          <h1 className="course-page__title">
            <bdi>{title}</bdi>
          </h1>
          <CourseBadges badges={badges} className="course-badges--hero" />
          {meta ? <div className="course-page__meta">{meta}</div> : null}
          {summary ? <div className="course-page__summary">{summary}</div> : null}
          {status ? <div className="course-page__status">{status}</div> : null}
        </header>
        <aside className="course-page__aside">{aside}</aside>
        <div className="course-page__body">
          <CourseSectionNav sections={sections} label={navLabel} />
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="course-page__section" aria-labelledby={`${section.id}-title`} tabIndex={-1}>
              <h2 id={`${section.id}-title`} className="course-page__section-title">
                {section.label}
              </h2>
              {section.content}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The white enrollment card: the course's picture (or the plain placeholder), then what the page puts in it. */
export function CourseEnrollCard({ courseId, coverUrl, children, testId }: { courseId: string; coverUrl: string | null; children: ReactNode; testId?: string }) {
  return (
    <div className="course-enroll" data-testid={testId}>
      <CardMedia id={courseId} url={coverUrl} />
      <div className="course-enroll__body">{children}</div>
    </div>
  )
}

function CourseSectionNav({ sections, label }: { sections: readonly CoursePageSection[]; label: string }) {
  const ids = sections.map((section) => section.id).join(' ')
  const [active, setActive] = useState<string | null>(null)

  // The section being read lights its link. No observer (an old browser, the tests): the link last pressed stays lit.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const order = ids.split(' ')
    // An observer reports only the sections that changed, so the ones in view are remembered between its calls.
    const inView = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inView.add(entry.target.id)
          else inView.delete(entry.target.id)
        }
        const first = order.find((id) => inView.has(id))
        if (first) setActive(first)
      },
      { rootMargin: '-140px 0px -55% 0px' },
    )
    for (const id of order) {
      const node = document.getElementById(id)
      if (node) observer.observe(node)
    }
    return () => observer.disconnect()
  }, [ids])

  if (sections.length < 2) return null
  const shown = active ?? sections[0]!.id

  const go = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    // A new tab or window stays the browser's: the link is a real address.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = document.getElementById(id)
    if (!target) return
    // No address change: `?q=` and the back button stay as they were.
    event.preventDefault()
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    target.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    target.focus({ preventScroll: true })
    setActive(id)
  }

  return (
    <nav className="course-page__nav" aria-label={label}>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={section.id === shown ? 'course-page__nav-link course-page__nav-link--active' : 'course-page__nav-link'}
          aria-current={section.id === shown ? 'true' : undefined}
          onClick={(event) => go(event, section.id)}
        >
          {section.label}
        </a>
      ))}
    </nav>
  )
}
