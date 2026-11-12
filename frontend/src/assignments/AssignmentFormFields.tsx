// The assignment fields shared by the creation modal and the edit form of the
// assignment drawer (J-F38). Rendered inside the caller's <Form>; local rules
// mirror CreateAssignmentDto/UpdateAssignmentDto (assignments.validation.ts)
// and every rule words its own message — the server decides. The class is
// chosen on creation only; the lesson comes from that class. The due date is
// a native date and time typed in the zone of `context.dueZone`, named in the
// hint whenever it is not this device's zone (always when the academy could
// not be read, or is still being read — J-F56). The grading rules are
// read-only once a submission exists.
import { Alert, Col, Form, Input, InputNumber, Row, Select, Switch } from 'antd'
import type { FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'
import { ASSIGNMENT_INSTRUCTIONS_MAX_LENGTH, ASSIGNMENT_TITLE_MAX_LENGTH } from '../api/assignments'
import type { Assignment } from '../api/assignments'
import { useAuth } from '../auth/auth-context'
import { AssignmentClassPicker, AssignmentLessonSelect } from './AssignmentPickers'
import { isLatePenaltyValid, isMaxAttemptsValid, isMaxScoreValid, isWeightValid, latePenaltyWithoutAllowLate, missingDuePart } from './assignments.validation'
import { differsFromDevice } from './assignments.zone'
import type { AssignmentFormContext } from './useAssignmentFormContext'
import { lessonSelectHint } from './useClassLessons'

interface AssignmentFormFieldsProps {
  form: FormInstance
  /** `create` shows the class picker; `edit` keeps the class fixed. */
  mode: 'create' | 'edit'
  /** A class is chosen (creation) or fixed (edit) — the lesson select waits for it. */
  hasClass: boolean
  context: AssignmentFormContext
  /** Edit only: the assignment as the server holds it (its linked lesson stays an option). */
  current?: Assignment
  /** A submission exists: maxScore, maxAttempts, allowLate and latePenaltyPercent are read-only (`assignment_locked`). */
  gradingLocked?: boolean
  /** Create only: the chosen class changed (the lesson is reset by the caller). */
  onClassChange?: (classId: string | undefined) => void
}

export function AssignmentFormFields({ form, mode, hasClass, context, current, gradingLocked = false, onClassChange }: AssignmentFormFieldsProps) {
  const { t } = useTranslation()
  // GET /api/classes needs classes.read at the controller: without it the class list stays unknown.
  const canReadClasses = useAuth().hasPermission('classes.read')
  const { lessons, canReadLessons, dueZone, zonePending } = context

  const maxLength = (max: number) => ({ max, message: t('assignments.validation.maxLength', { max }) })

  /** An English text needs the Arabic one: the server requires `ar` in every localized object. */
  const arabicFirst = (arField: string) => ({
    validator: (_: unknown, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue(arField) as string | undefined)?.trim() ? Promise.resolve() : Promise.reject(new Error(t('assignments.validation.arabicFirst'))),
  })

  /** A worded refusal unless `valid(value)`. */
  const rule = (valid: (value: unknown) => boolean, key: string) => ({
    validator: (_: unknown, value: unknown) => (valid(value) ? Promise.resolve() : Promise.reject(new Error(t(key)))),
  })

  const duePart = (part: 'date' | 'time', key: string) => ({
    validator: () =>
      missingDuePart(form.getFieldValue('dueDate') as string | undefined, form.getFieldValue('dueTime') as string | undefined) === part
        ? Promise.reject(new Error(t(key)))
        : Promise.resolve(),
  })

  const showZone = dueZone.source === 'device' || differsFromDevice(dueZone.zone)

  return (
    <>
      {mode === 'create' ? (
        <Form.Item
          name="classId"
          label={t('assignments.fields.class')}
          extra={canReadClasses ? t('assignments.hints.class') : t('assignments.hints.needsClassesRead')}
          rules={[{ required: true, message: t('assignments.validation.classRequired') }]}
        >
          {canReadClasses ? (
            <AssignmentClassPicker placeholder={t('assignments.pickers.classPlaceholder')} onChange={(value) => onClassChange?.(value)} style={{ maxWidth: 480 }} />
          ) : (
            <Select disabled placeholder={t('assignments.pickers.classPlaceholder')} options={[]} style={{ maxWidth: 480 }} />
          )}
        </Form.Item>
      ) : null}
      <Form.Item name="lessonId" label={t('assignments.fields.lesson')} extra={lessonSelectHint(lessons, t, 'assignments')}>
        <AssignmentLessonSelect lessons={lessons} hasClass={hasClass} canRead={canReadLessons} current={current?.lesson} currentZone={current?.timeZone} />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item
            name="titleAr"
            label={t('assignments.fields.titleAr')}
            rules={[{ required: true, whitespace: true, message: t('assignments.validation.titleArRequired') }, maxLength(ASSIGNMENT_TITLE_MAX_LENGTH)]}
          >
            <Input maxLength={ASSIGNMENT_TITLE_MAX_LENGTH} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="titleEn" label={t('assignments.fields.titleEn')} dependencies={['titleAr']} rules={[maxLength(ASSIGNMENT_TITLE_MAX_LENGTH), arabicFirst('titleAr')]}>
            <Input dir="ltr" maxLength={ASSIGNMENT_TITLE_MAX_LENGTH} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="instructionsAr" label={t('assignments.fields.instructionsAr')} rules={[maxLength(ASSIGNMENT_INSTRUCTIONS_MAX_LENGTH)]}>
            <Input.TextArea rows={3} maxLength={ASSIGNMENT_INSTRUCTIONS_MAX_LENGTH} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="instructionsEn"
            label={t('assignments.fields.instructionsEn')}
            dependencies={['instructionsAr']}
            rules={[maxLength(ASSIGNMENT_INSTRUCTIONS_MAX_LENGTH), arabicFirst('instructionsAr')]}
          >
            <Input.TextArea rows={3} dir="ltr" maxLength={ASSIGNMENT_INSTRUCTIONS_MAX_LENGTH} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item
            name="dueDate"
            label={t('assignments.fields.dueDate')}
            dependencies={['dueTime']}
            extra={
              <>
                {t('assignments.hints.due')}
                {showZone ? (
                  <span data-testid="assignment-due-zone" style={{ display: 'block' }}>
                    {/* Before the academy's first answer nothing has failed yet: «being read», not «could not be read». */}
                    {t(zonePending ? 'assignments.zone.pending' : `assignments.zone.${dueZone.source}`)} (<span dir="ltr">{dueZone.zone}</span>)
                  </span>
                ) : null}
              </>
            }
            rules={[duePart('date', 'assignments.validation.dueDateRequired')]}
          >
            <Input type="date" dir="ltr" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="dueTime" label={t('assignments.fields.dueTime')} dependencies={['dueDate']} rules={[duePart('time', 'assignments.validation.dueTimeRequired')]}>
            <Input type="time" dir="ltr" />
          </Form.Item>
        </Col>
      </Row>
      {gradingLocked ? <Alert type="info" showIcon title={t('assignments.hints.gradingLocked')} style={{ marginBottom: 16 }} /> : null}
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item
            name="maxScore"
            label={t('assignments.fields.maxScore')}
            extra={t('assignments.hints.maxScore')}
            rules={[{ required: true, message: t('assignments.validation.maxScoreRequired') }, rule((value) => value === null || value === undefined || isMaxScoreValid(value), 'assignments.validation.maxScore')]}
          >
            <InputNumber style={{ width: '100%' }} disabled={gradingLocked} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="weight" label={t('assignments.fields.weight')} extra={t('assignments.hints.weight')} rules={[rule(isWeightValid, 'assignments.validation.weight')]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            name="maxAttempts"
            label={t('assignments.fields.maxAttempts')}
            extra={t('assignments.hints.maxAttempts')}
            rules={[{ required: true, message: t('assignments.validation.maxAttemptsRequired') }, rule((value) => value === null || value === undefined || isMaxAttemptsValid(value), 'assignments.validation.maxAttempts')]}
          >
            <InputNumber style={{ width: '100%' }} disabled={gradingLocked} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="allowLate" label={t('assignments.fields.allowLate')} valuePropName="checked" extra={t('assignments.hints.allowLate')}>
            <Switch disabled={gradingLocked} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="latePenaltyPercent"
            label={t('assignments.fields.latePenaltyPercent')}
            extra={t('assignments.hints.latePenalty')}
            dependencies={['allowLate']}
            rules={[
              rule(isLatePenaltyValid, 'assignments.validation.latePenalty'),
              {
                validator: (_: unknown, value: number | null | undefined) =>
                  latePenaltyWithoutAllowLate(form.getFieldValue('allowLate') as boolean | undefined, value)
                    ? Promise.reject(new Error(t('assignments.validation.latePenaltyNeedsAllowLate')))
                    : Promise.resolve(),
              },
            ]}
          >
            <InputNumber style={{ width: '100%' }} disabled={gradingLocked} />
          </Form.Item>
        </Col>
      </Row>
    </>
  )
}
