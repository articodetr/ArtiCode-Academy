// Weekly schedule tab of the class drawer (J-F07 on API-088/API-089). Everyone
// who can open the class reads its schedule (`classes.read` with the class's
// visibility — the server decides, D-R16). Holders of `schedule.manage` edit it
// while the class is planned, open or running (a completed or cancelled class
// is frozen — the server answers `class_not_schedulable`); the editor is
// mounted per session and saves the whole list as ONE PUT only on a diff. The
// week order and the working days come from the academy's scheduling settings.
import { EditOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Skeleton, Space, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { ScheduleEditor } from './ScheduleEditor'
import { ScheduleWeekView } from './ScheduleWeekView'
import { describeScheduleFailure, scheduleFailureMessage } from './schedule.errors'
import { isSchedulable } from './schedule.model'
import { useClassSchedule } from './useClassSchedule'
import { useSchedulingSettings } from './useSchedulingSettings'

interface ClassScheduleTabProps {
  cls: Pick<AcademyClass, 'id' | 'code' | 'status' | 'teachers'>
}

export function ClassScheduleTab({ cls }: ClassScheduleTabProps) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('schedule.manage')
  const { schedule, loading, error, reload, replace } = useClassSchedule(cls.id)
  const { settings } = useSchedulingSettings()
  const [editing, setEditing] = useState(false)
  const editable = canManage && isSchedulable(cls.status)

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
        {editable ? (
          <Button icon={<EditOutlined />} onClick={() => setEditing(true)} disabled={!schedule}>
            {t('classSchedule.edit')}
          </Button>
        ) : null}
      </Flex>

      {canManage && !editable ? <Alert type="info" showIcon message={t('classSchedule.frozen')} style={{ marginBottom: 12 }} /> : null}

      {error ? (
        <Alert
          type="error"
          showIcon
          message={scheduleFailureMessage(t, describeScheduleFailure(error, cls.id))}
          action={
            <Button size="small" onClick={reload}>
              {t('classSchedule.refresh')}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {loading && !schedule ? <Skeleton active paragraph={{ rows: 4 }} data-testid="schedule-loading" /> : null}

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
