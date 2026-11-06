// Server-backed filters of the academy schedule (J-F05): a class through
// API-050 (`classes.read`; a manager sees every class) and a room through
// API-084 (every signed-in user; the list is small and has no search, so the
// typed text filters it on the client).
import { useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { listClasses } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import { listRooms } from '../api/rooms'
import type { Room } from '../api/rooms'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { matchesRoom, roomLabel } from './schedule.format'

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

export function RoomPicker(props: PickerProps<Room>) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const fetchOptions = useCallback((q: string, signal: AbortSignal) => listRooms({}, signal).then((list) => list.items.filter((room) => matchesRoom(room, q))), [])
  const toOption = (room: Room): RemoteOption => ({
    value: room.id,
    label: room.branch ? `${roomLabel(room, language)} (${room.branch.code})` : roomLabel(room, language),
    disabled: !room.isActive,
  })
  return <RemoteSelect<Room> fetchOptions={fetchOptions} toOption={toOption} emptyText={t('schedule.pickers.noRooms')} {...props} />
}
