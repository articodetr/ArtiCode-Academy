// Server-backed filters of the academy schedule (J-F05; moved from
// schedule/SchedulePickers.tsx and extended by J-F08): a class through API-050
// (`classes.read`; a manager sees every class), a room through API-084 (every
// signed-in user; the list is small and has no search, so the typed text
// filters it on the client — narrowed to the chosen branch), and the branch
// through API-080 (every signed-in user; read once, small).
import { Select } from 'antd'
import { useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { Branch } from '../api/branches'
import { listClasses } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import { listRooms } from '../api/rooms'
import type { Room } from '../api/rooms'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { matchesRoom, roomLabel } from './timetable.format'
import { SITE_BRANCH } from './useTimetableBranches'

const CLASS_OPTIONS_LIMIT = 20

interface PickerProps<T> {
  value?: string
  onChange?: (value: string | undefined, item: T | undefined) => void
  placeholder?: string
  allowClear?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
  style?: CSSProperties
}

export function ClassPicker(props: PickerProps<AcademyClass>) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const fetchOptions = useCallback((q: string, signal: AbortSignal) => listClasses({ q, limit: CLASS_OPTIONS_LIMIT }, signal).then((list) => list.items), [])
  const toOption = (cls: AcademyClass): RemoteOption => ({ value: cls.id, label: `${cls.code} — ${localizedLabel(cls.name, language)}` })
  return <RemoteSelect<AcademyClass> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('schedule.pickers.noClasses')} {...props} />
}

/** Rooms of one branch (`branchId`, or `none` for the site) or of every branch (undefined). */
export function RoomPicker({ branchId, ...props }: PickerProps<Room> & { branchId?: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const fetchOptions = useCallback(
    (q: string, signal: AbortSignal) => listRooms(branchId ? { branchId } : {}, signal).then((list) => list.items.filter((room) => matchesRoom(room, q))),
    [branchId],
  )
  const toOption = (room: Room): RemoteOption => ({
    value: room.id,
    label: room.branch ? `${roomLabel(room, language)} (${room.branch.code})` : roomLabel(room, language),
    disabled: !room.isActive,
  })
  return <RemoteSelect<Room> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('schedule.pickers.noRooms')} {...props} />
}

interface BranchSelectProps {
  branches: Branch[]
  value?: string
  onChange: (value: string | undefined) => void
  style?: CSSProperties
}

/** All branches (cleared), the academy's own site (`none`), or one branch. */
export function BranchSelect({ branches, value, onChange, style }: BranchSelectProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const options = [
    { value: SITE_BRANCH, label: t('schedule.filters.site') },
    ...branches.map((branch) => ({
      value: branch.id,
      label: `${branch.code} — ${localizedLabel(branch.name, language)}${branch.isActive ? '' : ` (${t('labels.inactive')})`}`,
    })),
  ]
  return (
    <Select<string>
      allowClear
      aria-label={t('schedule.filters.branch')}
      placeholder={t('schedule.filters.allBranches')}
      value={value}
      onChange={(next) => onChange(next ?? undefined)}
      options={options}
      style={style}
      popupMatchSelectWidth={false}
    />
  )
}
