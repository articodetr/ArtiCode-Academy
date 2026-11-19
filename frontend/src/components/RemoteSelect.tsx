// A Select whose options come from the server (J-F01): the first page on mount,
// then a debounced search per typed text; stale answers are dropped and
// in-flight requests aborted. The label of the chosen option stays even when a
// later search no longer returns it. Works inside a Form.Item (value/onChange/id).
// Since CH-0297: from the keystroke until the answer to the text typed, no
// option shows (the loading state does) — the options of the previous answer
// stayed, the first one active, and an Enter pressed at once picked it.
// Since KI-120: the same holds when the source changes. `fetchOptions` IS the
// source — a picker whose options depend on another value (a course status, a
// branch, an initial reference) passes a function memoised with useCallback over
// exactly those values, as every caller does, so a new function means a new
// source and nothing else does. From the render that brings it, the options of
// the old source no longer show nor can be picked (each answer is kept with the
// source that gave it), the old source's running request is aborted, and the
// new source is asked for the text in the search box: what was last typed, or
// '' once the Select emptied the box itself — @rc-component/select clears it
// after a pick and on a blur without calling `onSearch`, so a pick and a close
// reset the text kept here too. A re-render with the same function keeps the
// options and asks nothing; an unmemoised arrow would ask again at every render
// of its parent — never pass one.
import { Select, Spin, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

export interface RemoteOption {
  value: string
  label: ReactNode
  disabled?: boolean
  /** Tooltip, e.g. why the option is disabled. */
  title?: string
}

type FetchOptions<T> = (q: string, signal: AbortSignal) => Promise<T[]>

interface RemoteSelectProps<T> {
  /**
   * Loads the options for a search text ('' = the first page). Memoise it with useCallback over the values the source
   * depends on: a new function is a new source — the old options go and it is asked again (KI-120).
   */
  fetchOptions: FetchOptions<T>
  toOption: (item: T) => RemoteOption
  value?: string
  onChange?: (value: string | undefined, item: T | undefined) => void
  /** Shown when nothing matches (or the request failed). */
  emptyText: string
  placeholder?: string
  allowClear?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
  style?: CSSProperties
}

/** The items of one answer and the source that gave them. */
interface Answer<T> {
  source: FetchOptions<T> | null
  items: T[]
}

const SEARCH_DELAY_MS = 250

export function RemoteSelect<T>({ fetchOptions, toOption, value, onChange, emptyText, placeholder, allowClear, disabled, id, style, ...rest }: RemoteSelectProps<T>) {
  const [answer, setAnswer] = useState<Answer<T>>({ source: null, items: [] })
  const [searching, setSearching] = useState(true)
  const [chosen, setChosen] = useState<{ item: T; option: RemoteOption } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controller = useRef<AbortController | null>(null)
  // The text of the search box, asked again of a new source.
  const query = useRef('')
  // The Select empties its box after a pick and on a blur without calling onSearch (@rc-component/select): the text
  // kept here follows, or a new source would be asked for text no longer shown.
  const forgetQuery = () => {
    query.current = ''
  }

  const run = useCallback(
    (q: string) => {
      controller.current?.abort()
      const current = new AbortController()
      controller.current = current
      fetchOptions(q, current.signal)
        .then((loaded) => {
          if (!current.signal.aborted) setAnswer({ source: fetchOptions, items: loaded })
        })
        .catch(() => {
          if (!current.signal.aborted) setAnswer({ source: fetchOptions, items: [] })
        })
        .finally(() => {
          if (!current.signal.aborted) setSearching(false)
        })
    },
    [fetchOptions],
  )

  useEffect(() => {
    run(query.current)
    return () => {
      // A new source (or the unmount): the running request and the pending search answer the old one.
      controller.current?.abort()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [run])

  const search = (text: string) => {
    if (timer.current) clearTimeout(timer.current)
    // An answer to an older text must not land and show its options now (CH-0297).
    controller.current?.abort()
    query.current = text.trim()
    setSearching(true)
    timer.current = setTimeout(() => run(text.trim()), SEARCH_DELAY_MS)
  }

  // While a search runs the options answer an older text, and an answer of another source answers nothing asked now:
  // none shows, so an Enter picks nothing (CH-0297, KI-120). The chosen value keeps its label meanwhile — the Select
  // caches the label of its value.
  const waiting = searching || answer.source !== fetchOptions
  const items = waiting ? [] : answer.items
  const options: RemoteOption[] = items.map(toOption)
  if (!waiting && value !== undefined && chosen?.option.value === value && !options.some((option) => option.value === value)) options.unshift(chosen.option)

  return (
    <Select<string, RemoteOption>
      id={id}
      aria-label={rest['aria-label']}
      value={value}
      placeholder={placeholder}
      allowClear={allowClear}
      disabled={disabled}
      style={style}
      showSearch={{ onSearch: search, filterOption: false }}
      onOpenChange={(open) => {
        if (!open) forgetQuery()
      }}
      onBlur={forgetQuery}
      loading={waiting}
      options={options}
      notFoundContent={waiting ? <Spin size="small" /> : <Typography.Text type="secondary">{emptyText}</Typography.Text>}
      onChange={(next) => {
        forgetQuery()
        const item = items.find((candidate) => toOption(candidate).value === next)
        setChosen(item && next !== undefined ? { item, option: toOption(item) } : null)
        // A clear sends `next` undefined; `chosen` is null until an option was picked here — e.g. a value from a form's
        // initial values — so it must not be read then (J-F48: the edit form's room could not be cleared).
        onChange?.(next, item ?? (chosen !== null && chosen.option.value === next ? chosen.item : undefined))
      }}
    />
  )
}
