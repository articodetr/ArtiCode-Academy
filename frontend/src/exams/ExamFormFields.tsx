// The exam fields shared by the creation modal and the edit form of the exam
// drawer (J-F45), on the pattern of assignments/AssignmentFormFields.tsx.
// Rendered inside the caller's <Form>; local rules mirror CreateExamDto /
// UpdateExamDto (exams.validation.ts) and every rule words its own message —
// the server decides. The class is chosen on creation only; the lesson comes
// from that class. The exam's date is a native date and time typed in the zone
// of `context.zone`, named in the hint whenever it is not this device's zone
// (always when the academy could not be read). The maximum score is read-only
// once a result exists.
import { Alert, Col, Form, Input, InputNumber, Row, Select } from 'antd'
import type { FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'
import { EXAM_DESCRIPTION_MAX_LENGTH, EXAM_DURATION_MAX, EXAM_TITLE_MAX_LENGTH, EXAM_TYPES } from '../api/exams'
import type { Exam } from '../api/exams'
import { LESSONS_PAGE_MAX } from '../api/lessons'
import { AssignmentLessonSelect } from '../assignments/AssignmentPickers'
import { differsFromDevice } from '../assignments/assignments.zone'
import { useAuth } from '../auth/auth-context'
import { ExamClassPicker } from './ExamPickers'
import { isDurationValid, isExamMaxScoreValid, isExamWeightValid, isPassScoreValid, missingSchedulePart, passScoreAboveMax } from './exams.validation'
import type { ExamFormContext } from './useExamFormContext'

interface ExamFormFieldsProps {
  form: FormInstance
  /** `create` shows the class picker; `edit` keeps the class fixed. */
  mode: 'create' | 'edit'
  /** A class is chosen (creation) or fixed (edit) — the lesson select waits for it. */
  hasClass: boolean
  context: ExamFormContext
  /** Edit only: the exam as the server holds it (its linked lesson stays an option). */
  current?: Exam
  /** A result exists: maxScore is read-only (`exam_locked`). */
  maxScoreLocked?: boolean
  /** Create only: the chosen class changed (the lesson is reset by the caller). */
  onClassChange?: (classId: string | undefined) => void
}

export function ExamFormFields({ form, mode, hasClass, context, current, maxScoreLocked = false, onClassChange }: ExamFormFieldsProps) {
  const { t } = useTranslation()
  // GET /api/classes needs classes.read at the controller: without it the class list stays unknown.
  const canReadClasses = useAuth().hasPermission('classes.read')
  const { lessons, canReadLessons, zone } = context

  const maxLength = (max: number) => ({ max, message: t('exams.validation.maxLength', { max }) })

  /** An English text needs the Arabic one: the server requires `ar` in every localized object. */
  const arabicFirst = (arField: string) => ({
    validator: (_: unknown, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue(arField) as string | undefined)?.trim() ? Promise.resolve() : Promise.reject(new Error(t('exams.validation.arabicFirst'))),
  })

  /** A worded refusal unless `valid(value)`. */
  const rule = (valid: (value: unknown) => boolean, key: string) => ({
    validator: (_: unknown, value: unknown) => (valid(value) ? Promise.resolve() : Promise.reject(new Error(t(key)))),
  })

  const schedulePart = (part: 'date' | 'time', key: string) => ({
    validator: () =>
      missingSchedulePart(form.getFieldValue('scheduledDate') as string | undefined, form.getFieldValue('scheduledTime') as string | undefined) === part
        ? Promise.reject(new Error(t(key)))
        : Promise.resolve(),
  })

  const showZone = zone.source === 'device' || differsFromDevice(zone.zone)

  return (
    <>
      {mode === 'create' ? (
        <Form.Item
          name="classId"
          label={t('exams.fields.class')}
          extra={canReadClasses ? t('exams.hints.class') : t('exams.hints.needsClassesRead')}
          rules={[{ required: true, message: t('exams.validation.classRequired') }]}
        >
          {canReadClasses ? (
            <ExamClassPicker placeholder={t('exams.pickers.classPlaceholder')} onChange={(value) => onClassChange?.(value)} style={{ maxWidth: 480 }} />
          ) : (
            <Select disabled placeholder={t('exams.pickers.classPlaceholder')} options={[]} style={{ maxWidth: 480 }} />
          )}
        </Form.Item>
      ) : null}
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="type" label={t('exams.fields.type')} rules={[{ required: true, message: t('exams.validation.typeRequired') }]}>
            <Select<string> placeholder={t('exams.pickers.typePlaceholder')} options={EXAM_TYPES.map((type) => ({ value: type, label: t(`exams.types.${type}`) }))} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="lessonId"
            label={t('exams.fields.lesson')}
            extra={lessons.truncated ? t('exams.hints.lessonsTruncated', { count: LESSONS_PAGE_MAX }) : t('exams.hints.lesson')}
          >
            <AssignmentLessonSelect lessons={lessons} hasClass={hasClass} canRead={canReadLessons} current={current?.lesson} currentZone={current?.timeZone} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item
            name="titleAr"
            label={t('exams.fields.titleAr')}
            rules={[{ required: true, whitespace: true, message: t('exams.validation.titleArRequired') }, maxLength(EXAM_TITLE_MAX_LENGTH)]}
          >
            <Input maxLength={EXAM_TITLE_MAX_LENGTH} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="titleEn" label={t('exams.fields.titleEn')} dependencies={['titleAr']} rules={[maxLength(EXAM_TITLE_MAX_LENGTH), arabicFirst('titleAr')]}>
            <Input dir="ltr" maxLength={EXAM_TITLE_MAX_LENGTH} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="descriptionAr" label={t('exams.fields.descriptionAr')} rules={[maxLength(EXAM_DESCRIPTION_MAX_LENGTH)]}>
            <Input.TextArea rows={3} maxLength={EXAM_DESCRIPTION_MAX_LENGTH} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="descriptionEn"
            label={t('exams.fields.descriptionEn')}
            dependencies={['descriptionAr']}
            rules={[maxLength(EXAM_DESCRIPTION_MAX_LENGTH), arabicFirst('descriptionAr')]}
          >
            <Input.TextArea rows={3} dir="ltr" maxLength={EXAM_DESCRIPTION_MAX_LENGTH} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item
            name="scheduledDate"
            label={t('exams.fields.scheduledDate')}
            dependencies={['scheduledTime']}
            extra={
              <>
                {t('exams.hints.scheduledAt')}
                {showZone ? (
                  <span data-testid="exam-date-zone" style={{ display: 'block' }}>
                    {t(`exams.zone.${zone.source}`)} (<span dir="ltr">{zone.zone}</span>)
                  </span>
                ) : null}
              </>
            }
            rules={[schedulePart('date', 'exams.validation.scheduledDateRequired')]}
          >
            <Input type="date" dir="ltr" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="scheduledTime" label={t('exams.fields.scheduledTime')} dependencies={['scheduledDate']} rules={[schedulePart('time', 'exams.validation.scheduledTimeRequired')]}>
            <Input type="time" dir="ltr" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            name="durationMinutes"
            label={t('exams.fields.durationMinutes')}
            extra={t('exams.hints.duration', { max: EXAM_DURATION_MAX })}
            rules={[rule(isDurationValid, 'exams.validation.duration')]}
          >
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
      {maxScoreLocked ? <Alert type="info" showIcon title={t('exams.hints.maxScoreLocked')} style={{ marginBottom: 16 }} /> : null}
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item
            name="maxScore"
            label={t('exams.fields.maxScore')}
            extra={t('exams.hints.maxScore')}
            rules={[{ required: true, message: t('exams.validation.maxScoreRequired') }, rule((value) => value === null || value === undefined || isExamMaxScoreValid(value), 'exams.validation.maxScore')]}
          >
            <InputNumber style={{ width: '100%' }} disabled={maxScoreLocked} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            name="passScore"
            label={t('exams.fields.passScore')}
            extra={t('exams.hints.passScore')}
            dependencies={['maxScore']}
            rules={[
              rule(isPassScoreValid, 'exams.validation.passScore'),
              {
                validator: (_: unknown, value: number | null | undefined) =>
                  passScoreAboveMax(value, form.getFieldValue('maxScore') as number | null | undefined)
                    ? Promise.reject(new Error(t('exams.validation.passScoreAboveMax')))
                    : Promise.resolve(),
              },
            ]}
          >
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="weight" label={t('exams.fields.weight')} extra={t('exams.hints.weight')} rules={[rule(isExamWeightValid, 'exams.validation.weight')]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
    </>
  )
}
