// Server-backed selects of the lesson forms (J-F09): the class a lesson is
// created for (API-050 — completed and cancelled classes are offered disabled,
// the server refuses them with `class_closed`), the lesson's teacher among the
// class's teachers (API-051 shape; the server refuses anyone else with
// `teacher_not_assigned`) and a syllabus item of the class's course (API-048;
// `syllabus_item_mismatch` otherwise).
import { Select } from 'antd'
import { useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { listClasses } from '../api/classes'
import type { AcademyClass, ClassTeacher } from '../api/classes'
import type { Lesson } from '../api/lessons'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { NO_TEACHER } from './lessons.form'
import { syllabusItemLabel } from './lessons.format'
import { isClassOpenForLessons } from './lessons.status'
import { useSyllabusItems } from './useSyllabusItems'

const CLASS_OPTIONS_LIMIT = 20

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

/** The class of a new lesson: any class the caller may read, closed ones disabled with the reason as tooltip. */
export function LessonClassPicker(props: PickerProps<AcademyClass>) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const fetchOptions = useCallback((q: string, signal: AbortSignal) => listClasses({ q, limit: CLASS_OPTIONS_LIMIT }, signal).then((list) => list.items), [])
  const toOption = (cls: AcademyClass): RemoteOption => {
    const open = isClassOpenForLessons(cls.status)
    return {
      value: cls.id,
      label: `${cls.code} — ${localizedLabel(cls.name, language)}`,
      disabled: !open,
      title: open ? undefined : t('lessons.pickers.closedClass'),
    }
  }
  return <RemoteSelect<AcademyClass> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('lessons.pickers.noClasses')} {...props} />
}

interface LessonTeacherSelectProps {
  /**
   * The class's teachers (lead first); null while unknown — the class is not
   * chosen or loaded yet, or the caller lacks `classes.read` to read it.
   */
  teachers: readonly ClassTeacher[] | null
  /** Edit only: the lesson's current teacher, kept as an option even when no longer assigned (a snapshot — D-R33 (3)). */
  current?: Lesson['teacher']
  /** Creation: an empty value means the class's lead teacher (the server default). */
  mode: 'create' | 'edit'
  value?: string
  onChange?: (value: string | undefined) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

export function LessonTeacherSelect({ teachers, current, mode, value, onChange, disabled, id, ...rest }: LessonTeacherSelectProps) {
  const { t } = useTranslation()
  const known = teachers ?? []
  const options: { value: string; label: string }[] = known.map((teacher) => ({
    value: teacher.userId,
    label: `${teacher.fullName} — ${t(`lessons.teacherOptions.${teacher.role}`)}`,
  }))
  if (current && !known.some((teacher) => teacher.userId === current.userId)) {
    // «No longer assigned» only when the class's teachers are known; otherwise just the name.
    options.push({ value: current.userId, label: teachers ? `${current.fullName} — ${t('lessons.teacherOptions.unassigned')}` : current.fullName })
  }
  options.push({ value: NO_TEACHER, label: t('lessons.teacherOptions.none') })
  return (
    <Select<string>
      id={id}
      aria-label={rest['aria-label']}
      value={value}
      onChange={(next) => onChange?.(next)}
      options={options}
      disabled={disabled}
      allowClear={mode === 'create'}
      placeholder={mode === 'create' ? t('lessons.teacherOptions.default') : undefined}
    />
  )
}

interface SyllabusItemSelectProps {
  courseId: string | undefined
  /** Edit only: the lesson's current item, kept as an option while the syllabus loads or when it changed. */
  current?: Lesson['syllabusItem']
  value?: string
  onChange?: (value: string | undefined) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

export function SyllabusItemSelect({ courseId, current, value, onChange, disabled, id, ...rest }: SyllabusItemSelectProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { items, loading, error } = useSyllabusItems(courseId)
  const options = items.map((item) => ({ value: item.id, label: syllabusItemLabel(item, language) }))
  if (current && !items.some((item) => item.id === current.id)) options.unshift({ value: current.id, label: syllabusItemLabel(current, language) })
  const placeholder = error ? t('lessons.syllabus.loadFailed') : courseId && !loading && items.length === 0 ? t('lessons.syllabus.empty') : t('lessons.syllabus.placeholder')
  return (
    <Select<string>
      id={id}
      aria-label={rest['aria-label']}
      value={value}
      onChange={(next) => onChange?.(next)}
      options={options}
      loading={loading}
      disabled={disabled || !courseId || (options.length === 0 && !loading)}
      allowClear
      placeholder={placeholder}
      notFoundContent={t('lessons.syllabus.empty')}
    />
  )
}
