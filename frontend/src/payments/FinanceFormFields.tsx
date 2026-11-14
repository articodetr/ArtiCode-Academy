// Form.List editors shared by the fee plan modal and the draft invoice forms
// (MOD-11): the lines (description in Arabic, optional English, and an amount)
// and the installments of a draft (an amount and a due day). The fee plan's
// installment shares live in FeePlanModal. Each list re-runs its rules on every
// edit through the parent's `dependencies`, so a sum problem goes away as soon
// as it is fixed.
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Flex, Form, Input, InputNumber, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { FEE_PLAN_INSTALLMENTS_MAX, FEE_PLAN_LINES_MAX } from '../api/feePlans'
import { useAmountRules } from './useAmountRules'

export function LinesField({ currency }: { currency: string }) {
  const { t } = useTranslation()
  const amountRules = useAmountRules()
  return (
    <Form.List
      name="lines"
      rules={[{ validator: (_, lines: unknown[] | undefined) => (lines && lines.length > 0 ? Promise.resolve() : Promise.reject(new Error(t('payments.problems.no_lines')))) }]}
    >
      {(fields, { add, remove }, { errors }) => (
        <Flex vertical gap={4}>
          <Typography.Text strong>{t('payments.form.lines')}</Typography.Text>
          {fields.map((field, index) => (
            <Flex key={field.key} gap={8} align="start" wrap className="finance-form-row">
              <Form.Item
                name={[field.name, 'descriptionAr']}
                rules={[
                  { required: true, whitespace: true, message: t('payments.form.descriptionRequired') },
                  { max: 200, message: t('payments.record.tooLong', { max: 200 }) },
                ]}
                style={{ flex: '2 1 180px', marginBottom: 8 }}
              >
                <Input placeholder={t('payments.form.descriptionAr')} aria-label={`${t('payments.form.descriptionAr')} ${index + 1}`} dir="auto" />
              </Form.Item>
              <Form.Item name={[field.name, 'descriptionEn']} rules={[{ max: 200, message: t('payments.record.tooLong', { max: 200 }) }]} style={{ flex: '2 1 160px', marginBottom: 8 }}>
                <Input placeholder={t('payments.form.descriptionEn')} aria-label={`${t('payments.form.descriptionEn')} ${index + 1}`} dir="auto" />
              </Form.Item>
              <Form.Item name={[field.name, 'descriptionTr']} hidden>
                <Input />
              </Form.Item>
              <Form.Item name={[field.name, 'amount']} rules={amountRules} style={{ flex: '1 1 120px', marginBottom: 8 }}>
                <InputNumber<number>
                  style={{ width: '100%' }}
                  step={0.01}
                  precision={2}
                  dir="ltr"
                  placeholder={t('payments.form.amount', { currency })}
                  aria-label={`${t('payments.form.amount', { currency })} ${index + 1}`}
                />
              </Form.Item>
              <Button
                type="text"
                icon={<DeleteOutlined />}
                aria-label={t('payments.form.removeLine')}
                disabled={fields.length <= 1}
                onClick={() => remove(field.name)}
              />
            </Flex>
          ))}
          <Form.ErrorList errors={errors} />
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} disabled={fields.length >= FEE_PLAN_LINES_MAX} style={{ alignSelf: 'start' }}>
            {t('payments.form.addLine')}
          </Button>
        </Flex>
      )}
    </Form.List>
  )
}

interface InstallmentsFieldProps {
  currency: string
  /** Problems of the whole list (installments_sum, due_dates_not_ascending, …) as messages. */
  listErrors: string[]
  /** Splits the current total over the rows. */
  onSpread: () => void
}

export function InstallmentsField({ currency, listErrors, onSpread }: InstallmentsFieldProps) {
  const { t } = useTranslation()
  const amountRules = useAmountRules()
  return (
    <Form.List name="installments">
      {(fields, { add, remove }) => (
        <Flex vertical gap={4}>
          <Flex justify="space-between" align="center" wrap gap={8}>
            <Typography.Text strong>{t('payments.form.installments')}</Typography.Text>
            <Button size="small" onClick={onSpread}>
              {t('payments.form.spread')}
            </Button>
          </Flex>
          {fields.map((field, index) => (
            <Flex key={field.key} gap={8} align="start" wrap className="finance-form-row">
              <Typography.Text type="secondary" style={{ minWidth: 20, paddingTop: 5 }}>
                {index + 1}
              </Typography.Text>
              <Form.Item name={[field.name, 'amount']} rules={amountRules} style={{ flex: '1 1 140px', marginBottom: 8 }}>
                <InputNumber<number>
                  style={{ width: '100%' }}
                  step={0.01}
                  precision={2}
                  dir="ltr"
                  placeholder={t('payments.form.amount', { currency })}
                  aria-label={`${t('payments.form.installmentAmount')} ${index + 1}`}
                />
              </Form.Item>
              <Form.Item name={[field.name, 'dueOn']} rules={[{ required: true, message: t('payments.form.dueOnRequired') }]} style={{ flex: '1 1 150px', marginBottom: 8 }}>
                <Input type="date" dir="ltr" aria-label={`${t('payments.drawer.dueOn')} ${index + 1}`} />
              </Form.Item>
              <Button type="text" icon={<DeleteOutlined />} aria-label={t('payments.form.removeInstallment')} disabled={fields.length <= 1} onClick={() => remove(field.name)} />
            </Flex>
          ))}
          <Form.ErrorList errors={listErrors} />
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} disabled={fields.length >= FEE_PLAN_INSTALLMENTS_MAX} style={{ alignSelf: 'start' }}>
            {t('payments.form.addInstallment')}
          </Button>
        </Flex>
      )}
    </Form.List>
  )
}
