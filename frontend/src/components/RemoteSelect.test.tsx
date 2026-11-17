import { act, fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

const GAMMA: Item = { id: 'g', name: 'Gamma' }

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

/**
 * CH-0297: an Enter pressed right after typing picked the first option of the PREVIOUS answer (the class drawer's
 * teachers editor added the wrong teacher). Fake timers drive the 250 ms debounce; every request is held until the
 * test answers it, so the window between the keystroke and the answer is explicit.
 */
describe('RemoteSelect — Enter before the answer to the typed text (CH-0297)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  interface Held {
    resolve: (items: Item[]) => void
  }

  function setup(options: { controlled?: boolean } = {}) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const held = new Map<string, Held>()
    const fetchOptions = vi.fn(
      (q: string) =>
        new Promise<Item[]>((resolve) => {
          held.set(q, { resolve })
        }),
    )
    const onChange = vi.fn()
    function Controlled() {
      const [value, setValue] = useState<string | undefined>(undefined)
      return (
        <RemoteSelect<Item>
          aria-label="pick"
          fetchOptions={fetchOptions}
          toOption={toOption}
          value={value}
          onChange={(next, item) => {
            setValue(next)
            onChange(next, item)
          }}
          emptyText="none"
        />
      )
    }
    renderWithProviders(
      options.controlled ? <Controlled /> : <RemoteSelect<Item> aria-label="pick" fetchOptions={fetchOptions} toOption={toOption} onChange={onChange} emptyText="none" />,
    )
    const input = screen.getByLabelText('pick')
    /** Answers the request for `q` (it must have been sent). */
    const answer = async (q: string, items: Item[]) => {
      const request = held.get(q)
      if (!request) throw new Error(`no request for «${q}»`)
      await act(async () => {
        request.resolve(items)
      })
    }
    const type = (text: string) => fireEvent.change(input, { target: { value: text } })
    const pressEnter = () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
      fireEvent.keyUp(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
    }
    const afterDebounce = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })
    const shownOptions = () => Array.from(document.querySelectorAll('.ant-select-item-option-content')).map((node) => node.textContent)
    return { fetchOptions, onChange, input, answer, type, pressEnter, afterDebounce, shownOptions }
  }

  it('picks nothing on an Enter pressed right after typing, before the search is even sent', async () => {
    const { onChange, input, answer, type, pressEnter, shownOptions, fetchOptions } = setup()
    await answer('', ITEMS)
    fireEvent.mouseDown(input)
    expect(shownOptions()).toEqual(['Alpha', 'Beta'])

    type('Ga')
    // The options of the first page no longer show: the loading state does.
    expect(shownOptions()).toEqual([])
    pressEnter()
    expect(onChange).not.toHaveBeenCalled()
    expect(fetchOptions).toHaveBeenCalledTimes(1)
  })

  it('picks nothing on an Enter pressed while the search for the typed text runs', async () => {
    const { onChange, input, answer, type, pressEnter, afterDebounce, shownOptions, fetchOptions } = setup()
    await answer('', ITEMS)
    fireEvent.mouseDown(input)

    type('Ga')
    await afterDebounce()
    expect(fetchOptions).toHaveBeenLastCalledWith('Ga', expect.any(AbortSignal))
    expect(shownOptions()).toEqual([])
    pressEnter()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('picks the answered option on an Enter pressed after the answer to the typed text', async () => {
    const { onChange, input, answer, type, pressEnter, afterDebounce, shownOptions } = setup()
    await answer('', ITEMS)
    fireEvent.mouseDown(input)

    type('Ga')
    await afterDebounce()
    await answer('Ga', [GAMMA])
    expect(shownOptions()).toEqual(['Gamma'])
    pressEnter()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('g', GAMMA)
  })

  it('never shows an answer to an older text that lands after a newer keystroke', async () => {
    const { onChange, input, answer, type, pressEnter, afterDebounce, shownOptions } = setup()
    await answer('', ITEMS)
    fireEvent.mouseDown(input)

    type('G')
    await afterDebounce()
    type('Ga')
    // The answer to «G» arrives after «Ga» was typed: it answers an older text.
    await answer('G', ITEMS)
    expect(shownOptions()).toEqual([])
    pressEnter()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the chosen value’s label while a search runs, never its raw value', async () => {
    const { onChange, input, answer, type, afterDebounce } = setup({ controlled: true })
    await answer('', ITEMS)
    fireEvent.mouseDown(input)
    fireEvent.click(screen.getByText('Beta', { selector: '.ant-select-item-option-content' }))
    expect(onChange).toHaveBeenLastCalledWith('b', ITEMS[1])

    fireEvent.mouseDown(input)
    type('x')
    await afterDebounce()
    // Escape closes the list: the search text is cleared and the first page is asked again.
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 })
    const content = input.closest('.ant-select')!.querySelector('.ant-select-content') as HTMLElement
    expect(content).toHaveTextContent('Beta')
    expect(content).toHaveAttribute('title', 'Beta')
  })
})
