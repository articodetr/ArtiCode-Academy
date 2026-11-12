// The content of a draft invoice inside a Form (J-F52): its lines (1..50, each
// a localized description and an amount), one invoice-level discount with its
// reason (D-R64), its installments (1..24, each an amount and a due day — not
// for a draft made from a fee plan, whose shares the server splits) and the
// internal note. Every field mirrors its DTO rule and words its own message;
// the totals card is the form's own preview of what is typed (once saved, the
// screens show the server's values). Shared by the new-invoice modal and the
// edit form of a draft.
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Descriptions, Flex, Form, Input, InputNumber, Row, Typography } from 'antd'
import type { FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'
import { FEE_PLAN_INSTALLMENTS_MAX, FEE_PLAN_LINES_MAX, FINANCE_TEXT_MAX_LENGTH } from '../api/feePlans'
import { INVOICE_NOTES_MAX, REASON_MAX } from '../api/invoices'
import { isCalendarDate } from '../timetable/timetable.dates'
import { useLocalized } from '../i18n/useLocalized'
import { formatMoney } from './finance.format'
import { fromCents, isDiscountAmount, isPositiveAmount } from './finance.money'
import { emptyInvoiceLine, evenInstallments, invoicePreview } from './invoices.form'
import type { InstallmentFormValues, InvoiceContentFormValues } from './invoices.form'

interface InvoiceContentFieldsProps {
  form: FormInstance
  /** The currency of the preview (the invoice's, or the academy's for a new one); null = amounts alone. */
  currency: string | null
  /** False for a draft made from a fee plan: no lines or installments to type, only the discount and the note. */
  manual: boolean
  /** The day a new installment is due when there is none before it (`YYYY-MM-DD`). */
  today: string
}

const blank = (value: unknown) => value === null || value === undefined

export function InvoiceContentFields({ form, currency, manual, today }: InvoiceContentFieldsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const values = (Form.useWatch([], form) ?? {}) as InvoiceContentFormValues
  const preview = invoicePreview(values)
  const money = (cents: number | null) => (cents === null ? '—' : formatMoney(fromCents(cents), currency, language))
  const textMax = { max: FINANCE_TEXT_MAX_LENGTH, message: t('finance.validation.textMax', { max: FINANCE_TEXT_MAX_LENGTH }) }
  const amountRule = {
    validator: (_: unknown, value: unknown) =>
      blank(value) ? Promise.reject(new Error(t('finance.validation.amountRequired'))) : isPositiveAmount(value) ? Promise.resolve() : Promise.reject(new Error(t('finance.validation.amount'))),
  }

  const splitEvenly = () => {
    const parts = (form.getFieldValue('installments') as InstallmentFormValues[] | undefined) ?? []
    if (preview.total === null || preview.total <= 0 || parts.length === 0) return
    form.setFieldsValue({ installments: evenInstallments(parts, preview.total) })
    void form.validateFields([['installments']]).catch(() => undefined)
  }

  return (
    <>
      {manual ? (
        <>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t('finance.editor.lines')}
          </Typography.Title>
          <Form.List
            name="lines"
            rules={[
              {
                validator: async (_, lines: unknown[] | undefined) => {
                  if (!lines || lines.length < 1) throw new Error(t('finance.validation.linesMin'))
                  if (lines.length > FEE_PLAN_LINES_MAX) throw new Error(t('finance.validation.linesMax', { max: FEE_PLAN_LINES_MAX }))
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <Flex vertical gap={8} style={{ marginBottom: 16 }}>
                {fields.map((field, index) => (
                  <Card key={field.key} size="small" data-testid="invoice-line-editor">
                    <Form.Item name={[field.name, 'descriptionTr']} hidden>
                      <Input />
                    </Form.Item>
                    <Row gutter={12} align="top">
                      <Col xs={24} md={9}>
                        <Form.Item
                          name={[field.name, 'descriptionAr']}
                          label={t('finance.editor.lineAr', { number: index + 1 })}
                          rules={[{ required: true, whitespace: true, message: t('finance.validation.descriptionRequired') }, textMax]}
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={7}>
                        <Form.Item name={[field.name, 'descriptionEn']} label={t('finance.editor.lineEn')} rules={[textMax]}>
                          <Input dir="ltr" />
                        </Form.Item>
                      </Col>
                      <Col xs={18} md={6}>
                        <Form.Item name={[field.name, 'amount']} label={t('finance.editor.amount')} rules={[amountRule]}>
                          <InputNumber style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={6} md={2} style={{ paddingTop: 30 }}>
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={t('finance.editor.removeLine', { number: index + 1 })}
                          disabled={fields.length <= 1}
                          onClick={() => remove(field.name)}
                        />
                      </Col>
                    </Row>
                  </Card>
                ))}
                <Form.ErrorList errors={errors} />
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(emptyInvoiceLine())} disabled={fields.length >= FEE_PLAN_LINES_MAX}>
                  {t('finance.editor.addLine')}
                </Button>
              </Flex>
            )}
          </Form.List>
        </>
      ) : null}

      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item
            name="discountAmount"
            label={t('finance.editor.discount')}
            extra={t('finance.editor.discountHint')}
            rules={[{ validator: (_, value: unknown) => (blank(value) || isDiscountAmount(value) ? Promise.resolve() : Promise.reject(new Error(t('finance.validation.discount')))) }]}
          >
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={16}>
          <Form.Item
            name="discountReason"
            label={t('finance.editor.discountReason')}
            dependencies={['discountAmount']}
            rules={[
              { max: REASON_MAX, message: t('finance.validation.reasonMax', { max: REASON_MAX }) },
              ({ getFieldValue }) => ({
                validator: (_, value: string | undefined) => {
                  const discount = getFieldValue('discountAmount') as unknown
                  // `discount_reason_without_discount`: a reason goes with a discount only.
                  return value?.trim() && (blank(discount) || discount === 0) ? Promise.reject(new Error(t('finance.problems.discount_reason_without_discount'))) : Promise.resolve()
                },
              }),
            ]}
          >
            <Input />
          </Form.Item>
        </Col>
      </Row>

      {manual ? (
        <>
          <Flex justify="space-between" align="center" wrap gap={8}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {t('finance.editor.installments')}
            </Typography.Title>
            <Button size="small" onClick={splitEvenly} disabled={preview.total === null || preview.total <= 0}>
              {t('finance.editor.splitEvenly')}
            </Button>
          </Flex>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            {t('finance.editor.installmentsHint')}
          </Typography.Paragraph>
          <Form.List
            name="installments"
            rules={[
              {
                validator: async (_, parts: unknown[] | undefined) => {
                  if (!parts || parts.length < 1) throw new Error(t('finance.validation.installmentsMin'))
                  if (parts.length > FEE_PLAN_INSTALLMENTS_MAX) throw new Error(t('finance.validation.installmentsMax', { max: FEE_PLAN_INSTALLMENTS_MAX }))
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <Flex vertical gap={8} style={{ marginBottom: 16 }}>
                {fields.map((field, index) => (
                  <Row key={field.key} gutter={12} align="top" data-testid="invoice-installment-editor">
                    <Col xs={12} md={8}>
                      <Form.Item name={[field.name, 'amount']} label={t('finance.editor.installmentAmount', { number: index + 1 })} rules={[amountRule]}>
                        <InputNumber style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item
                        name={[field.name, 'dueOn']}
                        label={t('finance.editor.dueOn', { number: index + 1 })}
                        rules={[{ validator: (_, value: unknown) => (isCalendarDate(value) ? Promise.resolve() : Promise.reject(new Error(t('finance.validation.dueOnRequired')))) }]}
                      >
                        <Input type="date" dir="ltr" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={2} style={{ paddingTop: 30 }}>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t('finance.editor.removeInstallment', { number: index + 1 })}
                        disabled={fields.length <= 1}
                        onClick={() => remove(field.name)}
                      />
                    </Col>
                  </Row>
                ))}
                <Form.ErrorList errors={errors} />
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  disabled={fields.length >= FEE_PLAN_INSTALLMENTS_MAX}
                  onClick={() => {
                    const parts = (form.getFieldValue('installments') as InstallmentFormValues[] | undefined) ?? []
                    const last = parts.at(-1)?.dueOn
                    add({ amount: null, dueOn: isCalendarDate(last) ? last : today })
                  }}
                >
                  {t('finance.editor.addInstallment')}
                </Button>
              </Flex>
            )}
          </Form.List>
        </>
      ) : null}

      <Form.Item name="notes" label={t('finance.editor.notes')} extra={t('finance.editor.notesHint')} rules={[{ max: INVOICE_NOTES_MAX, message: t('finance.validation.notesMax', { max: INVOICE_NOTES_MAX }) }]}>
        <Input.TextArea rows={2} />
      </Form.Item>

      {manual ? (
        <Card size="small" title={t('finance.editor.preview')} data-testid="invoice-preview" style={{ marginBottom: 16 }}>
          <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label={t('finance.fields.subtotal')}>
              <bdi>{money(preview.subtotal)}</bdi>
            </Descriptions.Item>
            <Descriptions.Item label={t('finance.fields.discount')}>
              <bdi>{money(preview.discount)}</bdi>
            </Descriptions.Item>
            <Descriptions.Item label={t('finance.fields.total')}>
              <bdi>{money(preview.total)}</bdi>
            </Descriptions.Item>
            <Descriptions.Item label={t('finance.editor.installmentsSum')}>
              <bdi>{money(preview.installments)}</bdi>
            </Descriptions.Item>
          </Descriptions>
          {preview.total !== null && preview.installments !== null && preview.total !== preview.installments ? (
            <Alert type="warning" showIcon title={t('finance.problems.installments_sum')} data-testid="invoice-preview-mismatch" />
          ) : null}
        </Card>
      ) : null}
    </>
  )
}
