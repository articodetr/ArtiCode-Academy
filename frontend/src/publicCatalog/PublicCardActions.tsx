// The action at the foot of a public course card: «عرض الدورة», full width at the very bottom. It repeats the card's
// stretched link for the pointer, so it stays out of the tab order and the accessibility tree. Subscribing starts on
// the course page, beside «سجّل في هذه الدورة» (PublicCoursePage), not on the card.
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useLocalized } from '../i18n/useLocalized'

/** The small arrow of «عرض الدورة»: it points the way the language reads. */
export function CardArrow() {
  const { language } = useLocalized()
  return language === 'ar' ? <ArrowLeftOutlined aria-hidden="true" /> : <ArrowRightOutlined aria-hidden="true" />
}

export function PublicCardActions({ href }: { href: string | null }) {
  const { t } = useTranslation()
  // A card without a page of its own is a plain preview.
  if (href === null) return null

  return (
    <div className="public-card__foot">
      <Link to={href} className="public-card__action" tabIndex={-1} aria-hidden="true">
        {t('publicCatalog.card.viewCourse')}
        <CardArrow />
      </Link>
    </div>
  )
}
