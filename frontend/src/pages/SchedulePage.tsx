// Schedule (MOD-07 — J-F05): the academy's weekly schedule (API-090, for
// holders of `schedule.manage` or `classes.manage`, with class/teacher/room
// filters and the date the slots must be effective on) and «my schedule»
// (API-091, `schedule.read` — the caller's own classes as student, guardian
// or teacher). The server decides what each caller sees; the page only hides
// the view a caller cannot use. Writing the weekly slots belongs to the class
// screen (API-089).
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Flex, Tabs, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/auth-context'
import { TeacherPicker } from '../classes/ClassPickers'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import { ScheduleTable } from '../schedule/ScheduleTable'
import type { ScheduleView } from '../schedule/ScheduleTable'
import { ClassPicker, RoomPicker } from '../schedule/SchedulePickers'
import { describeScheduleFailure, failureMessage } from '../schedule/schedule.errors'
import { ACADEMY_SCHEDULE_PERMISSIONS, MY_SCHEDULE_PERMISSION, academyRow, dateParam, myRow } from '../schedule/schedule.format'
import { useAcademySchedule, useMySchedule } from '../schedule/useSchedule'
import { formatDay } from '../users/users.format'

function DateFilter({ value, onChange, label }: { value: string | undefined; onChange: (value: string | undefined) => void; label: string }) {
  return (
    <input
      type="date"
      aria-label={label}
      className="ant-input"
      value={value ?? ''}
      onChange={(event) => onChange(dateParam(event.target.value))}
      style={{ width: 170 }}
    />
  )
}

export function SchedulePage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canReadAcademy = ACADEMY_SCHEDULE_PERMISSIONS.some((key) => hasPermission(key))
  const canReadMine = hasPermission(MY_SCHEDULE_PERMISSION)
  const canPickTeacher = hasPermission('users.read')
  const [view, setView] = useState<ScheduleView>(canReadAcademy ? 'academy' : 'mine')
  const academy = useAcademySchedule(canReadAcademy && view === 'academy')
  const mine = useMySchedule(canReadMine && view === 'mine')

  const current = view === 'academy' ? academy : mine
  const failure = current.error ? describeScheduleFailure(current.error) : null
  const on = view === 'academy' ? academy.data?.on : mine.data?.on
  const rows = view === 'academy' ? (academy.data?.slots ?? []).map((slot) => academyRow(slot, language)) : (mine.data?.items ?? []).map((item) => myRow(item, language))

  if (!canReadAcademy && !canReadMine) {
    return (
      <>
        <PageHeader title={t('schedule.title')} subtitle={t('schedule.subtitle')} />
        <Alert type="warning" showIcon message={t('schedule.noAccess')} />
      </>
    )
  }

  const filters =
    view === 'academy' ? (
      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <DateFilter label={t('schedule.filters.date')} value={academy.filters.on} onChange={(value) => academy.setFilters({ on: value })} />
        <ClassPicker
          allowClear
          placeholder={t('schedule.filters.allClasses')}
          aria-label={t('schedule.columns.class')}
          value={academy.filters.classId}
          onChange={(value) => academy.setFilters({ classId: value })}
          style={{ minWidth: 240 }}
        />
        {canPickTeacher ? (
          <TeacherPicker
            allowClear
            placeholder={t('schedule.filters.allTeachers')}
            aria-label={t('schedule.columns.teacher')}
            value={academy.filters.teacherUserId}
            onChange={(value) => academy.setFilters({ teacherUserId: value })}
            style={{ minWidth: 200 }}
          />
        ) : null}
        <RoomPicker
          allowClear
          placeholder={t('schedule.filters.allRooms')}
          aria-label={t('schedule.columns.room')}
          value={academy.filters.roomId}
          onChange={(value) => academy.setFilters({ roomId: value })}
          style={{ minWidth: 200 }}
        />
        <Button icon={<ReloadOutlined />} onClick={academy.reload} aria-label={t('schedule.filters.refresh')} />
      </Flex>
    ) : (
      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <DateFilter label={t('schedule.filters.date')} value={mine.filters.on} onChange={(value) => mine.setFilters({ on: value })} />
        <Button icon={<ReloadOutlined />} onClick={mine.reload} aria-label={t('schedule.filters.refresh')} />
      </Flex>
    )

  const body = (
    <>
      {filters}
      {failure ? (
        <Alert
          type="error"
          showIcon
          message={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={current.reload}>
              {t('schedule.filters.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {on ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {t('schedule.effectiveOn', { date: formatDay(on, language) })}
        </Typography.Paragraph>
      ) : null}
      <ScheduleTable rows={rows} view={view} loading={current.loading} emptyText={view === 'academy' ? t('schedule.empty.academy') : t('schedule.empty.mine')} />
    </>
  )

  return (
    <>
      <PageHeader title={t('schedule.title')} subtitle={t('schedule.subtitle')} />
      <Card>
        {canReadAcademy && canReadMine ? (
          <Tabs
            activeKey={view}
            onChange={(key) => setView(key as ScheduleView)}
            items={[
              { key: 'academy', label: t('schedule.tabs.academy'), children: view === 'academy' ? body : null },
              { key: 'mine', label: t('schedule.tabs.mine'), children: view === 'mine' ? body : null },
            ]}
          />
        ) : (
          body
        )}
      </Card>
    </>
  )
}
