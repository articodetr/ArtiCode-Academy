// One quick action of the admin home (J-F59): a whole-card link to an existing page — a large two-tone icon above its
// title. The title is always shown (never the icon alone) and is the link's accessible name; the icon is decorative.
import { Link } from 'react-router'
import type { QuickActionIcon } from './admin.actions'

interface QuickActionCardProps {
  to: string
  title: string
  icon: QuickActionIcon
  twoTone: [string, string]
  /** Hidden on a phone until «show more» (CSS only — admin.css). */
  extra?: boolean
}

export function QuickActionCard({ to, title, icon: Icon, twoTone, extra = false }: QuickActionCardProps) {
  return (
    <li className={extra ? 'admin-action admin-action--extra' : 'admin-action'}>
      <Link to={to} className="admin-action__link">
        <span className="admin-action__icon" aria-hidden>
          <Icon twoToneColor={twoTone} />
        </span>
        <span className="admin-action__title">{title}</span>
      </Link>
    </li>
  )
}
