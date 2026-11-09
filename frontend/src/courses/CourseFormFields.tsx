// The course fields shared by the creation modal and the edit form of the
// course drawer (MOD-04-T05). Rendered inside the caller's <Form>; local rules
// mirror the server (CreateCourseDto/UpdateCourseDto) — the server decides —
// and every rule words its own message (J-F23: no antd default text).
import { Col, Form, Input, InputNumber, Row, Select, Tag } from 'antd'
import type { FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Level } from '../api/levels'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { AGE_MAX, COURSE_CODE_PATTERN, COURSE_TEXT_MAX_LENGTH, DURATION_HOURS_MAX, SESSIONS_MAX, invalidAgeRange, normaliseCourseCode } from './courses.form'

interface CourseFormFieldsProps {
  form: FormInstance
  levels: Level[]
}

export function CourseFormFields({ form, levels }: CourseFormFieldsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  /** The length rule of every text field, worded by the courses dictionary (J-F23). */
  const maxLength = { max: COURSE_TEXT_MAX_LENGTH, message: t('courses.validation.maxLength', { max: COURSE_TEXT_MAX_LENGTH }) }

  /** An English text needs the Arabic one (the server requires `ar` in every localized object). */
  const arabicFirst = (arField: string) => ({
    validator: (_: unknown, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue(arField) as string | undefined)?.trim()
        ? Promise.resolve()
        : Promise.reject(new Error(t('courses.validation.arabicFirst'))),
  })

  return (
    <>
      <Form.Item
        name="code"
        label={t('courses.fields.code')}
        extra={t('courses.hints.code')}
        normalize={(value: string | undefined) => (value ?? '').toUpperCase()}
        rules={[
          { required: true, whitespace: true, message: t('courses.validation.codeRequired') },
          {
            validator: (_, value: string | undefined) =>
              !value?.trim() || COURSE_CODE_PATTERN.test(normaliseCourseCode(value))
                ? Promise.resolve()
                : Promise.reject(new Error(t('courses.validation.codeFormat'))),
          },
        ]}
      >
        <Input dir="ltr" maxLength={32} placeholder="PY-101" style={{ maxWidth: 220 }} />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item
            name="nameAr"
            label={t('courses.fields.nameAr')}
            rules={[{ required: true, whitespace: true, message: t('courses.validation.nameArRequired') }, maxLength]}
          >
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="nameEn" label={t('courses.fields.nameEn')} rules={[maxLength]}>
            <Input dir="ltr" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="summaryAr" label={t('courses.fields.summaryAr')} rules={[maxLength]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="summaryEn" label={t('courses.fields.summaryEn')} dependencies={['summaryAr']} rules={[maxLength, arabicFirst('summaryAr')]}>
            <Input.TextArea rows={2} dir="ltr" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="descriptionAr" label={t('courses.fields.descriptionAr')} rules={[maxLength]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="descriptionEn"
            label={t('courses.fields.descriptionEn')}
            dependencies={['descriptionAr']}
            rules={[maxLength, arabicFirst('descriptionAr')]}
          >
            <Input.TextArea rows={3} dir="ltr" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="levelId" label={t('courses.fields.level')}>
        <Select
          allowClear
          placeholder={t('courses.noLevel')}
          options={levels.map((level) => ({
            value: level.id,
            label: (
              <>
                {localizedLabel(level.name, language)} <span dir="ltr">({level.code})</span>
                {level.isActive ? null : <Tag style={{ marginInlineStart: 8 }}>{t('labels.inactive')}</Tag>}
              </>
            ),
          }))}
          style={{ maxWidth: 360 }}
        />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={12} md={6}>
          <Form.Item name="durationHours" label={t('courses.fields.durationHours')}>
            <InputNumber min={0.1} max={DURATION_HOURS_MAX} step={0.5} precision={1} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item name="sessionsCount" label={t('courses.fields.sessionsCount')}>
            <InputNumber min={1} max={SESSIONS_MAX} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item name="minAge" label={t('courses.fields.minAge')}>
            <InputNumber min={0} max={AGE_MAX} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item
            name="maxAge"
            label={t('courses.fields.maxAge')}
            dependencies={['minAge']}
            rules={[
              {
                validator: (_, value: number | null | undefined) =>
                  invalidAgeRange(form.getFieldValue('minAge') as number | null | undefined, value)
                    ? Promise.reject(new Error(t('courses.validation.ageRange')))
                    : Promise.resolve(),
              },
            ]}
          >
            <InputNumber min={0} max={AGE_MAX} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
    </>
  )
}
