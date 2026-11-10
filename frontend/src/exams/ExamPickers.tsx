// The class a new exam is created for (J-F45): any class the caller may read
// (API-050) — completed and cancelled classes are offered disabled with the
// reason, the server refuses them with `class_closed` (a new exam needs a
// planned, open or running class). The optional lesson of that class is the
// assignments' AssignmentLessonSelect (one API-093 page, the lesson's day in its
// own zone — D-R41), whose words name no assignment.
import { useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { listClasses } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { isClassOpenForNewExam } from './exams.status'

const CLASS_OPTIONS_LIMIT = 20

interface ExamClassPickerProps {
  value?: string
  onChange?: (value: string | undefined, item: AcademyClass | undefined) => void
  placeholder?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
  style?: CSSProperties
}

export function ExamClassPicker(props: ExamClassPickerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const fetchOptions = useCallback((q: string, signal: AbortSignal) => listClasses({ q, limit: CLASS_OPTIONS_LIMIT }, signal).then((list) => list.items), [])
  const toOption = (cls: AcademyClass): RemoteOption => {
    const open = isClassOpenForNewExam(cls.status)
    return {
      value: cls.id,
      label: `${cls.code} — ${localizedLabel(cls.name, language)}`,
      disabled: !open,
      title: open ? undefined : t('exams.pickers.closedClass'),
    }
  }
  return <RemoteSelect<AcademyClass> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('exams.pickers.noClasses')} {...props} />
}
