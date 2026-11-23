// The frame every part of the learner home shares: a titled panel and its loading / failure states.
import { Alert, Button, Skeleton } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Loaded, Reloadable } from './useLoad'

/** The academy's zone, its today and the clock, as the learner home reads them. */
export interface DayContext {
  zone: string
  today: string
  now: number
  nowMinutes: number
}

/** How a row names its student when the page lists several. */
export type StudentName = (student: { fullName: string; displayName: string | null }) => string

export function Panel({ title, extra, children, className }: { title: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `db-panel ${className}` : 'db-panel'}>
      <header className="db-panel__head">
        <h2>{title}</h2>
        {extra}
      </header>
      {children}
    </section>
  )
}

export function Loading<T>({ loaded, children }: { loaded: Loaded<T> | Reloadable<T>; children: (data: T) => ReactNode }) {
  const { t } = useTranslation()
  if (loaded.loading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />
  if (loaded.error || loaded.data === null) {
    const retry = 'retry' in loaded ? loaded.retry : null
    return (
      <Alert
        type="warning"
        showIcon
        title={t('dashboard.cardFailed')}
        action={
          retry ? (
            <Button size="small" onClick={retry}>
              {t('dashboard.retry')}
            </Button>
          ) : undefined
        }
      />
    )
  }
  return <>{children(loaded.data)}</>
}
