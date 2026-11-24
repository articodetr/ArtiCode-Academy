// The small badges of a course (courseBadgesOf()): on the picture of its card and at the top of its page.
import { ClockCircleOutlined, ReadOutlined, RiseOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import type { CourseBadge } from './publicCatalog.view'
import './publicCourse.css'

const ICONS: Readonly<Record<CourseBadge['key'], ReactNode>> = {
  type: <ReadOutlined />,
  level: <RiseOutlined />,
  duration: <ClockCircleOutlined />,
}

export function CourseBadges({ badges, className }: { badges: readonly CourseBadge[]; className?: string }) {
  if (badges.length === 0) return null
  return (
    <ul className={className ? `course-badges ${className}` : 'course-badges'}>
      {badges.map((badge) => (
        <li key={badge.key} className={`course-badge course-badge--${badge.key}`}>
          <span className="course-badge__icon" aria-hidden="true">
            {ICONS[badge.key]}
          </span>
          <bdi>{badge.text}</bdi>
        </li>
      ))}
    </ul>
  )
}
