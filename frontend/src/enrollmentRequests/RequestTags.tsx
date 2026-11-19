// The tags of an enrollment request (MOD-19): its payment state and its
// request state, worded by `enrollmentRequests.*` — shown by the requests page
// and by the class roster. The values are the server's.
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { RequestState } from '../api/catalog'
import type { RequestPaymentState } from '../api/enrollments'
import { PAYMENT_STATE_COLORS, REQUEST_STATE_COLORS } from './requests.format'

export function PaymentStateTag({ state }: { state: RequestPaymentState }) {
  const { t } = useTranslation()
  return <Tag color={PAYMENT_STATE_COLORS[state]}>{t(`enrollmentRequests.paymentStates.${state}`)}</Tag>
}

export function RequestStateTag({ state }: { state: RequestState }) {
  const { t } = useTranslation()
  return <Tag color={REQUEST_STATE_COLORS[state]}>{t(`enrollmentRequests.states.${state}`)}</Tag>
}
