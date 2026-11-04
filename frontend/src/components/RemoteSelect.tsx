// A Select whose options come from the server (J-F01): the first page on mount,
// then a debounced search per typed text; stale answers are dropped and
// in-flight requests aborted. The label of the chosen option stays even when a
// later search no longer returns it. Works inside a Form.Item (value/onChange/id).
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

interface RemoteSelectProps<T> {
  /** Loads the options for a search text ('' = the first page). Memoise it: a new function reloads. */
  fetchOptions: (q: string, signal: AbortSignal) => Promise<T[]>
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

const SEARCH_DELAY_MS = 250

export function RemoteSelect<T>({ fetchOptions, toOption, value, onChange, emptyText, placeholder, allowClear, disabled, id, style, ...rest }: RemoteSelectProps<T>) {
  const [items, setItems] = useState<T[]>([])
  const [searching, setSearching] = useState(true)
  const [chosen, setChosen] = useState<{ item: T; option: RemoteOption } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controller = useRef<AbortController | null>(null)

  const run = useCallback(
    (q: string) => {
      controller.current?.abort()
      const current = new AbortController()
      controller.current = current
      fetchOptions(q, current.signal)
        .then((loaded) => {
          if (!current.signal.aborted) setItems(loaded)
        })
        .catch(() => {
          if (!current.signal.aborted) setItems([])
        })
        .finally(() => {
          if (!current.signal.aborted) setSearching(false)
        })
    },
    [fetchOptions],
  )

  useEffect(() => {
    run('')
    return () => {
      controller.current?.abort()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [run])

  const search = (text: string) => {
    if (timer.current) clearTimeout(timer.current)
    setSearching(true)
    timer.current = setTimeout(() => run(text.trim()), SEARCH_DELAY_MS)
  }

  const options = items.map(toOption)
  if (value !== undefined && chosen?.option.value === value && !options.some((option) => option.value === value)) options.unshift(chosen.option)

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
      loading={searching}
      options={options}
      notFoundContent={searching ? <Spin size="small" /> : <Typography.Text type="secondary">{emptyText}</Typography.Text>}
      onChange={(next) => {
        const item = items.find((candidate) => toOption(candidate).value === next)
        setChosen(item && next !== undefined ? { item, option: toOption(item) } : null)
        onChange?.(next, item ?? (chosen?.option.value === next ? chosen.item : undefined))
      }}
    />
  )
}
