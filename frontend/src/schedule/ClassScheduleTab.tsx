// Weekly schedule tab of the class drawer (J-F07 on API-088/API-089). Everyone
// who can open the class reads its schedule (`classes.read` with the class's
// visibility — the server decides, D-R16). Holders of `schedule.manage` edit it
// while the class is planned, open or running (a completed or cancelled class
// is frozen — the server answers `class_not_schedulable`); the editor is
// mounted per session and saves the whole list as ONE PUT only on a diff. The
// week order and the working days come from the academy's scheduling settings.
// Since J-F16 the same managers generate the class's lessons from its slots
// (GenerateLessonsPanel on API-092) once the schedule has at least one slot;
// while the panel is open the header offers no other action. Since J-F21 a
// schedule that can no longer generate closes the panel for good, and the
// panel holds nothing for the class drawer's unsaved-work guard (only the
// editor's drafts do — PR #60 review, notes 1 and 2).
import { EditOutlined, ScheduleOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Skeleton, Space, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { GenerateLessonsPanel } from './GenerateLessonsPanel'
import { ScheduleEditor } from './ScheduleEditor'
import { ScheduleWeekView } from './ScheduleWeekView'
import { describeScheduleFailure, scheduleFailureMessage } from './schedule.errors'
import { defaultGenerationRange } from './schedule.generation'
import type { GenerationRange } from './schedule.generation'
import { isSchedulable, todayCalendarDate } from './schedule.model'
import { useClassSchedule } from './useClassSchedule'
import { useSchedulingSettings } from './useSchedulingSettings'

interface ClassScheduleTabProps {
  cls: Pick<AcademyClass, 'id' | 'code' | 'status' | 'teachers' | 'startsOn' | 'endsOn'>
  /**
   * Whether the editor's drafts differ from the server's slots (KI-052): the class drawer then keeps
   * Escape and a mask click from dropping them. The «generate lessons» panel reports nothing (J-F21).
   */
  onUnsavedChange?: (unsaved: boolean) => void
}

export function ClassScheduleTab({ cls, onUnsavedChange }: ClassScheduleTabProps) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('schedule.manage')
  const { schedule, loading, error, reload, replace } = useClassSchedule(cls.id)
  const { settings } = useSchedulingSettings()
  const [editing, setEditing] = useState(false)
  // The range of the open «generate lessons» panel (null = closed); it outlives a detour through the editor.
  const [generation, setGeneration] = useState<GenerationRange | null>(null)
  const editable = canManage && isSchedulable(cls.status)
  const generatable = editable && schedule !== null && schedule.slots.length > 0
  // The open panel with what it shows; null while closed or while the schedule cannot generate.
  const panel = generatable && schedule && generation ? { schedule, range: generation } : null

  // A schedule that can no longer generate (every slot removed, the class completed or cancelled)
  // closes the panel for good, so a slot added later does not reopen it (PR #60 review, note 2).
  // Adjusted in the render that sees the change — React's pattern for state that follows a value.
  const [wasGeneratable, setWasGeneratable] = useState(generatable)
  if (wasGeneratable !== generatable) {
    setWasGeneratable(generatable)
    if (!generatable) setGeneration(null)
  }

  if (editing && schedule) {
    // Mounted per edit session, so the drafts always start from the server's list.
    return (
      <ScheduleEditor
        cls={cls}
        schedule={schedule}
        settings={settings}
        onSaved={(updated) => {
          replace(updated)
          setEditing(false)
        }}
        onStale={() => {
          setEditing(false)
          reload()
        }}
        onCancel={() => setEditing(false)}
        onUnsavedChange={onUnsavedChange}
      />
    )
  }

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Typography.Text dir="ltr">{cls.code}</Typography.Text>
          <StatusTag value={cls.status} />
          {schedule ? <Typography.Text type="secondary">{t('classSchedule.summary', { count: schedule.slots.length })}</Typography.Text> : null}
        </Space>
        {editable && !panel ? (
          <Space wrap>
            {generatable ? (
              <Button icon={<ScheduleOutlined />} onClick={() => setGeneration(defaultGenerationRange(cls, todayCalendarDate()))}>
                {t('classSchedule.generate.open')}
              </Button>
            ) : null}
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)} disabled={!schedule}>
              {t('classSchedule.edit')}
            </Button>
          </Space>
        ) : null}
      </Flex>

      {canManage && !editable ? <Alert type="info" showIcon title={t('classSchedule.frozen')} style={{ marginBottom: 12 }} /> : null}

      {error ? (
        <Alert
          type="error"
          showIcon
          title={scheduleFailureMessage(t, describeScheduleFailure(error, cls.id))}
          action={
            <Button size="small" onClick={reload}>
              {t('classSchedule.refresh')}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {loading && !schedule ? <Skeleton active paragraph={{ rows: 4 }} data-testid="schedule-loading" /> : null}

      {panel ? (
        <GenerateLessonsPanel
          cls={cls}
          schedule={panel.schedule}
          range={panel.range}
          onRangeChange={setGeneration}
          onEditSchedule={() => setEditing(true)}
          onClose={() => setGeneration(null)}
        />
      ) : null}

      {schedule ? (
        schedule.slots.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('classSchedule.empty')} />
        ) : (
          <ScheduleWeekView slots={schedule.slots} weekStartsOn={settings.weekStartsOn} />
        )
      ) : null}
    </>
  )
}
