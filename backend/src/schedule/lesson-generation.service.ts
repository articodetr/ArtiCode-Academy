import { Injectable } from '@nestjs/common';
import { readSettings } from '../academy/academy.settings.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { isClassOpenForLessons } from '../lessons/lessons.policy.js';
import { LessonsService } from '../lessons/lessons.service.js';
import type { LessonRequest } from '../lessons/lessons.service.js';
import { toIso } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { GenerateLessonsDto, GeneratedLessonsDto } from './lesson-generation.dto.js';
import { localDateOf, occurrenceKey, planGeneration } from './lesson-generation.plan.js';
import type { GenerationSlot } from './lesson-generation.plan.js';
import { scheduleError } from './schedule.errors.js';
import { columnToCalendarDate, columnToClockTime } from './schedule.time.js';
import { displayTimeZone } from './timetable.policy.js';

const DAY_MS = 86_400_000;

/** The slot columns generation reads, with the room's branch zone. */
const GENERATION_SLOT_SELECT = {
  id: true,
  weekday: true,
  startTime: true,
  endTime: true,
  roomId: true,
  teacherUserId: true,
  effectiveFrom: true,
  effectiveTo: true,
  room: { select: { branch: { select: { timezone: true } } } },
} satisfies Prisma.ClassScheduleSelect;

type Counts = Pick<GeneratedLessonsDto, 'slots' | 'occurrences' | 'existing' | 'offDays'>;

/**
 * MOD-07-T05 (O9) — lessons generated from the weekly schedule (API-092,
 * D-R29). The planning runs inside the MOD-06 creating transaction, under the
 * class-row lock, so the slots, the academy settings and the lessons already
 * generated are read in the same snapshot that writes the new ones: two
 * generations of the same range never duplicate a (slot, local date).
 */
@Injectable()
export class LessonGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lessons: LessonsService,
  ) {}

  async generate(classId: string, input: GenerateLessonsDto, caller: AuthPrincipal, ctx: RequestContext): Promise<GeneratedLessonsDto> {
    // The class must exist and take lessons — named with the schedule dictionary before the MOD-06 writer re-checks it under the lock.
    const klass = await this.prisma.db.class.findUnique({ where: { id: classId }, select: { status: true } });
    if (!klass) throw scheduleError.classNotFound(classId);
    if (!isClassOpenForLessons(klass.status)) throw scheduleError.classNotSchedulable(klass.status);

    let counts: Counts = { slots: 0, occurrences: 0, existing: 0, offDays: 0 };
    const created = await this.lessons.createLessons(
      classId,
      async (tx, locked) => {
        const academy = await tx.academy.findFirst({ select: { timezone: true, settings: true } });
        const academyTimeZone = academy?.timezone ?? 'UTC';
        const workingDays = academy ? readSettings(academy.settings).scheduling.workingDays : null;
        const target = await tx.class.findUniqueOrThrow({ where: { id: classId }, select: { name: true } });
        const rows = await tx.classSchedule.findMany({ where: { classId }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }, { id: 'asc' }], select: GENERATION_SLOT_SELECT });
        const slots: GenerationSlot[] = rows.map((row) => ({
          id: row.id,
          weekday: row.weekday,
          startTime: columnToClockTime(row.startTime),
          endTime: columnToClockTime(row.endTime),
          roomId: row.roomId,
          teacherUserId: row.teacherUserId,
          effectiveFrom: columnToCalendarDate(row.effectiveFrom),
          effectiveTo: row.effectiveTo === null ? null : columnToCalendarDate(row.effectiveTo),
          timeZone: displayTimeZone(row.room?.branch?.timezone, academyTimeZone),
        }));

        // Lessons already generated from these slots around the range, keyed by (slot, local date in the slot's zone) — any status counts.
        const existing = new Set<string>();
        if (slots.length > 0) {
          const zoneOf = new Map(slots.map((slot) => [slot.id, slot.timeZone]));
          const taken = await tx.lesson.findMany({
            where: {
              scheduleId: { in: slots.map((slot) => slot.id) },
              startsAt: { gte: new Date(Date.parse(`${input.from}T00:00:00.000Z`) - 2 * DAY_MS), lt: new Date(Date.parse(`${input.to}T00:00:00.000Z`) + 3 * DAY_MS) },
            },
            select: { scheduleId: true, startsAt: true },
          });
          for (const row of taken) {
            if (row.scheduleId === null) continue;
            existing.add(occurrenceKey(row.scheduleId, localDateOf(row.startsAt, zoneOf.get(row.scheduleId) ?? academyTimeZone)));
          }
        }

        const plan = planGeneration(slots, input.from, input.to, workingDays, existing);
        counts = { slots: slots.length, occurrences: plan.occurrences, existing: plan.existing, offDays: plan.offDays };
        const title = readLocalizedText(target.name) ?? { ar: locked.code };
        return plan.lessons.map(
          (lesson): LessonRequest => ({
            title,
            startsAt: toIso(lesson.startsAt),
            endsAt: toIso(lesson.endsAt),
            roomId: lesson.roomId,
            // A slot without a teacher leaves the field undefined: the class's lead teacher at generation (D-R33 (3)).
            ...(lesson.teacherUserId === null ? {} : { teacherUserId: lesson.teacherUserId }),
            scheduleId: lesson.slotId,
          }),
        );
      },
      caller,
      ctx,
      { authority: 'schedule' },
    );

    return { classId, from: input.from, to: input.to, ...counts, created: created.length, lessons: created };
  }
}
