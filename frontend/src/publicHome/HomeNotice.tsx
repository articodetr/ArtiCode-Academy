// A state of a /home section that has no cards to show — the catalog closed to
// visitors, a failed read, no published program — as one designed panel: an icon
// in a soft circle, a heading-sized title, the explanation and at most one
// action (PORTAL-04 PR-1 redesign). `tone` only colours it; the words come from
// the caller. An error panel is announced (`role="alert"`), the others are not.
import type { ReactNode } from 'react'

export function HomeNotice({
  tone,
  icon,
  title,
  text,
  action,
  testId,
}: {
  tone: 'info' | 'error' | 'neutral'
  icon: ReactNode
  title: string
  text: string
  action?: ReactNode
  testId?: string
}) {
  return (
    <div className={`public-home__notice public-home__notice--${tone}`} data-testid={testId} role={tone === 'error' ? 'alert' : undefined}>
      <span className="public-home__notice-icon" aria-hidden="true">
        {icon}
      </span>
      <p className="public-home__notice-title">{title}</p>
      <p className="public-home__notice-text">{text}</p>
      {action ? <div className="public-home__notice-action">{action}</div> : null}
    </div>
  )
}
