import { act, fireEvent, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
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

/**
 * KI-120: a picker whose source depends on another value (a course status, a branch, an initial reference) showed the
 * options of the OLD source — and let them be picked — until the new one answered. Fake timers drive the debounce; each
 * request is held until the test answers it.
 */
describe('RemoteSelect — a new source (KI-120)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const DELTA: Item = { id: 'd', name: 'Delta' }

  interface Request {
    q: string
    signal: AbortSignal
    resolve: (items: Item[]) => void
  }

  function setup() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const requests: Record<'a' | 'b', Request[]> = { a: [], b: [] }
    const held = (name: 'a' | 'b') =>
      vi.fn(
        (q: string, signal: AbortSignal) =>
          new Promise<Item[]>((resolve) => {
            requests[name].push({ q, signal, resolve })
          }),
      )
    // Stable functions, as the pickers memoise theirs with useCallback: one per source.
    const sources = { a: held('a'), b: held('b') }
    const onChange = vi.fn()
    const controls: { setSource: (name: 'a' | 'b') => void; rerender: () => void } = { setSource: () => {}, rerender: () => {} }
    function Harness() {
      const [source, setSource] = useState<'a' | 'b'>('a')
      const [, setTick] = useState(0)
      useEffect(() => {
        controls.setSource = setSource
        controls.rerender = () => setTick((tick) => tick + 1)
      }, [])
      return <RemoteSelect<Item> aria-label="pick" fetchOptions={sources[source]} toOption={toOption} onChange={onChange} emptyText="none" />
    }
    renderWithProviders(<Harness />)
    const input = screen.getByLabelText('pick')
    const answer = async (name: 'a' | 'b', q: string, items: Item[]) => {
      const request = requests[name].find((candidate) => candidate.q === q)
      if (!request) throw new Error(`no request of ${name} for «${q}»`)
      await act(async () => {
        request.resolve(items)
      })
    }
    const shownOptions = () => Array.from(document.querySelectorAll('.ant-select-item-option-content')).map((node) => node.textContent)
    const pressEnter = () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
      fireEvent.keyUp(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
    }
    return { sources, requests, controls, input, answer, shownOptions, pressEnter, onChange }
  }

  it('drops the old source’s options at once, aborts its running search and asks the new source for the typed text', async () => {
    const { sources, requests, controls, input, answer, shownOptions, pressEnter, onChange } = setup()
    await answer('a', '', ITEMS)
    fireEvent.mouseDown(input)
    expect(shownOptions()).toEqual(['Alpha', 'Beta'])

    fireEvent.change(input, { target: { value: 'G' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    const running = requests.a.find((request) => request.q === 'G')!
    expect(running.signal.aborted).toBe(false)

    act(() => controls.setSource('b'))
    // From the render that brings the new source: nothing of the old one shows (the loading state does), so nothing
    // of it can be picked.
    expect(shownOptions()).toEqual([])
    expect(running.signal.aborted).toBe(true)
    expect(sources.b).toHaveBeenCalledTimes(1)
    expect(sources.b).toHaveBeenLastCalledWith('G', expect.any(AbortSignal))

    // A late answer of the old source never shows.
    await answer('a', 'G', [GAMMA])
    expect(shownOptions()).toEqual([])
    await answer('b', 'G', [DELTA])
    expect(shownOptions()).toEqual(['Delta'])
    pressEnter()
    expect(onChange).toHaveBeenCalledWith('d', DELTA)
  })

  it('drops the old options when the source changes with no search running, until the new source answers', async () => {
    const { sources, controls, input, answer, shownOptions } = setup()
    await answer('a', '', ITEMS)
    fireEvent.mouseDown(input)
    expect(shownOptions()).toEqual(['Alpha', 'Beta'])

    act(() => controls.setSource('b'))
    expect(shownOptions()).toEqual([])
    expect(sources.b).toHaveBeenLastCalledWith('', expect.any(AbortSignal))
    await answer('b', '', [DELTA])
    expect(shownOptions()).toEqual(['Delta'])
  })

  it('keeps the options and asks nothing when it renders again with the same source', async () => {
    const { sources, controls, input, answer, shownOptions } = setup()
    await answer('a', '', ITEMS)
    fireEvent.mouseDown(input)
    expect(shownOptions()).toEqual(['Alpha', 'Beta'])

    act(() => controls.rerender())
    act(() => controls.rerender())
    expect(shownOptions()).toEqual(['Alpha', 'Beta'])
    expect(sources.a).toHaveBeenCalledTimes(1)
    expect(sources.b).not.toHaveBeenCalled()
  })

  /** Types `text` and answers its search from source a with `items`. */
  async function typeAndAnswer(tools: ReturnType<typeof setup>, text: string, items: Item[]) {
    fireEvent.change(tools.input, { target: { value: text } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    await tools.answer('a', text, items)
  }

  it('asks a new source for nothing once an option was picked: the Select emptied its search box itself (review of KI-120)', async () => {
    const tools = setup()
    const { sources, controls, input, answer, shownOptions, onChange } = tools
    await answer('a', '', ITEMS)
    fireEvent.mouseDown(input)
    await typeAndAnswer(tools, 'Ga', [GAMMA])
    expect(shownOptions()).toEqual(['Gamma'])

    // The pick empties the box (@rc-component/select, without onSearch); the text typed before is no search any more.
    fireEvent.click(screen.getByText('Gamma', { selector: '.ant-select-item-option-content' }))
    expect(onChange).toHaveBeenLastCalledWith('g', GAMMA)
    expect(input).toHaveValue('')

    act(() => controls.setSource('b'))
    expect(sources.b).toHaveBeenCalledTimes(1)
    expect(sources.b).toHaveBeenLastCalledWith('', expect.any(AbortSignal))
  })

  it('asks a new source for nothing once the select lost the focus with a typed text: the box is empty again (review of KI-120)', async () => {
    const tools = setup()
    const { sources, controls, input, answer } = tools
    await answer('a', '', ITEMS)
    fireEvent.mouseDown(input)
    await typeAndAnswer(tools, 'Ga', [GAMMA])

    // A single select also closes on the blur, and its close effect hands onSearch('') over (@rc-component/select
    // 1.10.1 BaseSelect) — a guard: the blur keeps working whichever of the two empties the kept text.
    act(() => {
      input.blur()
    })
    fireEvent.blur(input)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(input).toHaveValue('')

    act(() => controls.setSource('b'))
    expect(sources.b).toHaveBeenLastCalledWith('', expect.any(AbortSignal))
    expect(sources.b.mock.calls.every(([q]) => q === '')).toBe(true)
  })
})
