// Editor of a class's weekly schedule (J-F07 on API-089), mounted per edit
// session so the drafts always start from the server's list. One card per
// slot: weekday (the academy's working days — D-R28 — are the only enabled
// ones), start and end times, a room from GET /api/rooms (inactive rooms stay
// only where a kept slot already names them), a teacher from the class's own
// teachers (D-R26), and the effective range. Every local problem (schedule.model.ts)
// blocks the save; the whole list is saved as ONE PUT only when it differs
// from the server's; a refusal is mapped by schedule.errors.ts and, for a
// conflict, the refused row is highlighted. The server stays the boundary.
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Empty, Flex, Input, Row, Select, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { listRooms } from '../api/rooms'
import type { Room } from '../api/rooms'
import { replaceClassSchedule } from '../api/schedule'
import type { ClassSchedule } from '../api/schedule'
import { useLocalized } from '../i18n/useLocalized'
import { describeScheduleFailure, isStaleFailure, scheduleFailureMessage } from './schedule.errors'
import type { ScheduleFailure } from './schedule.errors'
import { roomLabel } from './schedule.format'
import { SCHEDULE_SLOTS_MAX, draftListProblems, newSlotDraft, orderedWeekdays, planScheduleReplacement, slotDraftsOf, todayCalendarDate } from './schedule.model'
import type { SlotDraft, SlotProblems } from './schedule.model'
import type { SchedulingSettingsView } from './schedule.settings'

interface ScheduleEditorProps {
  cls: Pick<AcademyClass, 'id' | 'teachers'>
  schedule: ClassSchedule
  settings: SchedulingSettingsView
  /** The schedule the server returned after the replacement. */
  onSaved: (schedule: ClassSchedule) => void
  /** The server's schedule or the class changed meanwhile: leave the editor and re-read. */
  onStale: () => void
  onCancel: () => void
}

const DANGER_BORDER = '#ff4d4f'

export function ScheduleEditor({ cls, schedule, settings, onSaved, onStale, onCancel }: ScheduleEditorProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [drafts, setDrafts] = useState<SlotDraft[]>(() => slotDraftsOf(schedule.slots))
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [roomsFailed, setRoomsFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<ScheduleFailure | null>(null)
  const nextKey = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    listRooms({}, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setRooms(list.items)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setRooms([])
        setRoomsFailed(true)
      })
    return () => controller.abort()
  }, [])

  const order = orderedWeekdays(settings.weekStartsOn)
  const problems = draftListProblems(drafts, settings.workingDays)
  const full = drafts.length >= SCHEDULE_SLOTS_MAX

  const add = () => {
    if (full) return
    nextKey.current += 1
    setDrafts((current) => [...current, newSlotDraft(`new-${nextKey.current}`, { effectiveFrom: todayCalendarDate() })])
  }
  const patch = (key: string, changes: Partial<SlotDraft>) => setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...changes } : draft)))
  const remove = (key: string) => setDrafts((current) => current.filter((draft) => draft.key !== key))

  /** Label of a room by id: the rooms list first, then the room a kept slot came with. */
  const roomLabelOf = (roomId: string): string | undefined => {
    const room = rooms?.find((candidate) => candidate.id === roomId) ?? schedule.slots.find((slot) => slot.room?.id === roomId)?.room
    return room ? roomLabel(room, language) : undefined
  }
  const teacherOf = (userId: string): string | undefined => cls.teachers.find((teacher) => teacher.userId === userId)?.fullName

  const teacherOptions = cls.teachers.map((teacher) => ({ value: teacher.userId, label: `${teacher.fullName} — ${t(`classes.teacherRoles.${teacher.role}`)}` }))
  const roomOptionsFor = (draft: SlotDraft) => {
    const options = (rooms ?? [])
      .filter((room) => room.isActive || room.id === draft.roomId)
      // The marker leads the label: a narrow select cuts the end off (seen in the real-backend run).
      .map((room) => ({ value: room.id, label: room.isActive ? roomLabel(room, language) : t('classSchedule.inactiveRoomOption', { room: roomLabel(room, language) }) }))
    // A kept slot may name a room the list does not hold (failed load): keep its label.
    if (draft.roomId !== null && !options.some((option) => option.value === draft.roomId)) options.unshift({ value: draft.roomId, label: roomLabelOf(draft.roomId) ?? draft.roomId })
    return options
  }

  const save = async () => {
    if (problems) return
    const body = planScheduleReplacement(schedule.slots, drafts)
    if (!body) {
      message.info(t('classSchedule.nothingChanged'))
      onCancel()
      return
    }
    setSaving(true)
    setFailure(null)
    try {
      const updated = await replaceClassSchedule(cls.id, body)
      message.success(t('classSchedule.saved'))
      onSaved(updated)
    } catch (caught) {
      const described = describeScheduleFailure(caught, cls.id, { roomOf: roomLabelOf, teacherOf }, drafts)
      if (isStaleFailure(described)) {
        message.error(scheduleFailureMessage(t, described))
        onStale()
        return
      }
      setFailure(described)
      setSaving(false)
    }
  }

  const conflict = problems?.conflict ?? null
  const highlighted = (index: number) => failure?.slotIndex === index || conflict?.first === index || conflict?.second === index

  return (
    <div data-testid="schedule-editor">
      {failure ? <Alert type="error" showIcon title={scheduleFailureMessage(t, failure)} style={{ marginBottom: 12 }} /> : null}
      {conflict ? (
        <Alert type="warning" showIcon title={t(`classSchedule.conflict.${conflict.kind}`, { first: conflict.first + 1, second: conflict.second + 1 })} style={{ marginBottom: 12 }} />
      ) : null}
      {problems?.tooMany ? <Alert type="warning" showIcon title={t('classSchedule.validation.tooMany', { max: SCHEDULE_SLOTS_MAX })} style={{ marginBottom: 12 }} /> : null}
      {roomsFailed ? <Alert type="info" showIcon title={t('classSchedule.roomsFailed')} style={{ marginBottom: 12 }} /> : null}
      {cls.teachers.length === 0 ? <Alert type="info" showIcon title={t('classSchedule.noTeachers')} style={{ marginBottom: 12 }} /> : null}

      <Flex justify="flex-end" style={{ marginBottom: 12 }}>
        <Button icon={<PlusOutlined />} onClick={add} disabled={saving || full} title={full ? t('classSchedule.maxReached', { max: SCHEDULE_SLOTS_MAX }) : undefined}>
          {t('classSchedule.addSlot')}
        </Button>
      </Flex>

      {drafts.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('classSchedule.emptyDraft')} />
      ) : (
        drafts.map((draft, index) => (
          <SlotCard
            key={draft.key}
            draft={draft}
            index={index}
            problems={problems?.rows.get(draft.key) ?? {}}
            highlighted={highlighted(index)}
            order={order}
            workingDays={settings.workingDays}
            roomOptions={roomOptionsFor(draft)}
            roomsLoading={rooms === null}
            teacherOptions={teacherOptions}
            disabled={saving}
            onChange={(changes) => patch(draft.key, changes)}
            onRemove={() => remove(draft.key)}
          />
        ))
      )}

      <Flex gap={8} justify="flex-end" wrap style={{ marginTop: 12 }}>
        <Button onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" onClick={() => void save()} loading={saving} disabled={problems !== null}>
          {t('classSchedule.save')}
        </Button>
      </Flex>
    </div>
  )
}

interface SlotCardProps {
  draft: SlotDraft
  index: number
  problems: SlotProblems
  highlighted: boolean
  order: readonly number[]
  workingDays: readonly number[] | null
  roomOptions: { value: string; label: string }[]
  roomsLoading: boolean
  teacherOptions: { value: string; label: string }[]
  disabled: boolean
  onChange: (changes: Partial<SlotDraft>) => void
  onRemove: () => void
}

function SlotCard({ draft, index, problems, highlighted, order, workingDays, roomOptions, roomsLoading, teacherOptions, disabled, onChange, onRemove }: SlotCardProps) {
  const { t } = useTranslation()
  const n = index + 1
  const label = (field: string) => t(`classSchedule.fields.${field}`)
  const problem = (field: keyof SlotProblems) => (problems[field] ? t(`classSchedule.validation.${problems[field]}`) : undefined)
  const status = (field: keyof SlotProblems) => (problems[field] ? 'error' : undefined)

  return (
    <Card
      size="small"
      title={t('classSchedule.slot', { index: n })}
      data-testid={`slot-card-${n}`}
      style={{ marginBottom: 12, borderColor: highlighted ? DANGER_BORDER : undefined }}
      extra={<Button size="small" danger icon={<DeleteOutlined />} aria-label={`${t('classSchedule.removeSlot')}: ${n}`} onClick={onRemove} disabled={disabled} />}
    >
      <Row gutter={[12, 8]}>
        <Field label={label('weekday')} problem={problem('weekday')}>
          <Select<number>
            aria-label={`${label('weekday')}: ${n}`}
            value={draft.weekday ?? undefined}
            placeholder={t('classSchedule.validation.weekday_required')}
            status={status('weekday')}
            disabled={disabled}
            style={{ width: '100%' }}
            onChange={(weekday) => onChange({ weekday })}
            options={order.map((weekday) => {
              const off = workingDays !== null && !workingDays.includes(weekday)
              const name = t(`classSchedule.weekdays.${weekday}`)
              return { value: weekday, label: off ? `${name} — ${t('classSchedule.nonWorkingDay')}` : name, disabled: off }
            })}
          />
        </Field>
        <Field label={label('startTime')} problem={problem('startTime')}>
          <Input type="time" aria-label={`${label('startTime')}: ${n}`} value={draft.startTime} status={status('startTime')} disabled={disabled} onChange={(event) => onChange({ startTime: event.target.value })} />
        </Field>
        <Field label={label('endTime')} problem={problem('endTime')}>
          <Input type="time" aria-label={`${label('endTime')}: ${n}`} value={draft.endTime} status={status('endTime')} disabled={disabled} onChange={(event) => onChange({ endTime: event.target.value })} />
        </Field>
        <Field label={label('room')}>
          <Select<string>
            aria-label={`${label('room')}: ${n}`}
            value={draft.roomId ?? undefined}
            placeholder={t('classSchedule.noRoomOption')}
            allowClear
            showSearch
            optionFilterProp="label"
            loading={roomsLoading}
            disabled={disabled}
            style={{ width: '100%' }}
            options={roomOptions}
            notFoundContent={<Typography.Text type="secondary">{t('classSchedule.noRooms')}</Typography.Text>}
            onChange={(roomId) => onChange({ roomId: roomId ?? null })}
          />
        </Field>
        <Field label={label('teacher')} hint={t('classSchedule.hints.teacher')}>
          <Select<string>
            aria-label={`${label('teacher')}: ${n}`}
            value={draft.teacherUserId ?? undefined}
            placeholder={t('classSchedule.defaultTeacherOption')}
            allowClear
            disabled={disabled}
            style={{ width: '100%' }}
            options={teacherOptions}
            notFoundContent={<Typography.Text type="secondary">{t('classSchedule.noTeachers')}</Typography.Text>}
            onChange={(teacherUserId) => onChange({ teacherUserId: teacherUserId ?? null })}
          />
        </Field>
        <Field label={label('effectiveFrom')} problem={problem('effectiveFrom')}>
          <Input type="date" aria-label={`${label('effectiveFrom')}: ${n}`} value={draft.effectiveFrom} status={status('effectiveFrom')} disabled={disabled} onChange={(event) => onChange({ effectiveFrom: event.target.value })} />
        </Field>
        <Field label={label('effectiveTo')} problem={problem('effectiveTo')} hint={t('classSchedule.hints.effectiveTo')}>
          <Input
            type="date"
            aria-label={`${label('effectiveTo')}: ${n}`}
            value={draft.effectiveTo ?? ''}
            status={status('effectiveTo')}
            disabled={disabled}
            onChange={(event) => onChange({ effectiveTo: event.target.value || null })}
          />
        </Field>
      </Row>
    </Card>
  )
}

function Field({ label, problem, hint, children }: { label: string; problem?: string; hint?: string; children: ReactNode }) {
  return (
    <Col xs={24} sm={12} md={8}>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
        {label}
      </Typography.Text>
      {children}
      {problem ? (
        <Typography.Text type="danger" style={{ display: 'block', marginTop: 4 }}>
          {problem}
        </Typography.Text>
      ) : hint ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          {hint}
        </Typography.Text>
      ) : null}
    </Col>
  )
}
