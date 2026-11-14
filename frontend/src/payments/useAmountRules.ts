import { useTranslation } from 'react-i18next'
import { MONEY_MAX } from '../api/payments'
import { isTwoDecimalAmount } from './payments.format'

/** The amount rule of a line or an installment: 0.01..MONEY_MAX with two decimals (`IsDecimalNumber(2)`). */
export function useAmountRules() {
  const { t } = useTranslation()
  return [
    { required: true, message: t('payments.form.amountRequired') },
    {
      validator: (_: unknown, value: unknown) =>
        value === null || value === undefined || (isTwoDecimalAmount(value) && value >= 0.01 && value <= MONEY_MAX)
          ? Promise.resolve()
          : Promise.reject(new Error(t('payments.form.amountInvalid'))),
    },
  ]
}
