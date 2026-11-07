// Schedule (MOD-07 — J-F05, redesigned as a weekly calendar by J-F08): the
// academy's weekly schedule (API-090, for holders of `schedule.manage` or
// `classes.manage`, with branch/room/teacher/class/weekday filters) and «my
// schedule» (API-091, `schedule.read` — the caller's own classes as student,
// guardian or teacher). The server decides what each caller sees; the page
// only hides the view a caller cannot use. Writing the weekly slots belongs
// to the class screen (API-089). The calendar lives in ../timetable/.
import { Alert } from 'antd'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { ACADEMY_SCHEDULE_PERMISSIONS, MY_SCHEDULE_PERMISSION } from '../timetable/timetable.format'
import { TimetableScreen } from '../timetable/TimetableScreen'

export function SchedulePage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canReadAcademy = ACADEMY_SCHEDULE_PERMISSIONS.some((key) => hasPermission(key))
  const canReadMine = hasPermission(MY_SCHEDULE_PERMISSION)

  if (!canReadAcademy && !canReadMine) {
    return (
      <>
        <PageHeader title={t('schedule.title')} subtitle={t('schedule.subtitle')} />
        <Alert type="warning" showIcon title={t('schedule.noAccess')} />
      </>
    )
  }

  return <TimetableScreen canReadAcademy={canReadAcademy} canReadMine={canReadMine} canPickTeacher={hasPermission('users.read')} canPickClass={hasPermission('classes.read')} />
}
