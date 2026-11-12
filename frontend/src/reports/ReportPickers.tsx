// The class filter of the reports (J-F53): any class the caller may read
// (API-050 — `classes.read`; a holder of it without `classes.manage` gets only
// the classes they teach, D-R16), of the chosen course when there is one, of
// every state — a report reads past and cancelled classes too. The course
// filter is the classes screens' CoursePicker (API-042).
import { useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { listClasses } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { refLabel } from './reports.sections'

const CLASS_OPTIONS_LIMIT = 20

interface ReportClassPickerProps {
  /** The classes of this course only. */
  courseId?: string
  value?: string
  onChange?: (value: string | undefined, item: AcademyClass | undefined) => void
  placeholder?: string
  id?: string
  'aria-label'?: string
  style?: CSSProperties
}

export function ReportClassPicker({ courseId, ...props }: ReportClassPickerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const fetchOptions = useCallback(
    (q: string, signal: AbortSignal) => listClasses({ q, courseId, limit: CLASS_OPTIONS_LIMIT }, signal).then((list) => list.items),
    [courseId],
  )
  // The label the report rows give a class: its code, then its name.
  const toOption = (cls: AcademyClass): RemoteOption => ({ value: cls.id, label: refLabel(cls, language) })
  return <RemoteSelect<AcademyClass> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('reports.filters.noClasses')} allowClear {...props} />
}
