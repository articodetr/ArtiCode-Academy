// Server-backed pickers of the classes screens (J-F01): courses through
// API-042 and teachers through API-012 (`role=teacher`, needs `users.read`);
// since J-F04 also students through API-012 (`role=student`) for the roster.
import { useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { listCourses } from '../api/courses'
import type { Course, CourseStatus } from '../api/courses'
import { listUsers } from '../api/users'
import type { UserListItem } from '../api/users'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, localizedLabel } from '../users/users.format'

const COURSE_OPTIONS_LIMIT = 20
/** Teachers and students alike (J-F01, J-F04). */
const TEACHER_OPTIONS_LIMIT = 10

interface PickerProps<T> {
  value?: string
  onChange?: (value: string | undefined, item: T | undefined) => void
  placeholder?: string
  allowClear?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
  style?: CSSProperties
}

interface CoursePickerProps extends PickerProps<Course> {
  /** `published` for a new class (a class needs a published course); absent = whatever the caller may read. */
  status?: CourseStatus
}

export function CoursePicker({ status, ...props }: CoursePickerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const fetchOptions = useCallback(
    (q: string, signal: AbortSignal) => listCourses({ q, status, limit: COURSE_OPTIONS_LIMIT }, signal).then((list) => list.items),
    [status],
  )
  const toOption = (course: Course): RemoteOption => ({ value: course.id, label: `${course.code} — ${localizedLabel(course.name, language)}` })
  return <RemoteSelect<Course> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('classes.pickers.noCourses')} {...props} />
}

interface TeacherPickerProps extends PickerProps<UserListItem> {
  /** Why a result cannot be chosen (shown disabled with this text as its tooltip). */
  refusalOf?: (candidate: UserListItem) => string | undefined
}

export function TeacherPicker({ refusalOf, ...props }: TeacherPickerProps) {
  const { t } = useTranslation()
  const fetchOptions = useCallback(
    (q: string, signal: AbortSignal) => listUsers({ q, role: 'teacher', limit: TEACHER_OPTIONS_LIMIT }, signal).then((list) => list.items),
    [],
  )
  const toOption = (candidate: UserListItem): RemoteOption => {
    const refusal = refusalOf?.(candidate)
    return { value: candidate.id, label: displayNameOf(candidate), disabled: refusal !== undefined, title: refusal }
  }
  return <RemoteSelect<UserListItem> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('classes.pickers.noTeachers')} {...props} />
}

interface StudentPickerProps extends PickerProps<UserListItem> {
  /** Why a result cannot be enrolled (shown disabled with this text as its tooltip). */
  refusalOf?: (candidate: UserListItem) => string | undefined
}

/** Students for the roster tab (J-F04): API-012 `role=student`, 10 results, needs `users.read`. */
export function StudentPicker({ refusalOf, ...props }: StudentPickerProps) {
  const { t } = useTranslation()
  const fetchOptions = useCallback(
    (q: string, signal: AbortSignal) => listUsers({ q, role: 'student', limit: TEACHER_OPTIONS_LIMIT }, signal).then((list) => list.items),
    [],
  )
  const toOption = (candidate: UserListItem): RemoteOption => {
    const refusal = refusalOf?.(candidate)
    return { value: candidate.id, label: displayNameOf(candidate), disabled: refusal !== undefined, title: refusal }
  }
  return <RemoteSelect<UserListItem> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('classes.enrollments.noStudents')} {...props} />
}
