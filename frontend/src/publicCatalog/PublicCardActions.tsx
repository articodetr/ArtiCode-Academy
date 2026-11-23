// The buttons at the foot of a public course card: «اشترك مجانًا» or «طلب الاشتراك»
// beside «التفاصيل». Subscribing never happens from the card: a class has to be
// chosen and confirmed, so the button leads a visitor through the sign-in (keeping
// the course) and a student straight to that course's classes. It shows only while
// the server says the course takes an enrollment now and only to whoever can enroll
// — never to staff or to a guardian. «التفاصيل» repeats the card's stretched link for
// the pointer, so it stays out of the tab order and the accessibility tree; the
// subscribe button is a real link of its own, named with the course.
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { PublicCourseCard } from '../api/publicCatalog'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { cardSubscribeTarget } from './publicCatalog.view'
import { viewerOf } from './publicViewer'

export function PublicCardActions({ card, name, href }: { card: PublicCourseCard; name: string; href: string | null }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { status, user } = useAuth()
  // A card without a page of its own is a plain preview.
  if (href === null) return null
  const target = cardSubscribeTarget(card, viewerOf(status, user), user?.roles.includes('student') ?? false)
  const label = t(card.pricing === 'paid' ? 'publicCatalog.card.subscribePaid' : 'publicCatalog.card.subscribeFree')

  return (
    <div className={target ? 'public-card__buttons public-card__buttons--two' : 'public-card__buttons'}>
      {target ? (
        <Link to={target.to} state={target.state} className="public-card__subscribe" aria-label={`${label}: ${name}`} data-testid={`public-subscribe-${card.id}`}>
          {label}
        </Link>
      ) : null}
      <Link to={href} className="public-card__action" tabIndex={-1} aria-hidden="true">
        {t('publicCatalog.list.details')}
        {language === 'ar' ? <ArrowLeftOutlined /> : <ArrowRightOutlined />}
      </Link>
    </div>
  )
}
