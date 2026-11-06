import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { MyClassCourseDto, MyClassStudentDto, MyClassTeacherDto } from '../enrollments/my-classes.dto.js';
import { ClassStatus } from '../generated/prisma/client.js';
import { IsCalendarDate, trimParam } from '../users/users.validation.js';
import { ScheduleRoomDto, ScheduleSlotDto } from './class-schedule.dto.js';
import { NO_BRANCH_FILTER } from './timetable.policy.js';
import type { MyScheduleRelation } from './timetable.policy.js';

const CLASS_STATUSES = Object.values(ClassStatus) as ClassStatus[];
const RELATIONS: MyScheduleRelation[] = ['self', 'child', 'teacher'];
const BRANCH_FILTER_MESSAGE = `branchId must be a uuid or "${NO_BRANCH_FILTER}"`;

/** `weekday` as a query string: exactly `0`–`6` (no implicit conversion of `""` to 0 or of `"03"`). */
export function weekdayParam({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const raw = obj[key];
  return typeof raw === 'string' && /^[0-6]$/.test(raw) ? Number(raw) : raw;
}

export class MyScheduleQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-10',
    description: 'Calendar date `YYYY-MM-DD`: only the slots effective on it (`effectiveFrom ≤ on ≤ effectiveTo`); default = today in the academy’s time zone',
  })
  @IsOptional()
  @IsCalendarDate()
  on?: string;
}

/** Every filter narrows the list (ANDed); an unknown id matches nothing. */
export class AcademyScheduleQueryDto extends MyScheduleQueryDto {
  @ApiPropertyOptional({ description: `A branch id (slots held in that branch’s rooms), or \`${NO_BRANCH_FILTER}\` for the rooms of the academy’s own site; slots without a room never match` })
  @IsOptional()
  @Transform(trimParam)
  @IsString()
  @ValidateIf((dto: AcademyScheduleQueryDto) => dto.branchId !== NO_BRANCH_FILTER)
  @IsUUID('all', { message: BRANCH_FILTER_MESSAGE })
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Slots held in this room' })
  @IsOptional()
  @IsUUID('all')
  roomId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Slots assigned to this teacher (slots without a teacher — the lead teacher by default — never match)' })
  @IsOptional()
  @IsUUID('all')
  teacherUserId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Slots of this class' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 6, description: '0 = Sunday … 6 = Saturday' })
  @IsOptional()
  @Transform(weekdayParam)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** The class a slot belongs to, with its course — a summary, never the roster or the teachers' accounts. */
export class TimetableClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101-A' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty({ enum: CLASS_STATUSES })
  status: ClassStatus;

  @ApiProperty({ type: MyClassCourseDto })
  course: MyClassCourseDto;
}

/** A slot of the academy schedule: the API-088 slot plus its display time zone and its class. */
export class TimetableSlotDto extends ScheduleSlotDto {
  @ApiProperty({ example: 'Europe/Istanbul', description: 'IANA time zone the times are read in: the room’s branch when it has one, else the academy’s (§4e.8 (4))' })
  timeZone: string;

  @ApiProperty({ type: TimetableClassDto })
  class: TimetableClassDto;
}

export class AcademyScheduleDto {
  @ApiProperty({ example: '2026-11-10', description: 'The calendar date the slots are effective on (the `on` filter, or today in the academy’s time zone)' })
  on: string;

  @ApiProperty({ type: [TimetableSlotDto], description: 'By weekday, then start time, then id' })
  slots: TimetableSlotDto[];
}

/** One slot the caller owns through one relation (a slot owned twice — two children in one class — appears twice). */
export class MyScheduleItemDto {
  @ApiProperty({ format: 'uuid', description: 'The slot (repeated when the caller owns it through several relations)' })
  id: string;

  @ApiProperty({ minimum: 0, maximum: 6 })
  weekday: number;

  @ApiProperty({ example: '10:00', description: '`HH:MM`' })
  startTime: string;

  @ApiProperty({ example: '11:30', description: '`HH:MM`' })
  endTime: string;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'IANA time zone the times are read in: the room’s branch when it has one, else the academy’s' })
  timeZone: string;

  @ApiProperty({ type: ScheduleRoomDto, nullable: true })
  room: ScheduleRoomDto | null;

  @ApiProperty({ type: MyClassTeacherDto, nullable: true, description: 'The slot’s teacher by name only (no id, no contact fields); null = the class’s lead teacher by default' })
  teacher: MyClassTeacherDto | null;

  @ApiProperty({ example: '2026-11-10', description: '`YYYY-MM-DD`' })
  effectiveFrom: string;

  @ApiProperty({ type: String, nullable: true, example: '2026-12-20', description: '`YYYY-MM-DD`; null = open-ended' })
  effectiveTo: string | null;

  @ApiProperty({ type: TimetableClassDto })
  class: TimetableClassDto;

  @ApiProperty({ enum: RELATIONS, description: '`self` = the caller is enrolled; `child` = a student linked to the caller as guardian is enrolled; `teacher` = the caller teaches the class' })
  relation: MyScheduleRelation;

  @ApiProperty({ type: MyClassStudentDto, nullable: true, description: 'The enrolled student for `self` and `child` (identity only); null for `teacher`' })
  student: MyClassStudentDto | null;
}

export class MyScheduleDto {
  @ApiProperty({ example: '2026-11-10', description: 'The calendar date the items are effective on (the `on` filter, or today in the academy’s time zone)' })
  on: string;

  @ApiProperty({ type: [MyScheduleItemDto], description: 'By weekday, start time and slot, then `self` → `child` → `teacher`; empty for a user with no enrollment, linked child or class' })
  items: MyScheduleItemDto[];
}
