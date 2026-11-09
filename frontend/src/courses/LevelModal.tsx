// Create / edit one level (MOD-04-T06): API-038 for a new level (appended at
// the end of the order), API-039 with the smallest PATCH for an existing one
// (no request when nothing changed). A taken code lands on the code field;
// any other refusal shows inside the modal. The parent mounts it per session
// (a form instance kept across sessions would bring back an earlier level's values).
// Every length rule words its own message (courses.validation.maxLength — J-F23).
import { Alert, App, Col, Form, Input, Modal, Row, Switch } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createLevel, updateLevel } from '../api/levels'
import type { Level } from '../api/levels'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { COURSE_TEXT_MAX_LENGTH, normaliseCourseCode } from './courses.form'
import { describeCoursesFailure, failureMessage } from './courses.errors'
import { EMPTY_LEVEL_FORM, LEVEL_CODE_MAX_LENGTH, LEVEL_CODE_PATTERN, buildCreateLevelInput, levelFormValuesOf, planLevelPatch } from './levels.form'
import type { LevelFormValues } from './levels.form'

interface LevelModalProps {
  open: boolean
  /** The level to edit; null creates a new one. */
  level: Level | null
  onClose: () => void
  /** The level as the server returned it; `created` tells a new level from an edit. */
  onSaved: (level: Level, created: boolean) => void
}

export function LevelModal({ open, level, onClose, onSaved }: LevelModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The length rule of every text field, worded by the courses dictionary (J-F23). */
  const maxLength = { max: COURSE_TEXT_MAX_LENGTH, message: t('courses.validation.maxLength', { max: COURSE_TEXT_MAX_LENGTH }) }

  const arabicFirst = (arField: string) => ({
    validator: (_: unknown, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue(arField) as string | undefined)?.trim()
        ? Promise.resolve()
        : Promise.reject(new Error(t('courses.validation.arabicFirst'))),
  })

  const close = () => {
    setError(null)
    onClose()
  }

  const submit = async (values: LevelFormValues) => {
    setError(null)
    const patch = level ? planLevelPatch(level, values) : null
    if (level && !patch) {
      message.info(t('courses.levels.nothingChanged'))
      close()
      return
    }
    setSaving(true)
    try {
      const saved = level && patch ? await updateLevel(level.id, patch) : await createLevel(buildCreateLevelInput(values))
      onSaved(saved, level === null)
    } catch (caught) {
      const failure = describeCoursesFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field?.[0] === 'code') form.setFields([{ name: 'code', errors: [text] }])
      else setError(text)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={level ? t('courses.levels.editTitle', { name: localizedLabel(level.name, language) }) : t('courses.levels.createTitle')}
      okText={level ? t('common.save') : t('courses.levels.create')}
      cancelText={t('common.cancel')}
      onOk={() => form.submit()}
      onCancel={close}
      confirmLoading={saving}
      destroyOnHidden
      width={640}
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Form
        key={level ? `${level.id}:${level.updatedAt}` : 'new'}
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={level ? levelFormValuesOf(level) : EMPTY_LEVEL_FORM}
        onFinish={(values) => void submit(values as LevelFormValues)}
        disabled={saving}
      >
        <Form.Item
          name="code"
          label={t('courses.levels.fields.code')}
          extra={t('courses.levels.hints.code')}
          normalize={(value: string | undefined) => (value ?? '').toUpperCase()}
          rules={[
            { required: true, whitespace: true, message: t('courses.levels.validation.codeRequired') },
            {
              validator: (_, value: string | undefined) =>
                !value?.trim() || LEVEL_CODE_PATTERN.test(normaliseCourseCode(value))
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('courses.levels.validation.codeFormat'))),
            },
          ]}
        >
          <Input dir="ltr" maxLength={LEVEL_CODE_MAX_LENGTH} placeholder="BEG" style={{ maxWidth: 200 }} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="nameAr"
              label={t('courses.levels.fields.nameAr')}
              rules={[{ required: true, whitespace: true, message: t('courses.levels.validation.nameArRequired') }, maxLength]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="nameEn" label={t('courses.levels.fields.nameEn')} rules={[maxLength]}>
              <Input dir="ltr" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="descriptionAr" label={t('courses.levels.fields.descriptionAr')} rules={[maxLength]}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="descriptionEn"
              label={t('courses.levels.fields.descriptionEn')}
              dependencies={['descriptionAr']}
              rules={[maxLength, arabicFirst('descriptionAr')]}
            >
              <Input.TextArea rows={2} dir="ltr" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="isActive" label={t('courses.levels.fields.isActive')} valuePropName="checked" extra={t('courses.levels.hints.isActive')}>
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}
