// Create / edit one grade scheme (J-F44 — MOD-09-T08 part a): API-123 for a new
// scheme, API-124 with the smallest PATCH for an existing one (no request when
// nothing changed). The form holds the name (Arabic required, English optional;
// a Turkish text the form does not show is kept), the whole band list in a
// Form.List editor — 2..20 bands, each with its minimum (0..100, two decimals
// at most), its label, an optional letter of up to 4 characters and pass/fail —
// and, for a new scheme, «make it the default» (the academy's first scheme
// becomes the default anyway, so the switch gives way to a note). The band rules
// of the server are mirrored (gradeSchemes.changes.ts — keep in sync) and
// checked before any request; a refusal the mirror missed shows above the form.
// While the form holds unsaved work, Escape and a mask click no longer close
// the modal — the cancel button and × still do (a deliberate close). The parent
// mounts it per session (KI-049: a form instance kept across sessions would
// bring back an earlier scheme's values).
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Flex, Form, Input, InputNumber, Modal, Row, Switch, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BAND_LETTER_MAX_LENGTH, createGradeScheme, GRADE_SCHEME_BANDS_MAX, GRADE_SCHEME_BANDS_MIN, GRADE_SCHEME_TEXT_MAX_LENGTH, updateGradeScheme } from '../api/gradeSchemes'
import type { GradeScheme } from '../api/gradeSchemes'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { GRADE_SCHEME_PROBLEMS } from './gradeSchemes.changes'
import { describeGradeSchemesFailure, failureMessage, isGoneGradeScheme } from './gradeSchemes.errors'
import {
  bandListIssues,
  buildCreateGradeSchemeInput,
  emptyBand,
  gradeSchemeFormHasChanges,
  gradeSchemeFormValuesOf,
  isValidMinPercent,
  newGradeSchemeForm,
  planGradeSchemePatch,
} from './gradeSchemes.form'
import type { BandFormValues, GradeSchemeFormValues } from './gradeSchemes.form'

interface GradeSchemeModalProps {
  /** The scheme to edit; null creates a new one. */
  scheme: GradeScheme | null
  /** The academy has no scheme yet: the server makes the new one the default whatever the body says. */
  firstScheme: boolean
  onClose: () => void
  /** The scheme as the server returned it; `created` tells a new scheme from an edit. */
  onSaved: (scheme: GradeScheme, created: boolean) => void
  /** The scheme is gone (404): the list is re-read. */
  onStale: () => void
}

/** The band-count messages (ArrayMinSize/ArrayMaxSize); each server rule has a rule of its own, so the messages show together. */
const COUNT_KEYS = ['gradeSchemes.validation.bandsMin', 'gradeSchemes.validation.bandsMax']

export function GradeSchemeModal({ scheme, firstScheme, onClose, onSaved, onStale }: GradeSchemeModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [form] = Form.useForm<GradeSchemeFormValues>()
  const [initialValues] = useState<GradeSchemeFormValues>(() => (scheme ? gradeSchemeFormValuesOf(scheme) : newGradeSchemeForm()))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  /** One list-level rule: the first issue of `bandListIssues()` among these keys. */
  const issueRule = (keys: readonly string[]) => ({
    validator: async (_: unknown, bands: BandFormValues[] | undefined) => {
      const issue = bandListIssues(bands).find((candidate) => keys.includes(candidate.key))
      if (issue) throw new Error(t(issue.key, issue.params))
    },
  })
  const bandListRules = [issueRule(COUNT_KEYS), ...GRADE_SCHEME_PROBLEMS.map((problem) => issueRule([`gradeSchemes.validation.${problem}`]))]
  const textMax = { max: GRADE_SCHEME_TEXT_MAX_LENGTH, message: t('gradeSchemes.validation.textMax', { max: GRADE_SCHEME_TEXT_MAX_LENGTH }) }

  const close = () => {
    if (!saving) onClose()
  }

  const submit = async (values: GradeSchemeFormValues) => {
    setError(null)
    const patch = scheme ? planGradeSchemePatch(scheme, values) : null
    if (scheme && !patch) {
      message.info(t('gradeSchemes.nothingChanged'))
      onClose()
      return
    }
    setSaving(true)
    try {
      const saved = scheme && patch ? await updateGradeScheme(scheme.id, patch) : await createGradeScheme(buildCreateGradeSchemeInput(values, firstScheme))
      onSaved(saved, scheme === null)
    } catch (caught) {
      const failure = describeGradeSchemesFailure(caught)
      setError(failureMessage(t, failure))
      if (isGoneGradeScheme(failure)) onStale()
    } finally {
      setSaving(false)
    }
  }

  const usedCount = scheme?.finalGradeCount ?? 0

  return (
    <Modal
      open
      title={scheme ? t('gradeSchemes.editTitle', { name: localizedLabel(scheme.name, language) }) : t('gradeSchemes.createTitle')}
      okText={scheme ? t('common.save') : t('gradeSchemes.create')}
      cancelText={t('common.cancel')}
      onOk={() => form.submit()}
      onCancel={close}
      confirmLoading={saving}
      // Unsaved work turns off the Escape key and the mask click; the cancel button and × still close.
      keyboard={!dirty}
      mask={{ closable: !dirty }}
      destroyOnHidden
      width={880}
    >
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      {usedCount > 0 ? <Alert type="info" showIcon title={t('gradeSchemes.hints.usedScheme', { count: usedCount })} style={{ marginBottom: 16 }} /> : null}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initialValues}
        onFinish={(values) => void submit(values)}
        onValuesChange={(_, all: GradeSchemeFormValues) => {
          setDirty(gradeSchemeFormHasChanges(scheme, all))
          // A Form.List rule re-runs on its own operations (add/remove) only; the band rules read every band,
          // so they follow each change (a minimum still empty leaves them to its field — bandListIssues()).
          void form.validateFields([['bands']]).catch(() => undefined)
        }}
        disabled={saving}
      >
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="nameAr"
              label={t('gradeSchemes.fields.nameAr')}
              rules={[{ required: true, whitespace: true, message: t('gradeSchemes.validation.nameArRequired') }, textMax]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="nameEn" label={t('gradeSchemes.fields.nameEn')} rules={[textMax]}>
              <Input dir="ltr" />
            </Form.Item>
          </Col>
        </Row>

        <Typography.Title level={2} className="section-title" style={{ marginTop: 0 }}>
          {t('gradeSchemes.fields.bands')}
        </Typography.Title>
        <Typography.Paragraph type="secondary">{t('gradeSchemes.hints.bands')}</Typography.Paragraph>
        <Form.List name="bands" rules={bandListRules}>
          {(fields, { add, remove }, { errors }) => (
            <Flex vertical gap={8}>
              {fields.map((field, index) => {
                const number = index + 1
                return (
                  <Card
                    key={field.key}
                    size="small"
                    title={t('gradeSchemes.band', { number })}
                    data-testid="grade-band-editor"
                    extra={
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t('gradeSchemes.removeBand', { number })}
                        disabled={fields.length <= GRADE_SCHEME_BANDS_MIN}
                        onClick={() => remove(field.name)}
                      />
                    }
                  >
                    <Form.Item name={[field.name, 'labelTr']} hidden>
                      <Input />
                    </Form.Item>
                    <Row gutter={12}>
                      <Col xs={12} md={5}>
                        <Form.Item
                          name={[field.name, 'minPercent']}
                          label={t('gradeSchemes.fields.minPercent')}
                          rules={[
                            { required: true, message: t('gradeSchemes.validation.minPercentRequired') },
                            {
                              validator: (_, value: unknown) =>
                                value === null || value === undefined || isValidMinPercent(value)
                                  ? Promise.resolve()
                                  : Promise.reject(new Error(t('gradeSchemes.validation.minPercent'))),
                            },
                          ]}
                        >
                          <InputNumber min={0} max={100} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={7}>
                        <Form.Item
                          name={[field.name, 'labelAr']}
                          label={t('gradeSchemes.fields.labelAr')}
                          rules={[{ required: true, whitespace: true, message: t('gradeSchemes.validation.labelArRequired') }, textMax]}
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={6}>
                        <Form.Item name={[field.name, 'labelEn']} label={t('gradeSchemes.fields.labelEn')} rules={[textMax]}>
                          <Input dir="ltr" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={3}>
                        <Form.Item name={[field.name, 'letter']} label={t('gradeSchemes.fields.letter')} tooltip={t('gradeSchemes.hints.letter')}>
                          <Input dir="ltr" maxLength={BAND_LETTER_MAX_LENGTH} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={3}>
                        <Form.Item name={[field.name, 'isPass']} label={t('gradeSchemes.fields.isPass')} valuePropName="checked">
                          <Switch checkedChildren={t('gradeSchemes.pass')} unCheckedChildren={t('gradeSchemes.fail')} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                )
              })}
              <Form.ErrorList errors={errors} />
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(emptyBand())} disabled={fields.length >= GRADE_SCHEME_BANDS_MAX}>
                {t('gradeSchemes.addBand')}
              </Button>
            </Flex>
          )}
        </Form.List>

        {scheme ? null : firstScheme ? (
          <Alert type="info" showIcon title={t('gradeSchemes.hints.firstScheme')} style={{ marginTop: 16 }} />
        ) : (
          <Form.Item name="isDefault" label={t('gradeSchemes.fields.isDefault')} valuePropName="checked" extra={t('gradeSchemes.hints.isDefault')} style={{ marginTop: 16 }}>
            <Switch />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
