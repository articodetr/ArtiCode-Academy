import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { DateFilter } from './DateFilter'

const LABEL = ar.lessons.filters.from

describe('DateFilter', () => {
  it('hands a real day over and a cleared field back as empty', () => {
    const onChange = vi.fn()
    const { rerender } = render(<DateFilter label={LABEL} value={undefined} onChange={onChange} />)
    const input = screen.getByLabelText(LABEL)
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toHaveValue('')

    fireEvent.change(input, { target: { value: '2026-11-01' } })
    expect(onChange).toHaveBeenLastCalledWith('2026-11-01')

    rerender(<DateFilter label={LABEL} value="2026-11-01" onChange={onChange} />)
    expect(input).toHaveValue('2026-11-01')
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('treats a malformed value as empty — what a browser without a native date field can hand over (J-F25)', () => {
    const onChange = vi.fn()
    render(<DateFilter label={LABEL} value={undefined} onChange={onChange} />)
    const input = screen.getByLabelText(LABEL) as HTMLInputElement
    // jsdom sanitises a date input's value like a browser with a date picker; a plain text field does not.
    input.type = 'text'

    fireEvent.change(input, { target: { value: '2026-02-30' } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    fireEvent.change(input, { target: { value: '01/11/2026' } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('is a defensive guard: a plain text field keeps no partly typed day, only a whole day pasted at once (the owner’s note 1 on #77)', () => {
    /** The page as it uses the filter: the day lives in the parent's state. */
    function Page() {
      const [day, setDay] = useState<string | undefined>()
      return <DateFilter label={LABEL} value={day} onChange={setDay} />
    }
    render(<Page />)
    const input = screen.getByLabelText(LABEL) as HTMLInputElement
    input.type = 'text'

    // The field is controlled: a partial text is refused and the field falls back to the parent's (empty) day.
    fireEvent.change(input, { target: { value: '2026-1' } })
    expect(input).toHaveValue('')
    fireEvent.change(input, { target: { value: '2026-11-01' } })
    expect(input).toHaveValue('2026-11-01')
    // Editing a held day into a partial text drops it: the parent holds no day any more.
    fireEvent.change(input, { target: { value: '2026-11-0' } })
    expect(input).toHaveValue('')
  })
})
