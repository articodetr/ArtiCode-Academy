// The price of a public course (MOD-19's course price, D-R122/D-R138): «مجانية» for a free course (`pricing`), the
// amount in its currency for a paid one — kept left to right inside the Arabic text — and «السعر غير متاح حالياً» for a
// paid course whose plan cannot price a request now (`price` null). A paid course never reads as free.
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { PublicCourseCard } from '../api/publicCatalog'
import { useLocalized } from '../i18n/useLocalized'
import { formatMoney } from '../payments/payments.format'

export function PublicPriceTag({ course }: { course: Pick<PublicCourseCard, 'pricing' | 'price'> }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  if (course.pricing === 'free') return <Tag color="green">{t('publicCatalog.card.free')}</Tag>
  if (!course.price) return <Tag color="orange">{t('publicCatalog.card.priceUnavailable')}</Tag>
  return (
    <Tag color="gold">
      <bdi dir="ltr">{formatMoney(course.price.amount, course.price.currency, language)}</bdi>
    </Tag>
  )
}
