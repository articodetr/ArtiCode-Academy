// The course of a question bank (MOD-09 phase 2 — OEX-T07): GET /api/courses
// (API-042, needs `courses.read`) on the shared RemoteSelect, on the pattern of
// payments/FinancePickers.tsx — each option a small reference `{ id, code, name }`,
// and the course a form starts from (an edited bank's) put first in the first
// page, so it shows by name and never as a raw id. The list filter also offers
// «بلا دورة» before the courses: `courseId=none` of API-260, the banks filed
// under no course. The picker lists what the caller may read; which course a
// bank may be filed under is the server's decision (any course with
// `classes.manage`, else one the caller teaches a class of — `course_not_found`).
import { useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { listCourses } from '../api/courses'
import { NO_COURSE_FILTER } from '../api/questionBanks'
import type { QuestionBankCourse } from '../api/questionBanks'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'

const OPTIONS_LIMIT = 20

/** The filter's pseudo-course: the banks filed under no course. */
const NO_COURSE: QuestionBankCourse = { id: NO_COURSE_FILTER, code: '', name: { ar: '' } }

interface BankCoursePickerProps {
  value?: string
  onChange?: (value: string | undefined) => void
  /** The course the form starts from (an edited bank's), shown by name. */
  initial?: QuestionBankCourse | null
  /** The list filter: «بلا دورة» (`none`) comes first. */
  withNoCourse?: boolean
  placeholder?: string
  allowClear?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
  style?: CSSProperties
}

export function BankCoursePicker({ initial, withNoCourse = false, onChange, ...props }: BankCoursePickerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const fetchOptions = useCallback(
    (q: string, signal: AbortSignal) =>
      listCourses({ q, limit: OPTIONS_LIMIT }, signal).then((list) => {
        const courses: QuestionBankCourse[] = list.items.map((course) => ({ id: course.id, code: course.code, name: course.name }))
        // The extra options belong to the first page only: a search lists what it found.
        if (q !== '') return courses
        const first = initial && !courses.some((course) => course.id === initial.id) ? [initial, ...courses] : courses
        return withNoCourse ? [NO_COURSE, ...first] : first
      }),
    [initial, withNoCourse],
  )
  const toOption = (course: QuestionBankCourse): RemoteOption =>
    course.id === NO_COURSE_FILTER
      ? { value: NO_COURSE_FILTER, label: t('questionBanks.banks.noCourse') }
      : { value: course.id, label: `${course.code} — ${localizedLabel(course.name, language)}` }
  return (
    <RemoteSelect<QuestionBankCourse>
      fetchOptions={fetchOptions}
      toOption={toOption}
      emptyText={t('questionBanks.bankForm.noCourses')}
      onChange={(value) => onChange?.(value)}
      {...props}
    />
  )
}
