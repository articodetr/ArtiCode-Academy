// Selects of the assignment forms (J-F38): the class a new assignment is
// created for (API-050 — completed and cancelled classes are offered
// disabled, the server refuses them with `class_closed`) and the optional
// lesson of that class (one API-093 page from useClassLessons(); the server
// refuses a lesson of another class with `lesson_mismatch`). A lesson is
// labelled with its day in its own zone (`timeZone`, D-R41) and its title; a
// cancelled lesson stays selectable (the server accepts it) and says so.
import { Select } from 'antd'
import { useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssignmentLesson } from '../api/assignments'
import { listClasses } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { localizedLabel } from '../users/users.format'
import { formatZonedDay } from './assignments.format'
import { isClassOpenForAssignments } from './assignments.status'
import { lessonZoneOf } from './assignments.zone'
import type { ClassLessons } from './useClassLessons'

const CLASS_OPTIONS_LIMIT = 20

interface ClassPickerProps {
  value?: string
  onChange?: (value: string | undefined, item: AcademyClass | undefined) => void
  placeholder?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
  style?: CSSProperties
}

/** The class of a new assignment: any class the caller may read, closed ones disabled with the reason as tooltip. */
export function AssignmentClassPicker(props: ClassPickerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const fetchOptions = useCallback((q: string, signal: AbortSignal) => listClasses({ q, limit: CLASS_OPTIONS_LIMIT }, signal).then((list) => list.items), [])
  const toOption = (cls: AcademyClass): RemoteOption => {
    const open = isClassOpenForAssignments(cls.status)
    return {
      value: cls.id,
      label: `${cls.code} — ${localizedLabel(cls.name, language)}`,
      disabled: !open,
      title: open ? undefined : t('assignments.pickers.closedClass'),
    }
  }
  return <RemoteSelect<AcademyClass> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('assignments.pickers.noClasses')} {...props} />
}

interface LessonSelectProps {
  /** The lessons of the chosen class (useClassLessons()). */
  lessons: ClassLessons
  /** A class is chosen (creation) or fixed (edit). */
  hasClass: boolean
  /** The caller holds `lessons.read` (API-093 needs it). */
  canRead: boolean
  /** Edit only: the linked lesson, kept as an option while the list loads or when the page lacks it. */
  current?: AssignmentLesson | null
  /** The zone the current lesson's day is shown in (the assignment's `timeZone`). */
  currentZone?: string
  value?: string
  onChange?: (value: string | undefined) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

export function AssignmentLessonSelect({ lessons, hasClass, canRead, current, currentZone, value, onChange, disabled, id, ...rest }: LessonSelectProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  // A lesson without a zone (a server before D-R41) reads in this device's zone, as the lessons page shows it.
  const fallbackZone = currentZone ?? deviceTimeZone()
  const options = lessons.lessons.map((lesson) => {
    const day = formatZonedDay(lesson.startsAt, lessonZoneOf(lesson) ?? fallbackZone, language)
    const cancelled = lesson.status === 'cancelled' ? ` · ${t('labels.cancelled')}` : ''
    return { value: lesson.id, label: `${day} — ${localizedLabel(lesson.title, language)}${cancelled}` }
  })
  if (current && !options.some((option) => option.value === current.id)) {
    options.unshift({ value: current.id, label: `${formatZonedDay(current.startsAt, fallbackZone, language)} — ${localizedLabel(current.title, language)}` })
  }
  const placeholder = !canRead
    ? t('assignments.pickers.lessonNeedsLessonsRead')
    : !hasClass
      ? t('assignments.pickers.lessonNeedsClass')
      : lessons.error
        ? t('assignments.pickers.lessonsFailed')
        : !lessons.loading && options.length === 0
          ? t('assignments.pickers.noLessons')
          : t('assignments.pickers.lessonPlaceholder')
  return (
    <Select<string>
      id={id}
      aria-label={rest['aria-label']}
      value={value}
      onChange={(next) => onChange?.(next)}
      options={options}
      loading={lessons.loading}
      disabled={disabled || !canRead || !hasClass || (options.length === 0 && !lessons.loading)}
      allowClear
      showSearch={{ optionFilterProp: 'label' }}
      placeholder={placeholder}
      notFoundContent={t('assignments.pickers.noLessons')}
    />
  )
}
