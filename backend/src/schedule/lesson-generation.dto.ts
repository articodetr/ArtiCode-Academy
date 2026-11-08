import { ApiProperty } from '@nestjs/swagger';
import { registerDecorator } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';
import { LessonDto } from '../lessons/lessons.dto.js';
import { IsCalendarDate, isCalendarDate } from '../users/users.validation.js';
import { GENERATION_MAX_DAYS, inclusiveDays } from './lesson-generation.plan.js';

/** `to` must not precede `from`, and the inclusive range may cover at most GENERATION_MAX_DAYS days (invalid dates are reported by IsCalendarDate). */
export function IsGenerationRange(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isGenerationRange',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `to must not be before from, and the range may cover at most ${GENERATION_MAX_DAYS} days`, ...options },
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const from = (args.object as { from?: unknown }).from;
          if (!isCalendarDate(from) || !isCalendarDate(value)) return true;
          const days = inclusiveDays(from, value);
          return days >= 1 && days <= GENERATION_MAX_DAYS;
        },
      },
    });
  };
}

/** Body of `POST /api/classes/:id/schedule/generate` (API-092). */
export class GenerateLessonsDto {
  @ApiProperty({ example: '2026-11-15', description: 'First date of the range (`YYYY-MM-DD`, inclusive) — a local calendar date read in each slot’s time zone' })
  @IsCalendarDate()
  from: string;

  @ApiProperty({ example: '2026-12-31', description: `Last date of the range (inclusive); not before \`from\`, and the range covers at most ${GENERATION_MAX_DAYS} days` })
  @IsCalendarDate()
  @IsGenerationRange()
  to: string;
}

/** Outcome of a generation request. */
export class GeneratedLessonsDto {
  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ example: '2026-11-15' })
  from: string;

  @ApiProperty({ example: '2026-12-31' })
  to: string;

  @ApiProperty({ description: 'Weekly slots of the class that were considered' })
  slots: number;

  @ApiProperty({ description: 'Slot occurrences inside the range before any skipping (= created + existing + offDays)' })
  occurrences: number;

  @ApiProperty({ description: 'Lessons created by this request' })
  created: number;

  @ApiProperty({ description: 'Occurrences skipped because the slot already has a lesson on that local date, whatever its status' })
  existing: number;

  @ApiProperty({ description: 'Occurrences skipped because the date is outside `settings.scheduling.workingDays`' })
  offDays: number;

  @ApiProperty({ type: [LessonDto], description: 'The created lessons in time order (empty when nothing was created)' })
  lessons: LessonDto[];
}
