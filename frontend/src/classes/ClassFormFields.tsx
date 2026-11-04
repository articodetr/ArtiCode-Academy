// The class fields shared by the creation modal and the edit form of the class
// drawer (J-F01). Rendered inside the caller's <Form>; local rules mirror the
// server (CreateClassDto/UpdateClassDto) — the server decides. The course is
// chosen on creation only (a class belongs to one course).
import { Col, Form, Input, InputNumber, Row } from 'antd'
import type { FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'
import { CoursePicker } from './ClassPickers'
import { CLASS_CAPACITY_MAX, CLASS_CODE_PATTERN, CLASS_NAME_MAX_LENGTH, CLASS_NOTES_MAX_LENGTH, invalidDateRange, normaliseClassCode } from './classes.form'

interface ClassFormFieldsProps {
  form: FormInstance
  /** `create` shows the course picker (published courses only). */
  mode: 'create' | 'edit'
  /** Active enrollments: the capacity may not drop below them (`capacity_below_enrolled`). */
  enrolledCount?: number
}

export function ClassFormFields({ form, mode, enrolledCount = 0 }: ClassFormFieldsProps) {
  const { t } = useTranslation()

  return (
    <>
      {mode === 'create' ? (
        <Form.Item
          name="courseId"
          label={t('classes.fields.course')}
          extra={t('classes.hints.course')}
          rules={[{ required: true, message: t('classes.validation.courseRequired') }]}
        >
          <CoursePicker status="published" placeholder={t('classes.pickers.coursePlaceholder')} style={{ maxWidth: 420 }} />
        </Form.Item>
      ) : null}
      <Form.Item
        name="code"
        label={t('classes.fields.code')}
        extra={t('classes.hints.code')}
        normalize={(value: string | undefined) => (value ?? '').toUpperCase()}
        rules={[
          { required: true, whitespace: true, message: t('classes.validation.codeRequired') },
          {
            validator: (_, value: string | undefined) =>
              !value?.trim() || CLASS_CODE_PATTERN.test(normaliseClassCode(value))
                ? Promise.resolve()
                : Promise.reject(new Error(t('classes.validation.codeFormat'))),
          },
        ]}
      >
        <Input dir="ltr" maxLength={32} placeholder="PY-101-A" style={{ maxWidth: 220 }} />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item
            name="nameAr"
            label={t('classes.fields.nameAr')}
            rules={[{ required: true, whitespace: true, message: t('classes.validation.nameArRequired') }, { max: CLASS_NAME_MAX_LENGTH }]}
          >
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="nameEn" label={t('classes.fields.nameEn')} rules={[{ max: CLASS_NAME_MAX_LENGTH }]}>
            <Input dir="ltr" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item
            name="capacity"
            label={t('classes.fields.capacity')}
            extra={enrolledCount > 0 ? t('classes.hints.capacityMin', { count: enrolledCount }) : undefined}
            rules={[
              { required: true, message: t('classes.validation.capacityRequired') },
              {
                validator: (_, value: number | null | undefined) =>
                  value === null || value === undefined || value >= enrolledCount
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('classes.validation.capacityBelowEnrolled', { count: enrolledCount }))),
              },
            ]}
          >
            <InputNumber min={1} max={CLASS_CAPACITY_MAX} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={8}>
          <Form.Item name="startsOn" label={t('classes.fields.startsOn')}>
            <Input type="date" dir="ltr" />
          </Form.Item>
        </Col>
        <Col xs={12} md={8}>
          <Form.Item
            name="endsOn"
            label={t('classes.fields.endsOn')}
            dependencies={['startsOn']}
            rules={[
              {
                validator: (_, value: string | undefined) =>
                  invalidDateRange(form.getFieldValue('startsOn') as string | undefined, value)
                    ? Promise.reject(new Error(t('classes.validation.dateRange')))
                    : Promise.resolve(),
              },
            ]}
          >
            <Input type="date" dir="ltr" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="notes" label={t('classes.fields.notes')} rules={[{ max: CLASS_NOTES_MAX_LENGTH }]}>
        <Input.TextArea rows={3} maxLength={CLASS_NOTES_MAX_LENGTH} />
      </Form.Item>
    </>
  )
}
