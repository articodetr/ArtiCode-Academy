// Server-backed pickers of the finance forms (MOD-11): a class (API-050, needs
// `classes.read`) or a course (API-042, needs `courses.read`) on the shared
// RemoteSelect. Each option is a small reference `{ id, code, name, courseId? }`;
// the value a form starts from (an edited plan's course or class) is put first
// in the first page, so it shows by name and never as a raw id.
import { useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { listClasses } from '../api/classes'
import { listCourses } from '../api/courses'
import type { LocalizedLabel } from '../api/users'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'

const OPTIONS_LIMIT = 20

export interface FinanceRef {
  id: string
  code: string
  name: LocalizedLabel
  /** The class's course (classes only). */
  courseId?: string
}

interface FinancePickerProps {
  value?: string
  onChange?: (value: string | undefined, item: FinanceRef | undefined) => void
  /** The reference the form starts from, shown by name. */
  initial?: FinanceRef | null
  placeholder?: string
  allowClear?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
  style?: CSSProperties
}

function withInitial(items: FinanceRef[], q: string, initial: FinanceRef | null | undefined): FinanceRef[] {
  if (!initial || q !== '' || items.some((item) => item.id === initial.id)) return items
  return [initial, ...items]
}

function useToOption() {
  const { language } = useLocalized()
  return (ref: FinanceRef): RemoteOption => ({ value: ref.id, label: `${ref.code} — ${localizedLabel(ref.name, language)}` })
}

export function FinanceClassPicker({ initial, ...props }: FinancePickerProps) {
  const { t } = useTranslation()
  const toOption = useToOption()
  const fetchOptions = useCallback(
    (q: string, signal: AbortSignal) =>
      listClasses({ q, limit: OPTIONS_LIMIT }, signal).then((list) =>
        withInitial(
          list.items.map((cls) => ({ id: cls.id, code: cls.code, name: cls.name, courseId: cls.course.id })),
          q,
          initial,
        ),
      ),
    [initial],
  )
  return <RemoteSelect<FinanceRef> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('payments.form.noClasses')} {...props} />
}

export function FinanceCoursePicker({ initial, ...props }: FinancePickerProps) {
  const { t } = useTranslation()
  const toOption = useToOption()
  const fetchOptions = useCallback(
    (q: string, signal: AbortSignal) =>
      listCourses({ q, limit: OPTIONS_LIMIT }, signal).then((list) =>
        withInitial(
          list.items.map((course) => ({ id: course.id, code: course.code, name: course.name })),
          q,
          initial,
        ),
      ),
    [initial],
  )
  return <RemoteSelect<FinanceRef> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('classes.pickers.noCourses')} {...props} />
}
