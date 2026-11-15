// The weekly calendar of /schedule (J-F08), on the two readings of MOD-07-T04:
// the academy's schedule (API-090, `schedule.manage` or `classes.manage`) with
// its filters, and «my schedule» (API-091, `schedule.read` by ownership). The
// server decides what each caller sees; this screen only hides the view a
// caller cannot use. "Today" and "now" are the academy's (API-035 time zone);
// the week starts on the academy's first day and shows its working days,
// never hiding a day that holds a slot. Every shown date is read on its own,
// so a slot appears exactly on the dates its effective period covers. A
// weekday filter keeps the selection on that weekday of its own week (J-F18),
// so the day view never shows another, empty day. Weekly slots are recurring
// entries, not confirmed lessons (MOD-06) — the page says so. Reading only:
// writing a class's slots belongs to the class screen.
import { CalendarOutlined, FilterOutlined, LeftOutlined, ReloadOutlined, RightOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { Alert, Badge, Button, ConfigProvider, Segmented, Spin, Switch, Tooltip } from 'antd'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import { PageHeader } from '../components/PageHeader'
import { directionOf } from '../i18n/language'
import { useLocalized } from '../i18n/useLocalized'
import { MiniMonth } from './MiniMonth'
import { DayTimeline, WeekAgenda, WeekStrip } from './MobileViews'
import { SlotDrawer } from './SlotDrawer'
import { addDays, calendarDateIn, datesFrom, minutesNowIn, monthOf, weekDatesOf, weekdayInWeek, weekdayOf } from './timetable.dates'
import type { CalendarDate, CalendarMonth } from './timetable.dates'
import { describeScheduleFailure, failureMessage } from './timetable.errors'
import { formatDateRange, formatLongDate, weekdayOrder } from './timetable.format'
import { visibleWeekdays } from './timetable.layout'
import { upcomingOccurrences } from './timetable.model'
import type { TimetableEntry, TimetableMode } from './timetable.model'
import { timetableSettingsOf } from './timetable.settings'
import { TimetableFilters } from './TimetableFilters'
import { useTimetableBranches } from './useTimetableBranches'
import { UpcomingPanel } from './UpcomingPanel'
import { useNow } from './useNow'
import { useTimetable } from './useTimetable'
import type { AcademyFilters } from './useTimetable'
import { WeekGrid } from './WeekGrid'
import type { GridDay } from './WeekGrid'
import './timetable.css'

export type TimetableView = 'week' | 'day'

/** The deep purple of the selected states; antd controls inside the calendar take it as their primary colour. */
const ACCENT = '#6a4fe0'
/** "Upcoming" looks this many days ahead (today included) and lists at most this many slots. */
const UPCOMING_DAYS = 7
const UPCOMING_LIMIT = 5
const NO_FILTERS: AcademyFilters = {}

const MOBILE_QUERY = '(max-width: 767.98px)'

function subscribeToViewport(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(MOBILE_QUERY)
  query.addEventListener?.('change', onChange)
  return () => query.removeEventListener?.('change', onChange)
}

function isPhoneViewport(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches
}

/** True on a phone-sized viewport (below antd's `md`), known from the first render. */
function useIsPhone(): boolean {
  return useSyncExternalStore(subscribeToViewport, isPhoneViewport, () => false)
}

export interface TimetableScreenProps {
  canReadAcademy: boolean
  canReadMine: boolean
  /** `users.read`: the teacher filter lists users. */
  canPickTeacher: boolean
  /** `classes.read`: the class filter lists classes. */
  canPickClass: boolean
}

export function TimetableScreen({ canReadAcademy, canReadMine, canPickTeacher, canPickClass }: TimetableScreenProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const rtl = directionOf(language) === 'rtl'
  const phone = useIsPhone()
  const academy = useAcademy()
  const settings = useMemo(() => timetableSettingsOf(academy.academy), [academy.academy])
  const settingsReady = academy.academy !== null || academy.error !== null
  const now = useNow()
  const today = calendarDateIn(settings.timeZone, now)
  const nowMinutes = minutesNowIn(settings.timeZone, now)

  const [mode, setMode] = useState<TimetableMode>(canReadAcademy ? 'academy' : 'mine')
  const [viewChoice, setViewChoice] = useState<TimetableView | null>(null)
  const view: TimetableView = viewChoice ?? (phone ? 'day' : 'week')
  const [filters, setFilters] = useState<AcademyFilters>({})
  const onlyWeekday = mode === 'academy' ? filters.weekday : undefined
  // With a weekday filter every selection is that weekday of its own week — the
  // day the week view shows alone — so "today", the month calendar, the week
  // strip and the arrows all land on a day the filter shows (J-F18).
  const onFilteredDay = (date: CalendarDate) => (onlyWeekday === undefined ? date : weekdayInWeek(date, onlyWeekday, settings.weekStartsOn))
  const home = onFilteredDay(today)
  const [picked, setPicked] = useState<CalendarDate | null>(null)
  const selected = picked === null ? home : onFilteredDay(picked)
  const [shownMonth, setShownMonth] = useState<CalendarMonth | null>(null)
  const month = shownMonth ?? monthOf(selected)
  const [showAllDays, setShowAllDays] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [monthOpen, setMonthOpen] = useState(false)
  const [opened, setOpened] = useState<{ entry: TimetableEntry; date: CalendarDate } | null>(null)
  const branches = useTimetableBranches(canReadAcademy && mode === 'academy')

  const activeFilters = mode === 'academy' ? filters : NO_FILTERS
  const weekDates = weekDatesOf(selected, settings.weekStartsOn)
  const upcomingDates = datesFrom(today, UPCOMING_DAYS)
  // The whole week is read in both views (the day view's strip marks busy days), plus the next seven days.
  const loadDates = [...new Set([...weekDates, ...upcomingDates])]
  const data = useTimetable(mode, activeFilters, loadDates, settingsReady && (mode === 'academy' ? canReadAcademy : canReadMine))

  const entriesOf = (date: CalendarDate) => data.byDate.get(date) ?? []
  const isOff = (date: CalendarDate) => settings.workingDays !== null && !settings.workingDays.includes(weekdayOf(date))
  const toDay = (date: CalendarDate): GridDay => ({
    date,
    weekday: weekdayOf(date),
    entries: entriesOf(date),
    isToday: date === today,
    isSelected: date === selected,
    isOff: isOff(date),
  })
  const busyDates = new Set(weekDates.filter((date) => entriesOf(date).length > 0))
  const visible = visibleWeekdays(weekdayOrder(settings.weekStartsOn), {
    workingDays: settings.workingDays,
    showAll: showAllDays,
    busy: new Set([...busyDates].map(weekdayOf)),
    selected: weekdayOf(selected),
    onlyWeekday,
  })
  const days = view === 'week' ? weekDates.filter((date) => visible.includes(weekdayOf(date))).map(toDay) : [toDay(selected)]
  const loading = !settingsReady || days.some((day) => data.pending.has(day.date))
  const empty = !loading && !data.failed && days.every((day) => day.entries.length === 0)
  const upcoming = upcomingOccurrences(data.byDate, upcomingDates, now, UPCOMING_LIMIT)
  const upcomingLoading = !settingsReady || upcomingDates.some((date) => data.pending.has(date))
  const failure = data.failed ? describeScheduleFailure(data.error) : null

  const pick = (date: CalendarDate) => {
    setPicked(date)
    setShownMonth(null)
  }
  const select = (date: CalendarDate) => pick(onFilteredDay(date))
  const step = view === 'week' || onlyWeekday !== undefined ? 7 : 1
  const go = (direction: 1 | -1) => select(addDays(selected, direction * step))
  const goToday = () => {
    setPicked(null)
    setShownMonth(null)
  }
  const changeFilters = (patch: Partial<AcademyFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    // A weekday filter moves the selection to that day of the shown week; clearing it stays on the day shown.
    if ('weekday' in patch) pick(patch.weekday === undefined ? selected : weekdayInWeek(selected, patch.weekday, settings.weekStartsOn))
  }
  const clearFilters = () => {
    setFilters({})
    if (filters.weekday !== undefined) pick(selected)
  }
  const open = (entry: TimetableEntry, date: CalendarDate) => setOpened({ entry, date })

  const rangeLabel = view === 'week' ? formatDateRange(days[0]!.date, days[days.length - 1]!.date, language) : formatLongDate(selected, language)
  const previousLabel = view === 'week' || onlyWeekday !== undefined ? t('schedule.calendar.previousWeek') : t('schedule.calendar.previousDay')
  const nextLabel = view === 'week' || onlyWeekday !== undefined ? t('schedule.calendar.nextWeek') : t('schedule.calendar.nextDay')
  const activeFilterCount = Object.values(filters).filter((value) => value !== undefined).length

  const modeSwitch =
    canReadAcademy && canReadMine ? (
      <Segmented<TimetableMode>
        className="tt-mode-switch"
        classNames={{ item: 'tt-mode-switch__item' }}
        aria-label={t('schedule.calendar.modeSwitch')}
        value={mode}
        onChange={(next) => {
          setMode(next)
          setOpened(null)
        }}
        options={[
          { value: 'academy', label: t('schedule.tabs.academy') },
          { value: 'mine', label: t('schedule.tabs.mine') },
        ]}
      />
    ) : null

  const viewSwitch = (
    <Segmented<TimetableView>
      aria-label={t('schedule.calendar.viewSwitch')}
      value={view}
      onChange={setViewChoice}
      options={[
        { value: 'day', label: t('schedule.calendar.dayView'), icon: phone ? undefined : <UnorderedListOutlined /> },
        { value: 'week', label: t('schedule.calendar.weekView'), icon: phone ? undefined : <CalendarOutlined /> },
      ]}
    />
  )

  const refresh = (
    <Tooltip title={t('schedule.filters.refresh')}>
      <Button icon={<ReloadOutlined />} aria-label={t('schedule.filters.refresh')} onClick={data.reload} />
    </Tooltip>
  )

  const todayButton = (
    <Button onClick={goToday} disabled={selected === home}>
      {t('schedule.calendar.today')}
    </Button>
  )
  const previousButton = <Button shape="circle" icon={rtl ? <RightOutlined /> : <LeftOutlined />} aria-label={previousLabel} onClick={() => go(-1)} />
  const nextButton = <Button shape="circle" icon={rtl ? <LeftOutlined /> : <RightOutlined />} aria-label={nextLabel} onClick={() => go(1)} />
  const range = (
    <h2 className="tt-toolbar__range" aria-live="polite">
      {rangeLabel}
    </h2>
  )

  const toolbar = phone ? (
    // Phones: the date between its arrows on one row, the actions on the next in two groups that wrap
    // as a whole — the view switch and refresh take a line of their own when the row is too narrow (KI-056).
    <div className="tt-toolbar tt-toolbar--phone">
      <div className="tt-toolbar__row">
        {previousButton}
        {range}
        {nextButton}
      </div>
      <div className="tt-toolbar__row tt-toolbar__row--actions">
        <div className="tt-toolbar__group">
          {todayButton}
          <Button icon={<CalendarOutlined />} aria-label={t('schedule.calendar.pickDate')} aria-expanded={monthOpen} onClick={() => setMonthOpen((value) => !value)} />
        </div>
        <div className="tt-toolbar__group tt-toolbar__group--end">
          {viewSwitch}
          {refresh}
        </div>
      </div>
    </div>
  ) : (
    <div className="tt-toolbar">
      <div className="tt-toolbar__nav">
        {todayButton}
        {previousButton}
        {nextButton}
        {range}
      </div>
      <div className="tt-toolbar__end">
        {view === 'week' && settings.workingDays !== null && onlyWeekday === undefined ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Switch size="small" checked={showAllDays} onChange={setShowAllDays} aria-label={t('schedule.calendar.allDays')} />
            <span aria-hidden="true">{t('schedule.calendar.allDays')}</span>
          </span>
        ) : null}
        {viewSwitch}
        {refresh}
      </div>
    </div>
  )

  const filtersBar =
    mode === 'academy' ? (
      <TimetableFilters
        filters={filters}
        onChange={changeFilters}
        onClear={clearFilters}
        canPickTeacher={canPickTeacher}
        canPickClass={canPickClass}
        branches={branches.items}
        weekStartsOn={settings.weekStartsOn}
        phone={phone}
      />
    ) : null

  const emptyCard = (
    <div className="tt-empty">
      <CalendarOutlined className="tt-empty__icon" aria-hidden="true" />
      <p className="tt-empty__title">{view === 'week' ? t('schedule.calendar.emptyWeek') : t('schedule.calendar.emptyDay')}</p>
      <p className="tt-empty__hint">{mode === 'academy' ? t('schedule.calendar.emptyHintAcademy') : t('schedule.calendar.emptyHintMine')}</p>
    </div>
  )

  const note = (
    <div className="tt-note">
      <span>{t('schedule.calendar.recurring')}</span>
      <span>{t('schedule.calendar.zone', { zone: settings.timeZone })}</span>
    </div>
  )

  const miniMonth = (
    <MiniMonth
      month={month}
      onMonthChange={setShownMonth}
      selected={selected}
      today={today}
      weekStartsOn={settings.weekStartsOn}
      band={view === 'week' ? { from: days[0]!.date, to: days[days.length - 1]!.date } : null}
      onSelect={(date) => {
        select(date)
        setMonthOpen(false)
      }}
      language={language}
    />
  )

  const upcomingPanel = <UpcomingPanel occurrences={upcoming} now={now} loading={upcomingLoading} failed={data.failed} language={language} onOpen={open} />

  const errorAlert = failure ? (
    <Alert
      type="error"
      showIcon
      role="alert"
      style={{ marginBottom: 16 }}
      title={t('schedule.calendar.failed')}
      description={failureMessage(t, failure)}
      action={
        <Button size="small" onClick={data.reload}>
          {t('schedule.calendar.retry')}
        </Button>
      }
    />
  ) : null

  const phoneBody = (
    <>
      <WeekStrip dates={weekDates} selected={selected} today={today} busy={busyDates} workingDays={settings.workingDays} language={language} onSelect={select} />
      {monthOpen ? <div style={{ marginBottom: 16 }}>{miniMonth}</div> : null}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <Spin aria-label={t('schedule.calendar.loading')} />
        </div>
      ) : view === 'day' ? (
        <DayTimeline
          date={selected}
          entries={entriesOf(selected)}
          nowMinutes={selected === today ? nowMinutes : null}
          language={language}
          academyTimeZone={settings.timeZone}
          onOpen={open}
          empty={empty ? emptyCard : null}
        />
      ) : (
        <WeekAgenda days={days} language={language} academyTimeZone={settings.timeZone} onOpen={open} />
      )}
      {note}
      <div style={{ marginTop: 20 }}>{upcomingPanel}</div>
    </>
  )

  const desktopBody = (
    <div className="tt-layout">
      <div style={{ minWidth: 0 }}>
        <WeekGrid
          days={days}
          language={language}
          academyTimeZone={settings.timeZone}
          nowMinutes={nowMinutes}
          label={view === 'week' ? t('schedule.calendar.grid') : formatLongDate(selected, language)}
          loading={loading}
          empty={empty ? emptyCard : null}
          onSelectDate={select}
          onOpen={open}
        />
        {note}
      </div>
      <aside className="tt-side" aria-label={t('schedule.calendar.side')}>
        {miniMonth}
        {upcomingPanel}
      </aside>
    </div>
  )

  return (
    <ConfigProvider theme={{ token: { colorPrimary: ACCENT } }}>
      <div className={phone ? 'tt tt-mobile' : 'tt'}>
        <PageHeader title={t('schedule.title')} subtitle={t('schedule.subtitle')} extra={modeSwitch} />
        {academy.error && !academy.academy ? <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={t('schedule.calendar.settingsFallback')} /> : null}
        <div className="tt-surface">
          {toolbar}
          {filtersBar && phone ? (
            <div style={{ marginBottom: 12 }}>
              <Badge count={activeFilterCount} size="small" color={ACCENT}>
                <Button icon={<FilterOutlined />} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
                  {t('schedule.filters.toggle')}
                </Button>
              </Badge>
            </div>
          ) : null}
          {filtersBar && (!phone || filtersOpen) ? filtersBar : null}
          {errorAlert}
          {phone ? phoneBody : desktopBody}
        </div>
        <SlotDrawer opened={opened} onClose={() => setOpened(null)} language={language} academyTimeZone={settings.timeZone} mobile={phone} />
      </div>
    </ConfigProvider>
  )
}
