import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useKeysetList } from './useKeysetList'
import type { KeysetLoader, KeysetPage } from './useKeysetList'

interface Row {
  id: string
  label: string
}

interface Filters {
  q: string
  status: string | undefined
}

const INITIAL: Filters = { q: '', status: undefined }

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id, label: id }))

interface PendingLoad {
  filters: Filters
  cursor: string | undefined
  signal: AbortSignal
  resolve: (page: KeysetPage<Row>) => void
  reject: (error: unknown) => void
}

/** A loader whose every call waits until the test answers it, in whatever order the test chooses. */
function controlledLoader() {
  const calls: PendingLoad[] = []
  const load: KeysetLoader<Row, Filters> = (filters, cursor, signal) =>
    new Promise((resolve, reject) => {
      calls.push({ filters, cursor, signal, resolve, reject })
    })
  return { calls, load }
}

/** Mounts the hook and answers its first request with page one: rows `a`, `b` and the next cursor `c2`. */
async function firstPageLoaded() {
  const loader = controlledLoader()
  const hook = renderHook(() => useKeysetList(loader.load, INITIAL))
  await act(async () => loader.calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: 'c2' }))
  return { calls: loader.calls, result: hook.result }
}

describe('useKeysetList', () => {
  it('loads the first page, pushes the server cursor on «next» and pops it on «back»', async () => {
    const loader = controlledLoader()
    const { result } = renderHook(() => useKeysetList(loader.load, INITIAL))
    expect(result.current.loading).toBe(true)
    expect(loader.calls.map((call) => call.cursor)).toEqual([undefined])

    await act(async () => loader.calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: 'c2' }))
    expect(result.current).toMatchObject({ items: rows('a', 'b'), nextCursor: 'c2', loading: false, error: null, pageNumber: 1, canGoBack: false })

    act(() => result.current.next())
    expect(loader.calls.map((call) => call.cursor)).toEqual([undefined, 'c2'])
    expect(result.current).toMatchObject({ loading: true, pageNumber: 2, canGoBack: true })
    await act(async () => loader.calls[1]!.resolve({ items: rows('c'), nextCursor: null }))
    expect(result.current).toMatchObject({ items: rows('c'), nextCursor: null, loading: false, pageNumber: 2 })

    // The last page: «next» has nothing to push.
    act(() => result.current.next())
    expect(loader.calls).toHaveLength(2)
    expect(result.current.pageNumber).toBe(2)

    act(() => result.current.back())
    expect(loader.calls.map((call) => call.cursor)).toEqual([undefined, 'c2', undefined])
    expect(result.current).toMatchObject({ loading: true, pageNumber: 1, canGoBack: false })
    await act(async () => loader.calls[2]!.resolve({ items: rows('a', 'b'), nextCursor: 'c2' }))
    expect(result.current).toMatchObject({ items: rows('a', 'b'), nextCursor: 'c2', loading: false })

    // «back» on the first page stays there without a request.
    act(() => result.current.back())
    expect(loader.calls).toHaveLength(3)
    expect(result.current.pageNumber).toBe(1)
  })

  it('restarts from the first page on a filter change, aborts the requests in flight and drops their late answers', async () => {
    const { calls, result } = await firstPageLoaded()
    act(() => result.current.next())
    expect(calls[1]!.cursor).toBe('c2')

    act(() => result.current.setFilters({ status: 'open' }))
    expect(calls[1]!.signal.aborted).toBe(true)
    expect(calls[2]).toMatchObject({ filters: { q: '', status: 'open' }, cursor: undefined })
    expect(result.current).toMatchObject({ filters: { q: '', status: 'open' }, loading: true, pageNumber: 1, canGoBack: false })

    act(() => result.current.setFilters({ q: 'py' }))
    expect(calls[2]!.signal.aborted).toBe(true)
    expect(calls[3]).toMatchObject({ filters: { q: 'py', status: 'open' }, cursor: undefined })

    // The aborted requests answer late — with rows, or with the abort error: neither reaches the screen.
    await act(async () => calls[1]!.resolve({ items: rows('stale'), nextCursor: 'stale-cursor' }))
    await act(async () => calls[2]!.reject(new DOMException('The operation was aborted.', 'AbortError')))
    expect(result.current).toMatchObject({ items: rows('a', 'b'), error: null, loading: true })

    await act(async () => calls[3]!.resolve({ items: rows('d'), nextCursor: null }))
    expect(result.current).toMatchObject({ items: rows('d'), nextCursor: null, error: null, loading: false, pageNumber: 1 })
  })

  it('keeps the rows behind the error of a failed «next» but not their cursor, so «next» cannot push it again (PR #26 note 4)', async () => {
    const { calls, result } = await firstPageLoaded()
    act(() => result.current.next())
    const failure = new Error('boom')
    await act(async () => calls[1]!.reject(failure))

    expect(result.current.error).toBe(failure)
    expect(result.current).toMatchObject({ items: rows('a', 'b'), nextCursor: null, loading: false, pageNumber: 2, canGoBack: true })
    act(() => result.current.next())
    expect(calls).toHaveLength(2)
    expect(result.current.pageNumber).toBe(2)

    // «back» reads the page before again, and its answer brings its own cursor back.
    act(() => result.current.back())
    expect(calls[2]!.cursor).toBeUndefined()
    await act(async () => calls[2]!.resolve({ items: rows('a', 'b'), nextCursor: 'c2' }))
    expect(result.current).toMatchObject({ error: null, nextCursor: 'c2', loading: false, pageNumber: 1, canGoBack: false })
  })

  it('drops the cursor of the previous filters when the new filters fail to load; a reload retries the same request', async () => {
    const { calls, result } = await firstPageLoaded()
    act(() => result.current.setFilters({ q: 'py' }))
    const failure = new Error('offline')
    await act(async () => calls[1]!.reject(failure))

    expect(result.current.error).toBe(failure)
    // `c2` belongs to the first page of the old filters: sent with `q=py` it would ask for another list.
    expect(result.current).toMatchObject({ items: rows('a', 'b'), nextCursor: null, loading: false, pageNumber: 1, canGoBack: false })

    act(() => result.current.reload())
    expect(calls[2]).toMatchObject({ filters: { q: 'py', status: undefined }, cursor: undefined })
    expect(result.current.loading).toBe(true)
    await act(async () => calls[2]!.resolve({ items: rows('py-1'), nextCursor: 'py-2' }))
    expect(result.current).toMatchObject({ items: rows('py-1'), nextCursor: 'py-2', error: null, loading: false })
  })

  it('replaces and removes rows on screen without a request', async () => {
    const { calls, result } = await firstPageLoaded()
    act(() => result.current.replaceItem({ id: 'b', label: 'B2' }))
    expect(result.current.items).toEqual([
      { id: 'a', label: 'a' },
      { id: 'b', label: 'B2' },
    ])
    act(() => result.current.removeItem('a'))
    expect(result.current.items).toEqual([{ id: 'b', label: 'B2' }])
    expect(result.current).toMatchObject({ nextCursor: 'c2', loading: false, pageNumber: 1 })
    expect(calls).toHaveLength(1)
  })
})
