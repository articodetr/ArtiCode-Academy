// «Generate lessons» panel of the weekly schedule tab (J-F16 on API-092), for
// holders of `schedule.manage` while the class is planned, open or running and
// has weekly slots — the tab decides. Two native date inputs (the range lives
// in the tab, so it survives a detour through the schedule editor), the local
// mirror of the server's range check (schedule.generation.ts) that blocks the
// request, ONE POST per click (busy meanwhile), and the counts of the server's
// answer — nothing optimistic. A refusal is translated with the conflicting
// lesson, the room or the teacher it names; when the fix sits in a slot, the
// alert offers the schedule editor.
import { Alert, App, Button, Card, Col, Descriptions, Flex, Input, Row, Typography } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { generateClassLessons } from '../api/schedule'
import type { ClassSchedule, GeneratedLessons } from '../api/schedule'
import { useLocalized } from '../i18n/useLocalized'
import { addDays } from '../timetable/timetable.dates'
import { formatDay } from '../users/users.format'
import { roomLabel } from './schedule.format'
import { GENERATION_MAX_DAYS, describeGenerationFailure, generationFailureMessage, generationRangeProblems, hasRangeProblems, inclusiveDays } from './schedule.generation'
import type { GenerationFailure, GenerationRange } from './schedule.generation'
import { isCalendarDate } from './schedule.model'

interface GenerateLessonsPanelProps {
  cls: Pick<AcademyClass, 'id' | 'teachers'>
  schedule: ClassSchedule
  range: GenerationRange
  onRangeChange: (range: GenerationRange) => void
  /** The fix of a refusal sits in a slot: open the schedule editor (the tab keeps the range). */
  onEditSchedule: () => void
  onClose: () => void
}

export function GenerateLessonsPanel({ cls, schedule, range, onRangeChange, onEditSchedule, onClose }: GenerateLessonsPanelProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GeneratedLessons | null>(null)
  const [failure, setFailure] = useState<GenerationFailure | null>(null)
  // A second click before the re-render must not send a second request.
  const inFlight = useRef(false)

  const problems = generationRangeProblems(range)
  const blocked = hasRangeProblems(problems)
  const days = blocked ? null : inclusiveDays(range.from, range.to)

  /** Names for the refusal, from the slots on screen (the server names rooms and teachers by id). */
  const roomOf = (roomId: string): string | undefined => {
    const room = schedule.slots.find((slot) => slot.room?.id === roomId)?.room
    return room ? roomLabel(room, language) : undefined
  }
  const teacherOf = (userId: string): string | undefined =>
    schedule.slots.find((slot) => slot.teacher?.userId === userId)?.teacher?.fullName ?? cls.teachers.find((teacher) => teacher.userId === userId)?.fullName

  const change = (field: keyof GenerationRange, value: string) => {
    // The alert describes the last request; a new range is a new question.
    setFailure(null)
    onRangeChange({ ...range, [field]: value })
  }

  const submit = async () => {
    if (blocked || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setFailure(null)
    setResult(null)
    try {
      const answer = await generateClassLessons(cls.id, { from: range.from, to: range.to })
      setResult(answer)
      if (answer.created > 0) message.success(t('classSchedule.generate.createdToast', { count: answer.created }))
      else message.info(t('classSchedule.generate.nothingCreated'))
    } catch (caught) {
      setFailure(describeGenerationFailure(caught, cls.id, { roomOf, teacherOf }))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const fromValid = isCalendarDate(range.from)

  return (
    <Card
      size="small"
      title={t('classSchedule.generate.title')}
      data-testid="generate-lessons"
      style={{ marginBottom: 12 }}
      extra={
        <Button size="small" onClick={onClose} disabled={busy}>
          {t('classSchedule.generate.close')}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t('classSchedule.generate.intro')}
      </Typography.Paragraph>
      <Row gutter={[12, 8]}>
        <DateField
          label={t('classSchedule.generate.from')}
          value={range.from}
          problem={problems.from ? t(`classSchedule.generate.validation.${problems.from}`) : undefined}
          disabled={busy}
          onChange={(value) => change('from', value)}
        />
        <DateField
          label={t('classSchedule.generate.to')}
          value={range.to}
          min={fromValid ? range.from : undefined}
          max={fromValid ? addDays(range.from, GENERATION_MAX_DAYS - 1) : undefined}
          problem={problems.to ? t(`classSchedule.generate.validation.${problems.to}`, { max: GENERATION_MAX_DAYS }) : undefined}
          hint={days !== null ? t('classSchedule.generate.days', { count: days, max: GENERATION_MAX_DAYS }) : undefined}
          disabled={busy}
          onChange={(value) => change('to', value)}
        />
      </Row>
      <Flex justify="flex-end" style={{ marginTop: 12 }}>
        <Button type="primary" onClick={() => void submit()} loading={busy} disabled={blocked}>
          {t('classSchedule.generate.submit')}
        </Button>
      </Flex>

      {failure ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          title={generationFailureMessage(t, failure)}
          description={
            <>
              {failure.conflictingLessonId ? (
                <div data-testid="conflicting-lesson">
                  {t('classSchedule.generate.conflictingLesson')}{' '}
                  <Typography.Text code copyable={{ text: failure.conflictingLessonId }}>
                    <bdi dir="ltr">{failure.conflictingLessonId}</bdi>
                  </Typography.Text>
                </div>
              ) : null}
              <div>{t(failure.refused ? 'classSchedule.generate.refused' : 'classSchedule.generate.retrySafe')}</div>
            </>
          }
          action={
            failure.fixInSchedule ? (
              <Button size="small" onClick={onEditSchedule}>
                {t('classSchedule.generate.editSchedule')}
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {result ? <GenerationResult result={result} /> : null}
    </Card>
  )
}

/** The counts exactly as the server answered them (`occurrences` = `created` + `existing` + `offDays`). */
function GenerationResult({ result }: { result: GeneratedLessons }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const label = (key: 'slots' | 'occurrences' | 'created' | 'existing' | 'offDays') => t(`classSchedule.generate.result.${key}`)
  const count = (value: number) => <span dir="ltr">{value}</span>
  return (
    <div data-testid="generation-result" style={{ marginTop: 12 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
        {t('classSchedule.generate.result.title', { from: formatDay(result.from, language), to: formatDay(result.to, language) })}
      </Typography.Text>
      <Descriptions
        size="small"
        bordered
        column={1}
        items={[
          { key: 'slots', label: label('slots'), children: count(result.slots) },
          { key: 'occurrences', label: label('occurrences'), children: count(result.occurrences) },
          { key: 'created', label: label('created'), children: count(result.created) },
          { key: 'existing', label: label('existing'), children: count(result.existing) },
          { key: 'offDays', label: label('offDays'), children: count(result.offDays) },
        ]}
      />
      {result.created === 0 ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          {t(result.occurrences === 0 ? 'classSchedule.generate.noOccurrences' : 'classSchedule.generate.allSkipped')}
        </Typography.Text>
      ) : null}
    </div>
  )
}

interface DateFieldProps {
  label: string
  value: string
  min?: string
  max?: string
  problem?: string
  hint?: string
  disabled: boolean
  onChange: (value: string) => void
}

function DateField({ label, value, min, max, problem, hint, disabled, onChange }: DateFieldProps) {
  return (
    <Col xs={24} sm={12}>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
        {label}
      </Typography.Text>
      <Input type="date" aria-label={label} value={value} min={min} max={max} status={problem ? 'error' : undefined} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
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
