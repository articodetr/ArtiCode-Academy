// The filters of the academy schedule (J-F08 on API-090): branch (or the
// academy's own site), room (narrowed to the branch), teacher (with
// `users.read`), class (with `classes.read`) and weekday — every value is sent
// to the server, which does the filtering; the date is the calendar's own.
import { Button, Select } from 'antd'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { Branch } from '../api/branches'
import { TeacherPicker } from '../classes/ClassPickers'
import { weekdayKey, weekdayOrder } from './timetable.format'
import { BranchSelect, ClassPicker, RoomPicker } from './TimetablePickers'
import type { AcademyFilters } from './useTimetable'

interface TimetableFiltersProps {
  filters: AcademyFilters
  onChange: (patch: Partial<AcademyFilters>) => void
  onClear: () => void
  canPickTeacher: boolean
  canPickClass: boolean
  branches: Branch[]
  weekStartsOn: number
  /** The phone layout: the filters stack, one per line at the panel's width. */
  phone: boolean
}

export function TimetableFilters({ filters, onChange, onClear, canPickTeacher, canPickClass, branches, weekStartsOn, phone }: TimetableFiltersProps) {
  const { t } = useTranslation()
  const active = Object.values(filters).some((value) => value !== undefined)
  // Side by side (tablet and desktop) each filter keeps a readable minimum width. A phone stacks them at the
  // panel's width (`.tt-mobile .tt-filters > *`), and an inline minimum would beat that rule — the class
  // filter's 220 px once pushed the panel past a 320 px screen (KI-056) — so a phone gets none.
  const widthOf = (minWidth: number): CSSProperties | undefined => (phone ? undefined : { minWidth })
  return (
    <div className="tt-filters" role="group" aria-label={t('schedule.filters.toggle')}>
      {branches.length > 0 ? (
        <BranchSelect branches={branches} value={filters.branchId} onChange={(branchId) => onChange({ branchId, roomId: undefined })} style={widthOf(190)} />
      ) : null}
      <RoomPicker
        branchId={filters.branchId}
        allowClear
        placeholder={t('schedule.filters.allRooms')}
        aria-label={t('schedule.columns.room')}
        value={filters.roomId}
        onChange={(roomId) => onChange({ roomId })}
        style={widthOf(190)}
      />
      {canPickTeacher ? (
        <TeacherPicker
          allowClear
          placeholder={t('schedule.filters.allTeachers')}
          aria-label={t('schedule.columns.teacher')}
          value={filters.teacherUserId}
          onChange={(teacherUserId) => onChange({ teacherUserId })}
          style={widthOf(190)}
        />
      ) : null}
      {canPickClass ? (
        <ClassPicker
          allowClear
          placeholder={t('schedule.filters.allClasses')}
          aria-label={t('schedule.columns.class')}
          value={filters.classId}
          onChange={(classId) => onChange({ classId })}
          style={widthOf(220)}
        />
      ) : null}
      <Select<number>
        allowClear
        aria-label={t('schedule.filters.weekday')}
        placeholder={t('schedule.filters.allWeekdays')}
        value={filters.weekday}
        onChange={(weekday) => onChange({ weekday: weekday ?? undefined })}
        options={weekdayOrder(weekStartsOn).map((weekday) => ({ value: weekday, label: t(`days.${weekdayKey(weekday)}`) }))}
        style={widthOf(150)}
      />
      {active ? (
        <Button type="link" onClick={onClear}>
          {t('schedule.filters.clear')}
        </Button>
      ) : null}
    </div>
  )
}
