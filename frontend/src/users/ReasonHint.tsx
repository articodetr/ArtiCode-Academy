import { useTranslation } from 'react-i18next'

/**
 * The hint under the optional reason field of the account-action confirmations (UserStatusActions and
 * UserMfaReset). The field's «n / 500» counter sits at the end of the hint's first line, so the hint keeps
 * clear of that corner: at 390 px a wrapped hint ran under the counter (seen in a real browser — KI-091).
 */
export function ReasonHint() {
  const { t } = useTranslation()
  return <span style={{ display: 'block', paddingInlineEnd: 72 }}>{t('users.status.reasonHint')}</span>
}
