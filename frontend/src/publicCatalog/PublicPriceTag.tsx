// The price of a public course (MOD-19's course price, D-R122/D-R138): «مجانية» for a free course (`pricing`), the
// amount in its currency for a paid one — kept left to right inside the Arabic text — and «السعر غير متاح حالياً» for a
// paid course whose plan cannot price a request now (`price` null). A paid course never reads as free.
// Two looks of the same rule: a tag (the course page's facts) and plain text (the foot of a course card — PORTAL-04).
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { PublicCourseCard } from '../api/publicCatalog'
import { useLocalized } from '../i18n/useLocalized'
import { formatMoney } from '../payments/payments.format'

type Priced = Pick<PublicCourseCard, 'pricing' | 'price'>

/** Which of the three prices a course shows. */
function priceKindOf(course: Priced): 'free' | 'unavailable' | 'amount' {
  if (course.pricing === 'free') return 'free'
  return course.price ? 'amount' : 'unavailable'
}

function useAmount(course: Priced) {
  const { language } = useLocalized()
  return course.price ? <bdi dir="ltr">{formatMoney(course.price.amount, course.price.currency, language)}</bdi> : null
}

export function PublicPriceTag({ course }: { course: Priced }) {
  const { t } = useTranslation()
  const amount = useAmount(course)
  const kind = priceKindOf(course)
  if (kind === 'free') return <Tag color="green">{t('publicCatalog.card.free')}</Tag>
  if (kind === 'unavailable') return <Tag color="orange">{t('publicCatalog.card.priceUnavailable')}</Tag>
  return <Tag color="gold">{amount}</Tag>
}

export function PublicPriceText({ course }: { course: Priced }) {
  const { t } = useTranslation()
  const amount = useAmount(course)
  const kind = priceKindOf(course)
  return (
    <span className={`public-price public-price--${kind}`} data-testid="public-price">
      {kind === 'free' ? t('publicCatalog.card.free') : kind === 'unavailable' ? t('publicCatalog.card.priceUnavailable') : amount}
    </span>
  )
}
