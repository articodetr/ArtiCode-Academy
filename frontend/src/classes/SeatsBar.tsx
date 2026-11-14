// Seats taken over capacity as a bar (J-F01): shared by the classes list, the
// class drawer and the roster tab (J-F04) — in its own file so the roster tab
// does not import the drawer that mounts it. Redesign (2026-11-14): a slim navy
// bar under the count, chalk yellow once the class is full.
import './SeatsBar.css'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'

export function SeatsBar({ cls }: { cls: Pick<AcademyClass, 'enrolledCount' | 'capacity'> }) {
  const percent = cls.capacity > 0 ? Math.min(100, Math.round((cls.enrolledCount / cls.capacity) * 100)) : 0
  const full = cls.enrolledCount >= cls.capacity
  const { t } = useTranslation()
  return (
    <span className={full ? 'seats-bar seats-bar--full' : 'seats-bar'} role="meter" aria-label={`${t('classes.fields.seats')}: ${cls.enrolledCount} / ${cls.capacity}`} aria-valuemin={0} aria-valuemax={cls.capacity} aria-valuenow={cls.enrolledCount}>
      <span className="seats-bar__count tabular-nums" dir="ltr">{`${cls.enrolledCount} / ${cls.capacity}`}</span>
      <span className="seats-bar__track" aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </span>
    </span>
  )
}
