// The course fields shared by the creation modal and the edit form of the
// course drawer (MOD-04-T05). Rendered inside the caller's <Form>; local rules
// mirror the server (CreateCourseDto/UpdateCourseDto) — the server decides —
// and every rule words its own message (J-F23: no antd default text).
// PORTAL-04: the age range is no longer asked (the stored values stay).
// The simplified course form: one column of the name, summary, description and cover.
// PORTAL-04-COURSE-ORDER: no subject picker any more (the subjects tab left the courses page); a course keeps the
// subject stored on it — neither body names `subjectId` (courses.form.ts).
// No code (the server generates one), no English texts, no level, hours or sessions: the
// stored values stay untouched (planCoursePatch() never names them). The caller adds the
// price (CoursePricingFields) after these fields.
import { Form, Input } from 'antd'
import { useTranslation } from 'react-i18next'
import { CourseCoverField } from './CourseCoverField'
import { COURSE_TEXT_MAX_LENGTH, isCoverImageUrl } from './courses.form'

export function CourseFormFields() {
  const { t } = useTranslation()
  /** The length rule of every text field, worded by the courses dictionary (J-F23). */
  const maxLength = { max: COURSE_TEXT_MAX_LENGTH, message: t('courses.validation.maxLength', { max: COURSE_TEXT_MAX_LENGTH }) }

  return (
    <>
      <Form.Item
        name="nameAr"
        label={t('courses.fields.name')}
        rules={[{ required: true, whitespace: true, message: t('courses.validation.nameRequired') }, maxLength]}
      >
        <Input />
      </Form.Item>
      <Form.Item name="summaryAr" label={t('courses.fields.summary')} rules={[maxLength]}>
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item name="descriptionAr" label={t('courses.fields.description')} rules={[maxLength]}>
        <Input.TextArea rows={3} />
      </Form.Item>
      {/* MOD-19 (D-R129): an absolute http(s) URL, no upload; blank clears it. */}
      <Form.Item
        name="coverImageUrl"
        label={t('courses.fields.coverImageUrl')}
        extra={t('courses.hints.coverImageUrl')}
        rules={[
          {
            validator: (_, value: string | undefined) =>
              isCoverImageUrl(value) ? Promise.resolve() : Promise.reject(new Error(t('courses.validation.coverUrl'))),
          },
        ]}
      >
        <CourseCoverField />
      </Form.Item>
    </>
  )
}
