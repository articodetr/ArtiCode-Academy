// The global search (redesign, 2026-11-14): a box in the header (Ctrl+K or «/» from anywhere) that opens a
// search panel. Before typing it suggests — unread notifications, the actions this viewer may take, the recent
// searches; while typing it matches pages and actions locally (both languages, Arabic spelling variants ignored)
// and asks the server for people, classes, courses, invoices, receipts and certificates — each only with the key
// the server checks, and a number-looking query («INV-…», «RCPT-…», a serial) goes to its own kind first.
// A record opens on its page through `?open=<id>` (useOpenFromSearch). Arrow keys move, Enter opens, Esc closes.
import {
  AppstoreOutlined,
  BellOutlined,
  BookOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { Input, Modal, Spin } from 'antd'
import type { InputRef } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { listCertificates } from '../api/certificates'
import { listClasses } from '../api/classes'
import { listCourses } from '../api/courses'
import { listInvoices } from '../api/invoices'
import { listMyAssignments } from '../api/myAssignments'
import { listPayments } from '../api/payments'
import { REPORT_KEYS, getReportsOverview } from '../api/reports'
import { listUsers } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { OPEN_PARAM } from '../common/useOpenFromSearch'
import { useLocalized } from '../i18n/useLocalized'
import { canAccess, navFor } from '../layout/navigation'
import { useUnreadCount } from '../notifications/useUnreadCount'
import { localizedLabel, roleLabel } from '../users/users.format'
import { PAGE_KEYWORDS, SEARCH_MIN_LENGTH, actionsFor, forgetRecent, matchScore, numberPart, queryKind, readRecent, rememberRecent } from './search.data'
import type { QueryKind, RecentEntry } from './search.data'
import './search.css'

type Group = 'recent' | 'suggested' | 'pages' | 'users' | 'classes' | 'courses' | 'invoices' | 'receipts' | 'certificates'

interface Result {
  key: string
  group: Group
  title: string
  subtitle?: string
  path: string
  icon: ReactNode
}

const GROUP_ICONS: Record<Group, ReactNode> = {
  recent: <ClockCircleOutlined />,
  suggested: <ThunderboltOutlined />,
  pages: <AppstoreOutlined />,
  users: <UserOutlined />,
  classes: <AppstoreOutlined />,
  courses: <BookOutlined />,
  invoices: <FileTextOutlined />,
  receipts: <WalletOutlined />,
  certificates: <SafetyCertificateOutlined />,
}

const openPath = (path: string, id: string) => `${path}?${OPEN_PARAM}=${encodeURIComponent(id)}`

/** The server searches a viewer may run, in the order that suits the query's kind. */
function remoteOrder(kind: QueryKind): Group[] {
  if (kind === 'invoice') return ['invoices']
  if (kind === 'receipt') return ['receipts']
  if (kind === 'serial') return ['certificates', 'invoices', 'receipts']
  if (kind === 'email') return ['users']
  return ['users', 'classes', 'courses', 'certificates', 'invoices', 'receipts']
}

export function GlobalSearch() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const { unread } = useUnreadCount()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [remote, setRemote] = useState<{ query: string; results: Result[]; loading: boolean }>({ query: '', results: [], loading: false })
  const [recent, setRecent] = useState<RecentEntry[]>([])
  /** Live counts that rank the suggestions (what waits most comes first); read when the panel opens. */
  const [signals, setSignals] = useState<Partial<Record<string, number>>>({})
  const inputRef = useRef<InputRef>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const viewer = user ? { role: user.role, roles: user.roles, permissions: user.permissions } : null
  const can = (navKey: string) => (viewer ? canAccess(viewer, navKey) : false)
  const pages = useMemo(() => (viewer ? navFor(viewer) : []), [viewer?.role, viewer?.roles.join(), viewer?.permissions.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/Cmd+K anywhere, «/» outside a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((event.key === 'k' || event.key === 'K') && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        setOpen(true)
      } else if (event.key === '/' && !typing) {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open || !user) return
    setRecent(readRecent(user.id))
    setQuery('')
    setActive(0)
    const controller = new AbortController()
    const counts: Partial<Record<string, number>> = {}
    const reads: Promise<void>[] = []
    if (REPORT_KEYS.some((key) => hasPermission(key))) {
      reads.push(
        getReportsOverview(controller.signal).then((overview) => {
          if (overview.academic) counts.reviewSubmissions = overview.academic.awaitingReview
          const overdue = (overview.financial?.outstanding ?? []).reduce((sum, row) => sum + row.studentsOverdue, 0)
          if (overview.financial) counts.recordPayment = overdue
        }),
      )
    }
    if (can('myAssignments')) {
      reads.push(listMyAssignments({ pending: true, limit: 50 }, controller.signal).then((list) => void (counts.handIn = list.items.length)))
    }
    void Promise.all(reads.map((read) => read.catch(() => undefined))).then(() => {
      if (!controller.signal.aborted) setSignals(counts)
    })
    // Focus once the modal has mounted its input.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // `can`/`hasPermission` follow the viewer, which does not change while the panel is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user])

  const trimmed = query.trim()
  const kind = queryKind(trimmed)

  // The server searches, 250 ms after the last key, the older ones aborted.
  useEffect(() => {
    if (!open || trimmed.length < SEARCH_MIN_LENGTH) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setRemote({ query: trimmed, results: [], loading: true })
      const signal = controller.signal
      const readers: Partial<Record<Group, () => Promise<Result[]>>> = {}
      if (hasPermission('users.read') && can('users')) {
        readers.users = () =>
          listUsers({ q: trimmed.slice(0, 200), limit: 5 }, signal).then((list) =>
            list.items.map((item) => ({ key: `u:${item.id}`, group: 'users', title: item.fullName, subtitle: [item.email, item.roles.map((role) => roleLabel(role, t)).join(language === 'ar' ? '، ' : ', ')].filter(Boolean).join(' · '), path: openPath('/users', item.id), icon: GROUP_ICONS.users })),
          )
      }
      if (can('classes')) {
        readers.classes = () =>
          listClasses({ q: trimmed.slice(0, 100), limit: 5 }, signal).then((list) =>
            list.items.map((item) => ({ key: `k:${item.id}`, group: 'classes', title: localizedLabel(item.name, language), subtitle: `${item.code} · ${localizedLabel(item.course.name, language)}`, path: openPath('/classes', item.id), icon: GROUP_ICONS.classes })),
          )
      }
      if (can('courses')) {
        readers.courses = () =>
          listCourses({ q: trimmed.slice(0, 100), limit: 5 }, signal).then((list) =>
            list.items.map((item) => ({ key: `c:${item.id}`, group: 'courses', title: localizedLabel(item.name, language), subtitle: item.code, path: openPath('/courses', item.id), icon: GROUP_ICONS.courses })),
          )
      }
      const financeReader = ['invoices.read_all', 'invoices.manage', 'payments.record'].some((key) => hasPermission(key)) && can('payments')
      const looksLikeNumber = /\d/.test(trimmed) || kind !== 'text'
      if (financeReader && looksLikeNumber) {
        readers.invoices = () =>
          listInvoices({ q: numberPart(trimmed).slice(0, 32), limit: 5 }, signal).then((list) =>
            list.items.map((item) => ({ key: `i:${item.id}`, group: 'invoices', title: item.number ?? t('search.draftInvoice'), subtitle: item.student.fullName, path: openPath('/payments', item.id), icon: GROUP_ICONS.invoices })),
          )
        readers.receipts = () =>
          listPayments({ q: numberPart(trimmed).slice(0, 32), limit: 5 }, signal).then((list) =>
            list.items.map((item) => ({ key: `p:${item.id}`, group: 'receipts', title: item.number, subtitle: `${item.invoice.number ?? ''} · ${item.student.fullName}`, path: openPath('/payments', item.invoice.id), icon: GROUP_ICONS.receipts })),
          )
      }
      if (['certificates.read_all', 'certificates.issue'].some((key) => hasPermission(key)) && can('certificates') && looksLikeNumber) {
        readers.certificates = () =>
          listCertificates({ q: numberPart(trimmed).slice(0, 32), limit: 5 }, signal).then((list) =>
            list.items.map((item) => ({ key: `z:${item.id}`, group: 'certificates', title: item.serial, subtitle: item.student.fullName, path: openPath('/certificates', item.id), icon: GROUP_ICONS.certificates })),
          )
      }
      const order = remoteOrder(kind).filter((group) => readers[group])
      void Promise.all(order.map((group) => readers[group]!().catch(() => [] as Result[]))).then((lists) => {
        if (!signal.aborted) setRemote({ query: trimmed, results: lists.flat(), loading: false })
      })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // `can`/`hasPermission`/`t` follow the viewer and language, which do not change while the panel is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trimmed, kind, language])

  const actions = viewer ? actionsFor(can, hasPermission) : []

  const results: Result[] = useMemo(() => {
    if (trimmed.length === 0) {
      const suggested: Result[] = []
      if (unread && unread > 0 && can('notifications')) {
        suggested.push({ key: 'a:unread', group: 'suggested', title: t('search.actions.unread', { count: unread }), path: '/notifications', icon: <BellOutlined /> })
      }
      // What waits most comes first (the server's counts); the rest keep their order.
      const ranked = [...actions].sort((a, b) => (signals[b.key] ?? 0) - (signals[a.key] ?? 0))
      for (const action of ranked.slice(0, 5)) {
        const count = signals[action.key]
        suggested.push({
          key: `a:${action.key}`,
          group: 'suggested',
          title: t(`search.actions.${action.key}`),
          subtitle: count ? t(`search.waiting.${action.key}`, { count }) : undefined,
          path: action.path,
          icon: GROUP_ICONS.suggested,
        })
      }
      const recents = recent.map((entry, index) => ({ key: `r:${index}:${entry.path}`, group: 'recent' as Group, title: entry.title, subtitle: entry.subtitle, path: entry.path, icon: GROUP_ICONS.recent }))
      return [...suggested, ...recents]
    }
    const local: Array<Result & { score: number }> = []
    for (const action of actions) {
      const label = t(`search.actions.${action.key}`)
      const score = Math.max(matchScore(trimmed, label), matchScore(trimmed, action.keywords) - 10)
      if (score > 0) local.push({ key: `a:${action.key}`, group: 'suggested', title: label, path: action.path, icon: GROUP_ICONS.suggested, score: score + 1 })
    }
    for (const page of pages) {
      const label = t(page.labelKey)
      const score = Math.max(matchScore(trimmed, label), matchScore(trimmed, PAGE_KEYWORDS[page.key] ?? '') - 10)
      if (score > 0) local.push({ key: `n:${page.key}`, group: 'pages', title: label, path: page.path, icon: page.icon, score })
    }
    local.sort((a, b) => b.score - a.score)
    const server = remote.query === trimmed ? remote.results : []
    // A number-looking query puts the records first; words put the pages and actions first.
    return kind === 'text' ? [...local.slice(0, 6), ...server] : [...server, ...local.slice(0, 4)]
  }, [trimmed, kind, remote, actions, pages, recent, unread, signals, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const loading = trimmed.length >= SEARCH_MIN_LENGTH && (remote.query !== trimmed || remote.loading)

  useEffect(() => {
    setActive(0)
  }, [trimmed])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (result: Result) => {
    if (user && result.group !== 'suggested' && result.group !== 'recent') {
      rememberRecent(user.id, { title: result.title, subtitle: result.subtitle, path: result.path, group: result.group })
    }
    setOpen(false)
    navigate(result.path)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(results.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault()
      choose(results[active])
    }
  }

  if (!user) return null

  // Group headings in order of appearance.
  let lastGroup: Group | null = null
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  return (
    <>
      <button type="button" className="gsearch-trigger" onClick={() => setOpen(true)} aria-label={t('search.open')}>
        <SearchOutlined />
        <span className="gsearch-trigger__text">{t('search.trigger')}</span>
        <kbd className="gsearch-trigger__kbd" dir="ltr">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      <Modal open={open} onCancel={() => setOpen(false)} footer={null} closable={false} width={640} className="gsearch" destroyOnHidden style={{ top: 72 }}>
        <Input
          ref={inputRef}
          size="large"
          variant="borderless"
          prefix={<SearchOutlined />}
          suffix={loading ? <Spin size="small" /> : null}
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t('search.placeholder')}
          role="combobox"
          aria-expanded
          aria-controls="gsearch-results"
          aria-activedescendant={results[active] ? `gsearch-${active}` : undefined}
        />
        <div className="gsearch-body">
          {results.length === 0 ? (
            <p className="gsearch-empty">
              {trimmed.length === 0 ? t('search.nothingYet') : trimmed.length < SEARCH_MIN_LENGTH ? t('search.minChars', { count: SEARCH_MIN_LENGTH }) : loading ? t('search.searching') : t('search.empty', { query: trimmed })}
            </p>
          ) : (
            <ul id="gsearch-results" role="listbox" ref={listRef} className="gsearch-list">
              {results.map((result, index) => {
                const heading = result.group !== lastGroup ? result.group : null
                lastGroup = result.group
                return (
                  <li key={result.key} role="presentation">
                    {heading ? (
                      <div className="gsearch-group" role="presentation">
                        <span>{t(`search.groups.${heading}`)}</span>
                        {heading === 'recent' ? (
                          <button
                            type="button"
                            className="gsearch-clear"
                            onClick={() => {
                              forgetRecent(user.id)
                              setRecent([])
                            }}
                          >
                            {t('search.clearRecent')}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <div
                      id={`gsearch-${index}`}
                      role="option"
                      aria-selected={index === active}
                      data-active={index === active}
                      className={index === active ? 'gsearch-item gsearch-item--active' : 'gsearch-item'}
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(result)}
                    >
                      <span className="gsearch-item__icon" aria-hidden="true">
                        {result.icon}
                      </span>
                      <span className="gsearch-item__text">
                        <b>{result.title}</b>
                        {result.subtitle ? <small>{result.subtitle}</small> : null}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <footer className="gsearch-foot">{t('search.hint')}</footer>
      </Modal>
    </>
  )
}
