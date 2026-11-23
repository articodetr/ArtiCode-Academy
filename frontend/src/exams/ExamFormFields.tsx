// The exam fields shared by the creation modal and the edit form of the exam
// drawer (J-F45), on the pattern of assignments/AssignmentFormFields.tsx.
// Rendered inside the caller's <Form>; local rules mirror CreateExamDto /
// UpdateExamDto (exams.validation.ts) and every rule words its own message —
// the server decides. The class is chosen on creation only; the lesson comes
// from that class. The exam's date is a native date and time typed in the zone
// of `context.zone`, named in the hint whenever it is not this device's zone
// (always when the academy could not be read). The maximum score is read-only
// once a result exists.
//
// MOD-09 phase 2 — «طريقة الأداء»: `manual` (the default; the form is then what
// it always was) or `online`, chosen while the exam is a draft and read-only
// afterwards. An online exam shows four more fields — the closing of its
// window (typed in the same zone as the exam date), the attempts allowed, when
// a learner sees their result and whether the correct answers are revealed —
// and two fields change their meaning, so their labels and hints follow: the
// exam date is when the window opens, the duration is one attempt's time
// limit. The local rules mirror the server's: the window must close after it
// opens (`window_invalid`), and the locks of lockedOnlineFields()
// (exams.status.ts) — once the learners see the exam its maximum score is
// read-only and its opening, closing and time limit cannot be cleared; once
// somebody has started, the opening and the time limit are read-only, the
// closing only moves later and the attempts only rise. Those last rules are
// asked of the mirror itself, fed with the PATCH the form would send.
import { Alert, Col, Form, Input, InputNumber, Radio, Row, Select, Switch, Typography } from 'antd'
import type { FormInstance } from 'antd'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { EXAM_ATTEMPTS_MAX, EXAM_DELIVERIES, EXAM_DESCRIPTION_MAX_LENGTH, EXAM_DURATION_MAX, EXAM_RESULTS_RELEASES, EXAM_TITLE_MAX_LENGTH, EXAM_TYPES } from '../api/exams'
import type { Exam, ExamDelivery } from '../api/exams'
import { LESSONS_PAGE_MAX } from '../api/lessons'
import { AssignmentLessonSelect } from '../assignments/AssignmentPickers'
import { differsFromDevice } from '../assignments/assignments.zone'
import { useAuth } from '../auth/auth-context'
import { ExamClassPicker } from './ExamPickers'
import { closesAtOf, scheduledAtOf } from './exams.form'
import type { ExamFormValues } from './exams.form'
import { planExamPatch } from './exams.patch'
import { NO_ONLINE_LOCKS, lockedOnlineFieldsOf, onlineExamLocks } from './exams.status'
import { isAttemptsAllowedValid, isDurationValid, isExamMaxScoreValid, isExamWeightValid, isPassScoreValid, isWindowInverted, missingSchedulePart, passScoreAboveMax } from './exams.validation'
import type { ExamFormContext } from './useExamFormContext'

interface ExamFormFieldsProps {
  form: FormInstance
  /** `create` shows the class picker; `edit` keeps the class fixed. */
  mode: 'create' | 'edit'
  /** A class is chosen (creation) or fixed (edit) — the lesson select waits for it. */
  hasClass: boolean
  context: ExamFormContext
  /** Edit only: the exam as the server holds it (its linked lesson stays an option; its status and attempts decide the online locks). */
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
  // Each form gets its own radio name (rc-util's generated one is shared in tests).
  const radioName = useId()
  // The delivery the form shows: what it holds, else the exam's, else a new exam's default.
  const watchedDelivery = Form.useWatch('delivery', form) as ExamDelivery | undefined
  const online = (watchedDelivery ?? current?.delivery ?? 'manual') === 'online'
  const locks = current ? onlineExamLocks(current) : NO_ONLINE_LOCKS
  // `maxScore` is read-only once a result exists, and for an online exam as soon as the learners can see it.
  const maxScoreFrozen = maxScoreLocked || locks.visible

  const maxLength = (max: number) => ({ max, message: t('exams.validation.maxLength', { max }) })

  /** An English text needs the Arabic one: the server requires `ar` in every localized object. */
  const arabicFirst = (arField: string) => ({
    validator: (_: unknown, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue(arField) as string | undefined)?.trim() ? Promise.resolve() : Promise.reject(new Error(t('exams.validation.arabicFirst'))),
  })

  /** A worded refusal unless `valid(value)`. */
  const rule = (valid: (value: unknown) => boolean, key: string, params?: Record<string, unknown>) => ({
    validator: (_: unknown, value: unknown) => (valid(value) ? Promise.resolve() : Promise.reject(new Error(t(key, params)))),
  })

  const refuse = (key: string, params?: Record<string, unknown>) => Promise.reject(new Error(t(key, params)))

  const schedulePart = (part: 'date' | 'time', key: string) => ({
    validator: () =>
      missingSchedulePart(form.getFieldValue('scheduledDate') as string | undefined, form.getFieldValue('scheduledTime') as string | undefined) === part
        ? Promise.reject(new Error(t(key)))
        : Promise.resolve(),
  })

  const closesPart = (part: 'date' | 'time', key: string) => ({
    validator: () =>
      missingSchedulePart(form.getFieldValue('closesDate') as string | undefined, form.getFieldValue('closesTime') as string | undefined) === part ? refuse(key) : Promise.resolve(),
  })

  /** The server's `window_invalid`: both instants read in the form's zone, as they would be sent. */
  const windowOrder = {
    validator: () => {
      const values = form.getFieldsValue() as ExamFormValues
      return isWindowInverted(scheduledAtOf(values, zone.zone), closesAtOf(values, zone.zone)) ? refuse('examOnline.validation.windowInvalid') : Promise.resolve()
    },
  }

  /** The fields the server would lock for the online side if the form were saved as it stands (the mirror, fed with the PATCH it would get). */
  const lockedNow = (): string[] => {
    if (!current) return []
    const body = planExamPatch(current, form.getFieldsValue() as ExamFormValues, zone.zone)
    return body ? lockedOnlineFieldsOf(current, body) : []
  }

  /** Refuses with `key` while the mirror locks `field`. */
  const unlocked = (field: string, key: string | (() => string), params?: Record<string, unknown>) => ({
    validator: () => (lockedNow().includes(field) ? refuse(typeof key === 'string' ? key : key(), params) : Promise.resolve()),
  })

  /** A locked closing was either emptied (the learners see the exam) or moved earlier (somebody has started). */
  const closingLockKey = () =>
    !form.getFieldValue('closesDate') && !form.getFieldValue('closesTime') ? 'examOnline.validation.closesRequired' : 'examOnline.validation.closesOnlyLater'

  const showZone = zone.source === 'device' || differsFromDevice(zone.zone)
  const zoneHint = (testId: string) =>
    showZone ? (
      <span data-testid={testId} style={{ display: 'block' }}>
        {t(`exams.zone.${zone.source}`)} (<span dir="ltr">{zone.zone}</span>)
      </span>
    ) : null

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
      <Form.Item name="delivery" label={t('examOnline.delivery.label')} extra={locks.deliveryFixed ? t('examOnline.delivery.draftOnly') : t('examOnline.delivery.hint')}>
        <Radio.Group
          name={`exam-delivery-${radioName}`}
          orientation="vertical"
          // `undefined` rather than false: a saving form still disables it.
          disabled={locks.deliveryFixed || undefined}
          aria-label={t('examOnline.delivery.label')}
          options={EXAM_DELIVERIES.map((delivery) => ({ value: delivery, label: t(`examOnline.delivery.${delivery}`) }))}
        />
      </Form.Item>
      {online && locks.started ? <Alert type="info" showIcon title={t('examOnline.hints.started')} style={{ marginBottom: 16 }} data-testid="exam-online-lock-hint" /> : null}
      {online && locks.visible && !locks.started ? <Alert type="info" showIcon title={t('examOnline.hints.visible')} style={{ marginBottom: 16 }} data-testid="exam-online-lock-hint" /> : null}
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item
            name="scheduledDate"
            label={online ? t('examOnline.fields.opensDate') : t('exams.fields.scheduledDate')}
            dependencies={['scheduledTime']}
            extra={
              <>
                {online ? t('examOnline.hints.opens') : t('exams.hints.scheduledAt')}
                {zoneHint('exam-date-zone')}
              </>
            }
            rules={[schedulePart('date', 'exams.validation.scheduledDateRequired'), unlocked('scheduledAt', 'examOnline.validation.opensRequired')]}
          >
            <Input type="date" dir="ltr" disabled={locks.started || undefined} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            name="scheduledTime"
            label={online ? t('examOnline.fields.opensTime') : t('exams.fields.scheduledTime')}
            dependencies={['scheduledDate']}
            rules={[schedulePart('time', 'exams.validation.scheduledTimeRequired')]}
          >
            <Input type="time" dir="ltr" disabled={locks.started || undefined} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            name="durationMinutes"
            label={online ? t('examOnline.fields.attemptDuration') : t('exams.fields.durationMinutes')}
            extra={online ? t('examOnline.hints.duration', { max: EXAM_DURATION_MAX }) : t('exams.hints.duration', { max: EXAM_DURATION_MAX })}
            rules={[rule(isDurationValid, 'exams.validation.duration'), unlocked('durationMinutes', 'examOnline.validation.durationRequired')]}
          >
            <InputNumber style={{ width: '100%' }} disabled={locks.started || undefined} />
          </Form.Item>
        </Col>
      </Row>
      {online ? (
        <>
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item
                name="closesDate"
                label={t('examOnline.fields.closesDate')}
                dependencies={['closesTime', 'scheduledDate', 'scheduledTime']}
                extra={
                  <>
                    {t('examOnline.hints.closes')}
                    {zoneHint('exam-closes-zone')}
                  </>
                }
                rules={[closesPart('date', 'examOnline.validation.closesDateRequired'), windowOrder, unlocked('closesAt', closingLockKey)]}
              >
                <Input type="date" dir="ltr" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="closesTime" label={t('examOnline.fields.closesTime')} dependencies={['closesDate']} rules={[closesPart('time', 'examOnline.validation.closesTimeRequired')]}>
                <Input type="time" dir="ltr" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="attemptsAllowed"
                label={t('examOnline.fields.attemptsAllowed')}
                extra={t('examOnline.hints.attemptsAllowed', { max: EXAM_ATTEMPTS_MAX })}
                rules={[
                  { required: true, message: t('examOnline.validation.attemptsRequired') },
                  rule((value) => value === null || value === undefined || isAttemptsAllowedValid(value), 'examOnline.validation.attemptsAllowed', { max: EXAM_ATTEMPTS_MAX }),
                  unlocked('attemptsAllowed', 'examOnline.validation.attemptsOnlyRise', { current: current?.attemptsAllowed }),
                ]}
              >
                {/* No min/max: antd would clamp a typed value silently on blur — the rule says what is wrong instead. */}
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Paragraph type="secondary" data-testid="exam-window-hint">
            {t('examOnline.hints.window')}
          </Typography.Paragraph>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="resultsRelease" label={t('examOnline.fields.resultsRelease')} extra={t('examOnline.hints.resultsRelease')}>
                <Select<string> options={EXAM_RESULTS_RELEASES.map((release) => ({ value: release, label: t(`examOnline.release.${release}`) }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="revealAnswers" label={t('examOnline.fields.revealAnswers')} valuePropName="checked" extra={t('examOnline.hints.revealAnswers')}>
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </>
      ) : null}
      {locks.visible ? (
        <Alert type="info" showIcon title={t('examOnline.hints.maxScoreFrozen')} style={{ marginBottom: 16 }} />
      ) : maxScoreLocked ? (
        <Alert type="info" showIcon title={t('exams.hints.maxScoreLocked')} style={{ marginBottom: 16 }} />
      ) : null}
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item
            name="maxScore"
            label={t('exams.fields.maxScore')}
            extra={t('exams.hints.maxScore')}
            rules={[{ required: true, message: t('exams.validation.maxScoreRequired') }, rule((value) => value === null || value === undefined || isExamMaxScoreValid(value), 'exams.validation.maxScore')]}
          >
            <InputNumber style={{ width: '100%' }} disabled={maxScoreFrozen} />
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
