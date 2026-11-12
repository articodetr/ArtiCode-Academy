// State of «my invoices» (J-F52): API-155 has no pagination, so this is one
// request per filter change (and per reload), aborted when the filters change
// before it answers; a failure keeps the last list behind the error. The
// students and classes the filters offer are gathered from every answer read
// so far, so narrowing the list never takes its own options away.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listMyInvoices } from '../api/myInvoices'
import type { ListMyInvoicesParams, MyInvoiceItem } from '../api/myInvoices'
import type { MyClassRelation } from '../api/enrollments'
import type { InvoiceClass } from '../api/invoices'

export interface MyInvoiceStudentOption {
  id: string
  fullName: string
  displayName: string | null
  relation: MyClassRelation
}

interface MyInvoicesState {
  key: string
  items: MyInvoiceItem[]
  error: unknown
}

function personName(person: { fullName: string; displayName: string | null }): string {
  return person.displayName?.trim() || person.fullName
}

/** The students of the items: the caller first, then the children by name. */
export function studentOptionsOf(items: readonly MyInvoiceItem[]): MyInvoiceStudentOption[] {
  const byId = new Map<string, MyInvoiceStudentOption>()
  for (const item of items) if (!byId.has(item.student.id)) byId.set(item.student.id, { ...item.student, relation: item.relation })
  return [...byId.values()].sort((a, b) => (a.relation === b.relation ? personName(a).localeCompare(personName(b)) : a.relation === 'self' ? -1 : 1))
}

/** The classes the items are tied to, by code. */
export function classOptionsOf(items: readonly MyInvoiceItem[]): InvoiceClass[] {
  const byId = new Map<string, InvoiceClass>()
  for (const item of items) if (item.enrollment && !byId.has(item.enrollment.class.id)) byId.set(item.enrollment.class.id, item.enrollment.class)
  return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code))
}

export function useMyInvoices() {
  const [filters, setFiltersState] = useState<ListMyInvoicesParams>({})
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<MyInvoicesState>({ key: '', items: [], error: null })
  const [seen, setSeen] = useState<MyInvoiceItem[]>([])
  const requestKey = JSON.stringify([filters, reloadTick])
  const loading = state.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    listMyInvoices(filters, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        setState({ key: requestKey, items: list.items, error: null })
        setSeen((current) => [...current, ...list.items.filter((item) => !current.some((known) => known.id === item.id))])
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [filters, requestKey])

  const setFilters = useCallback((patch: Partial<ListMyInvoicesParams>) => setFiltersState((current) => ({ ...current, ...patch })), [])
  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])
  const students = useMemo(() => studentOptionsOf(seen), [seen])
  const classes = useMemo(() => classOptionsOf(seen), [seen])

  return { filters, setFilters, items: state.items, error: state.error, loading, reload, students, classes }
}
