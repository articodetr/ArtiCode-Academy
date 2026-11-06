import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateIf, ValidateNested, registerDecorator } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { rawNumber } from '../courses/courses.validation.js';
import { IsCalendarDate, isCalendarDate } from '../users/users.validation.js';
import { RoomBranchDto } from './rooms.dto.js';
import { IsClockTime, clockMinutes, isClockTime } from './schedule.time.js';

/** Upper bound of a class's weekly slots (also bounds the request body). */
export const SCHEDULE_SLOTS_MAX = 50;

/** `endTime` must be later than `startTime` (half-open slots: equal times are empty). */
function IsAfterStartTime(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isAfterStartTime',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: 'endTime must be later than startTime', ...options },
      validator: {
        validate: (value: unknown, args: ValidationArguments) => {
          const start = (args.object as { startTime?: unknown }).startTime;
          return isClockTime(value) && isClockTime(start) && clockMinutes(value) > clockMinutes(start);
        },
      },
    });
  };
}

/** `effectiveTo` must not precede `effectiveFrom` (a one-day range is allowed — CHECK `ck_class_schedules_effective`). */
function IsNotBeforeEffectiveFrom(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isNotBeforeEffectiveFrom',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: 'effectiveTo must not be before effectiveFrom', ...options },
      validator: {
        validate: (value: unknown, args: ValidationArguments) => {
          const from = (args.object as { effectiveFrom?: unknown }).effectiveFrom;
          return isCalendarDate(value) && isCalendarDate(from) && value >= from;
        },
      },
    });
  };
}

export class ScheduleSlotInputDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Id of an existing slot of this class; absent for a new slot' })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiProperty({ minimum: 0, maximum: 6, example: 0, description: '0 = Sunday … 6 = Saturday (as `settings.scheduling.*`); a JSON integer' })
  @Transform(rawNumber)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @ApiProperty({ example: '10:00', description: '`HH:MM` local wall-clock time (the time zone of the room’s branch, else the academy’s)' })
  @IsString()
  @IsClockTime()
  startTime: string;

  @ApiProperty({ example: '11:30', description: '`HH:MM`, later than `startTime`; slots are half-open, so 10:00–11:00 and 11:00–12:00 do not overlap' })
  @IsString()
  @IsClockTime()
  @IsAfterStartTime()
  endTime: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'An existing, active room; absent or null = no room' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  roomId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'One of the class’s teachers (D-R26); absent or null = the lead teacher at generation time' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  teacherUserId?: string | null;

  @ApiProperty({ example: '2026-11-10', description: '`YYYY-MM-DD`, inclusive' })
  @IsCalendarDate()
  effectiveFrom: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-12-20', description: '`YYYY-MM-DD`, inclusive, not before `effectiveFrom`; absent or null = open-ended' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsCalendarDate()
  @IsNotBeforeEffectiveFrom()
  effectiveTo?: string | null;
}

/** The complete weekly schedule of the class (order does not matter; the response sorts by weekday, start time, id). */
export class ReplaceClassScheduleDto {
  @ApiProperty({ type: [ScheduleSlotInputDto], maxItems: SCHEDULE_SLOTS_MAX })
  @IsArray()
  @ArrayMaxSize(SCHEDULE_SLOTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ScheduleSlotInputDto)
  slots: ScheduleSlotInputDto[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** The slot's room by id, code and name, with its branch (API-084 shape without capacity/kind). */
export class ScheduleRoomDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LAB-1' })
  code: string;

  @ApiProperty({ type: Object, nullable: true, description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText | null;

  @ApiProperty({ type: RoomBranchDto, nullable: true, description: 'null = the academy’s own site' })
  branch: RoomBranchDto | null;
}

/** The slot's teacher by id and name only (no contact fields). */
export class ScheduleTeacherDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  fullName: string;
}

export class ScheduleSlotDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ minimum: 0, maximum: 6 })
  weekday: number;

  @ApiProperty({ example: '10:00', description: '`HH:MM`' })
  startTime: string;

  @ApiProperty({ example: '11:30', description: '`HH:MM`' })
  endTime: string;

  @ApiProperty({ type: ScheduleRoomDto, nullable: true })
  room: ScheduleRoomDto | null;

  @ApiProperty({ type: ScheduleTeacherDto, nullable: true, description: 'null = the lead teacher at generation time (D-R26)' })
  teacher: ScheduleTeacherDto | null;

  @ApiProperty({ example: '2026-11-10', description: '`YYYY-MM-DD`' })
  effectiveFrom: string;

  @ApiProperty({ type: String, nullable: true, example: '2026-12-20', description: '`YYYY-MM-DD`; null = open-ended' })
  effectiveTo: string | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class ClassScheduleDto {
  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ type: [ScheduleSlotDto], description: 'By weekday, then start time, then id' })
  slots: ScheduleSlotDto[];
}
