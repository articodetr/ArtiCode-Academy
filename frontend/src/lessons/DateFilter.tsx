// The day filter of the two lessons lists — /lessons (J-F09) and «my lessons»
// (J-F11) — as one component (J-F25): a native date input whose value is a
// local `YYYY-MM-DD` day; the page turns it into the instants it sends
// (dayStartInstant / dayEndInstant).
// The guard is defensive (the owner's note 1 on #77): every current browser
// renders `type="date"` as a native picker, which only ever hands over a whole
// day or nothing. A browser that showed a plain text field instead would get a
// malformed value refused — but the field is controlled, so its text falls back
// to the parent's value after every key: such a browser takes a whole day
// pasted at once, never one typed character by character.
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
