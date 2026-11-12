import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { RemoteSelect } from './RemoteSelect'

interface Item {
  id: string
  name: string
}

const ITEMS: Item[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
]

const toOption = (item: Item) => ({ value: item.id, label: item.name })

/** The select with `value` given from outside — a form's initial value — and its options from `fetchOptions`. */
function renderSelect(value: string | undefined, onChange: (value: string | undefined, item: Item | undefined) => void) {
  const fetchOptions = vi.fn(async () => ITEMS)
  renderWithProviders(<RemoteSelect<Item> aria-label="pick" fetchOptions={fetchOptions} toOption={toOption} value={value} onChange={onChange} emptyText="none" allowClear />)
  return { fetchOptions }
}

const clearButton = () => screen.getByLabelText('pick').closest('.ant-select')!.querySelector('.ant-select-clear') as HTMLElement

describe('RemoteSelect', () => {
  it('clears a value it was given without an option picked first — a form’s initial value: onChange(undefined, undefined), no error (J-F48)', async () => {
    const onChange = vi.fn()
    renderSelect('a', onChange)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()

    fireEvent.click(clearButton())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(undefined, undefined)
  })

  it('hands the picked option’s item with its value', async () => {
    const onChange = vi.fn()
    renderSelect(undefined, onChange)
    fireEvent.mouseDown(screen.getByLabelText('pick'))
    fireEvent.click(await screen.findByText('Beta', { selector: '.ant-select-item-option-content' }))
    expect(onChange).toHaveBeenLastCalledWith('b', ITEMS[1])
  })
})
