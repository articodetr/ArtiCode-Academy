// The day filter of the two lessons lists — /lessons (J-F09) and «my lessons»
// (J-F11) — as one component (J-F25): a native date input whose value is a
// local `YYYY-MM-DD` day; the page turns it into the instants it sends
// (dayStartInstant / dayEndInstant).
import { dateFilterValue } from './lessons.format'

interface DateFilterProps {
  value: string | undefined
  /** A real day, or undefined when the field is cleared or holds a malformed value (dateFilterValue). */
  onChange: (value: string | undefined) => void
  label: string
}

export function DateFilter({ value, onChange, label }: DateFilterProps) {
  return <input type="date" aria-label={label} className="ant-input" value={value ?? ''} onChange={(event) => onChange(dateFilterValue(event.target.value))} style={{ width: 170 }} />
}
