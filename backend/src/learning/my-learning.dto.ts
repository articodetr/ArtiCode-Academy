// DTOs of MOD-20 «My School» — the learner's side (roadmap §4q, API-229..234,
// D-R132..D-R135, D-R139). Every route is by ownership: the caller's own
// enrollments (and, read-only, their linked children's in API-229). Nothing
// here ever names another student, a roster, a teacher id or a contact field.
// Every property that can be `null` names its Swagger type (KI-051).
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, Max, Min, registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';
import { ASSIGNMENT_STATUSES } from '../assignments/assignments.dto.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { CLASS_STATUSES } from '../classes/classes.dto.js';
import { rawNumber } from '../courses/courses.validation.js';
import { MyClassStudentDto, MyClassTeacherDto } from '../enrollments/my-classes.dto.js';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import { EXAM_STATUSES, EXAM_TYPES } from '../exams/exams.dto.js';
import type { AssignmentStatus, AttendanceStatus, ClassStatus, DeliveryMode, ExamStatus, ExamType, LearningItemKind, LessonStatus } from '../generated/prisma/client.js';
import { ATTENDANCE_STATUSES } from '../lessons/attendance.dto.js';
import { DELIVERY_MODES, LESSON_STATUSES } from '../lessons/lessons.dto.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { LEARNING_ITEM_KINDS } from './learning.content.js';
import type { CompletionMode } from './learning.content.js';
import type { ResumeReason } from './learning.curriculum.js';
import type { LearningAction, LearningState } from './learning.progress.js';
import { REPORTED_RANGES_MAX } from './learning.progress.js';
import { isPlaybackRanges, PLAYBACK_SECONDS_MAX } from './my-learning.policy.js';

const RELATIONS: MyClassRelation[] = ['self', 'child'];
const LEARNING_STATES: LearningState[] = ['not_started', 'in_progress', 'completed'];
const COMPLETION_MODES: CompletionMode[] = ['manual', 'playback', 'attendance'];
const COMPLETION_SOURCES = ['manual', 'playback', 'attendance'] as const;
const ACTIONS: LearningAction[] = ['start', 'continue', 'review'];
const RESUME_REASONS: ResumeReason[] = ['last', 'replaced', 'first'];
const OWNED_ENROLLMENT_STATUSES = ['active', 'completed'] as const;

export type CompletionSource = (typeof COMPLETION_SOURCES)[number];
export type OwnedEnrollmentStatus = (typeof OWNED_ENROLLMENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Progress over a set of published lessons (a course or one level) — `progressOf()` of learning.progress.ts. */
export class MyLearningProgressCountsDto {
  @ApiProperty({ type: 'integer', description: 'Published lessons in scope' })
  total: number;

  @ApiProperty({ type: 'integer', description: 'Required published lessons in scope' })
  required: number;

  @ApiProperty({ type: 'integer', description: 'Lessons in scope completed, required or not' })
  completed: number;

  @ApiProperty({ type: 'integer', description: 'Required lessons completed' })
  completedRequired: number;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0, maximum: 100, description: 'completedRequired ÷ required, floored (99.6 % is 99); null without a required lesson' })
  percent: number | null;

  @ApiProperty({ description: 'Every required lesson completed (false without a required lesson)' })
  isComplete: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601 — the latest completion among the required lessons once complete; else null' })
  completedAt: string | null;
}

/** The caller's own state on one lesson. */
export class MyLearningItemProgressDto {
  @ApiProperty({ enum: LEARNING_STATES })
  state: LearningState;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601; for a live lesson completed by attendance, the start of the earliest attended session' })
  completedAt: string | null;

  @ApiProperty({ enum: COMPLETION_SOURCES, nullable: true, description: '`manual` (the button), `playback` (enough of the medium played) or `attendance` (computed for a live lesson, never stored); null until completed' })
  completionSource: CompletionSource | null;

  @ApiProperty({ type: 'integer', nullable: true, description: 'Resume point of a played medium, in seconds; null before any playback save' })
  positionSeconds: number | null;

  @ApiProperty({ type: 'integer', description: 'Seconds of the medium actually played (the union of the played intervals, never the furthest point)' })
  watchedSeconds: number;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0, maximum: 100, description: 'floor(watchedSeconds ÷ the authored length × 100) for a playback lesson; null for any other' })
  watchedPercent: number | null;
}

/** The caller's own attendance at a MOD-06 session (never the note, the recorder or anyone else's). */
export class LearningSessionAttendanceDto {
  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  status: AttendanceStatus;

  @ApiProperty({ type: 'integer', nullable: true, description: 'With status `late` only' })
  minutesLate: number | null;
}

// ---------------------------------------------------------------------------
// API-229 — «مدرستي»
// ---------------------------------------------------------------------------

export class MyLearningEnrollmentDto {
  @ApiProperty({ enum: OWNED_ENROLLMENT_STATUSES })
  status: OwnedEnrollmentStatus;

  @ApiProperty({ type: String, format: 'date-time', description: 'ISO 8601' })
  enrolledAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601' })
  activatedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601' })
  completedAt: string | null;
}

export class MyLearningClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101-A' })
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty({ enum: CLASS_STATUSES })
  status: ClassStatus;

  @ApiProperty({ type: String, nullable: true, example: '2026-11-10', description: 'YYYY-MM-DD' })
  startsOn: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2027-01-31', description: 'YYYY-MM-DD' })
  endsOn: string | null;
}

/** The course's catalog level (MOD-04 `levels`) — not a curriculum level. */
export class MyLearningCatalogLevelDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;
}

/** PORTAL-04: the school subject the course teaches (`subjects`) — its id and localized name only. */
export class MyLearningSubjectDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;
}

export class MyLearningCourseSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101' })
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true, description: 'Localized summary or null' })
  summary: LocalizedText | null;

  @ApiProperty({ type: String, nullable: true, description: 'Absolute URL of the cover image (MOD-19), or null' })
  coverImageUrl: string | null;

  @ApiProperty({ type: () => MyLearningCatalogLevelDto, nullable: true })
  level: MyLearningCatalogLevelDto | null;

  @ApiProperty({ type: () => MyLearningSubjectDto, nullable: true, description: 'PORTAL-04: the school subject the course teaches; null = not set' })
  subject: MyLearningSubjectDto | null;
}

/** The lesson the student opened last in the course, while it is still published. */
export class MyLearningLastLessonDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ type: 'integer', description: '1-based number of its level in the learner’s view («المستوى الأول» = 1)' })
  sectionNumber: number;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true, description: 'The level’s own title; null for an untitled level and for the lessons outside every level' })
  sectionTitle: LocalizedText | null;

  @ApiProperty({ type: String, format: 'date-time', description: 'ISO 8601 — when it was last opened' })
  openedAt: string;
}

/** D-R143 — the class's next session (MOD-06 lesson): the earliest one not cancelled that has not ended yet. */
export class MyLearningNextSessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ type: String, format: 'date-time', description: 'ISO 8601' })
  startsAt: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'ISO 8601 — after now' })
  endsAt: string;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'The room’s branch zone, else the academy’s (D-R41)' })
  timeZone: string;

  @ApiProperty({ enum: DELIVERY_MODES })
  deliveryMode: DeliveryMode;

  @ApiProperty({ type: String, nullable: true, description: 'The meeting link; null when none' })
  meetingUrl: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The curriculum lesson the session covers, while it is published; null otherwise' })
  syllabusItemId: string | null;
}

/** One owned enrollment on the «My School» page (a guardian sees each child's enrollment, read-only). */
export class MyLearningCourseDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ enum: RELATIONS, description: '`self` = the caller’s own enrollment; `child` = a student linked to the caller as guardian' })
  relation: MyClassRelation;

  @ApiProperty({ type: () => MyClassStudentDto, description: 'The enrolled student (identity only)' })
  student: MyClassStudentDto;

  @ApiProperty({ type: () => MyLearningEnrollmentDto })
  enrollment: MyLearningEnrollmentDto;

  @ApiProperty({ type: () => MyLearningClassDto })
  class: MyLearningClassDto;

  @ApiProperty({ type: () => MyLearningCourseSummaryDto })
  course: MyLearningCourseSummaryDto;

  @ApiProperty({ type: () => MyClassTeacherDto, nullable: true, description: 'The class’s lead teacher by name only; null = none' })
  leadTeacher: MyClassTeacherDto | null;

  @ApiProperty({ type: () => MyLearningProgressCountsDto, description: 'The student’s progress on the course’s published lessons (it follows the student across classes of the course)' })
  progress: MyLearningProgressCountsDto;

  @ApiProperty({ type: () => MyLearningLastLessonDto, nullable: true })
  lastLesson: MyLearningLastLessonDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601 — the latest opening or completion of a lesson of the course; null before any' })
  lastActivityAt: string | null;

  @ApiProperty({ enum: ACTIONS, nullable: true, description: 'The learner’s next step: `start` (nothing yet), `continue`, `review` (every required lesson completed); null for a `child` item' })
  action: LearningAction | null;

  @ApiProperty({ description: 'True for the caller’s own enrollment — a guardian follows the progress but never opens the content' })
  canLearn: boolean;

  @ApiProperty({ type: () => MyLearningNextSessionDto, nullable: true, description: 'The class’s next session (D-R143) — the earliest non-cancelled MOD-06 lesson of this class that ends after now; null when none' })
  nextSession: MyLearningNextSessionDto | null;
}

export class MyLearningListDto {
  @ApiProperty({ type: [MyLearningCourseDto], description: '`self` before `child`, then the latest activity first (none last), then the newest enrollment; at most 200' })
  items: MyLearningCourseDto[];
}

// ---------------------------------------------------------------------------
// API-230 — the workspace of one course
// ---------------------------------------------------------------------------

export class LearningWorkspaceCourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101' })
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;

  @ApiProperty({ type: String, nullable: true })
  coverImageUrl: string | null;
}

export class LearningWorkspaceClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101-A' })
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;
}

export class LearningWorkspaceEnrollmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: OWNED_ENROLLMENT_STATUSES })
  status: OwnedEnrollmentStatus;

  @ApiProperty({ type: () => LearningWorkspaceClassDto })
  class: LearningWorkspaceClassDto;
}

export class WorkspaceItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ enum: LEARNING_ITEM_KINDS })
  kind: LearningItemKind;

  @ApiProperty({ description: 'A required lesson counts in the progress; an optional one never blocks it' })
  isRequired: boolean;

  @ApiProperty({ type: 'integer', nullable: true })
  estimatedMinutes: number | null;

  @ApiProperty({ type: 'integer', nullable: true, description: 'The medium’s own length when known, else the estimate in seconds; null without either' })
  durationSeconds: number | null;

  @ApiProperty({ enum: COMPLETION_MODES })
  completionMode: CompletionMode;

  @ApiProperty({ enum: LEARNING_STATES })
  state: LearningState;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt: string | null;

  @ApiProperty({ description: 'True when its level is open for the caller (D-R145); a lesson of a closed level is listed but cannot be opened (`403 level_not_open`)' })
  available: boolean;
}

export class WorkspaceSectionDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The level; null for the lessons outside every level' })
  id: string | null;

  @ApiProperty({ type: 'integer', description: '1-based number in the learner’s view (levels without a published lesson are not shown)' })
  number: number;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  title: LocalizedText | null;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ type: () => [WorkspaceItemDto], description: 'Published lessons in learning order' })
  items: WorkspaceItemDto[];

  @ApiProperty({ type: () => MyLearningProgressCountsDto, description: 'Counts every published lesson of the level, a closed level’s too (D-R145)' })
  progress: MyLearningProgressCountsDto;

  @ApiProperty({ description: 'True when the level is open for the caller today (D-R145): no release date, the class has no start date, or the date has come; the lessons outside every level are always open' })
  isOpen: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-12-01',
    description: 'YYYY-MM-DD in the academy’s time zone — the day the level opens: the caller’s class `startsOn` + `releaseAfterDays` (also once passed); null for a level that is always open',
  })
  opensOn: string | null;
}

/** D-R143 — a MOD-06 session of the class that opens the course, linked to a curriculum lesson or not. */
export class WorkspaceSessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ type: String, format: 'date-time' })
  startsAt: string;

  @ApiProperty({ type: String, format: 'date-time' })
  endsAt: string;

  @ApiProperty({ enum: LESSON_STATUSES })
  status: LessonStatus;

  @ApiProperty({ enum: DELIVERY_MODES })
  deliveryMode: DeliveryMode;

  @ApiProperty({ type: String, nullable: true, description: 'The meeting link; null when none and always null for a cancelled session' })
  meetingUrl: string | null;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'The room’s branch zone, else the academy’s (D-R41)' })
  timeZone: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The curriculum lesson the session covers, while it is published; null otherwise' })
  syllabusItemId: string | null;

  @ApiProperty({ type: () => LearningSessionAttendanceDto, nullable: true, description: 'The caller’s own attendance (never the note); null until recorded' })
  attendance: LearningSessionAttendanceDto | null;
}

export class LearningResumeDto {
  @ApiProperty({ format: 'uuid' })
  itemId: string;

  @ApiProperty({
    enum: RESUME_REASONS,
    description:
      '`last` = the lesson opened last; `replaced` = that lesson is no longer published or its level is not open, the next one not completed is offered; `first` = nothing opened yet. Always a lesson whose level is open (D-R145)',
  })
  reason: ResumeReason;

  @ApiProperty({ type: 'integer', nullable: true, description: 'Where the medium of a playback lesson was left, in seconds; null otherwise' })
  positionSeconds: number | null;
}

export class LearningWorkspaceDto {
  @ApiProperty({ type: () => LearningWorkspaceCourseDto })
  course: LearningWorkspaceCourseDto;

  @ApiProperty({ type: () => LearningWorkspaceEnrollmentDto, description: 'The caller’s enrollment that opens the course (an active one first, then the newest)' })
  enrollment: LearningWorkspaceEnrollmentDto;

  @ApiProperty({ type: 'integer', minimum: 50, maximum: 100, description: 'Share of a playback lesson’s medium that completes it (academy setting `learning.videoCompletionPercent`, default 90)' })
  completionPercent: number;

  @ApiProperty({ type: () => [WorkspaceSectionDto] })
  sections: WorkspaceSectionDto[];

  @ApiProperty({ type: () => MyLearningProgressCountsDto })
  progress: MyLearningProgressCountsDto;

  @ApiProperty({ type: () => LearningResumeDto, nullable: true, description: 'Where «continue learning» opens; null when the course shows no lesson whose level is open' })
  resume: LearningResumeDto | null;

  @ApiProperty({
    type: () => [WorkspaceSessionDto],
    description: 'Every MOD-06 session of the enrollment’s class (D-R143), by start time, cancelled ones too; at most 300',
  })
  sessions: WorkspaceSessionDto[];
}

// ---------------------------------------------------------------------------
// API-231 — one lesson
// ---------------------------------------------------------------------------

export class MyLearningResourceDto {
  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ example: 'https://cdn.example.org/handout.pdf' })
  url: string;
}

export class LearningItemSectionDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'null for the lessons outside every level' })
  id: string | null;

  @ApiProperty({ type: 'integer' })
  number: number;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  title: LocalizedText | null;
}

export class LearningNeighborDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ description: 'True when its level is open for the caller (D-R145)' })
  available: boolean;
}

export class LearningNeighborsDto {
  @ApiProperty({ type: () => LearningNeighborDto, nullable: true })
  previous: LearningNeighborDto | null;

  @ApiProperty({ type: () => LearningNeighborDto, nullable: true })
  next: LearningNeighborDto | null;
}

/** A MOD-06 session of one of the caller's classes that covers the lesson. */
export class LearningSessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ type: String, format: 'date-time' })
  startsAt: string;

  @ApiProperty({ type: String, format: 'date-time' })
  endsAt: string;

  @ApiProperty({ enum: LESSON_STATUSES })
  status: LessonStatus;

  @ApiProperty({ enum: DELIVERY_MODES })
  deliveryMode: DeliveryMode;

  @ApiProperty({ type: String, nullable: true, description: 'The meeting link; null when none and always null for a cancelled session' })
  meetingUrl: string | null;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'The room’s branch zone, else the academy’s (D-R41)' })
  timeZone: string;

  @ApiProperty({ type: () => LearningSessionAttendanceDto, nullable: true, description: 'The caller’s own attendance (never the note); null until recorded' })
  attendance: LearningSessionAttendanceDto | null;
}

export class LearningAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dueAt: string | null;

  @ApiProperty({ enum: ASSIGNMENT_STATUSES })
  status: AssignmentStatus;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'The linked session’s room branch zone, else the academy’s (D-R41)' })
  timeZone: string;
}

export class LearningExamDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ enum: EXAM_TYPES })
  type: ExamType;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  scheduledAt: string | null;

  @ApiProperty({ enum: EXAM_STATUSES })
  status: ExamStatus;
}

export class LearningItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ enum: LEARNING_ITEM_KINDS })
  kind: LearningItemKind;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'The lesson’s content, shaped by `kind` (D-R131 — plain text, https URLs, YouTube/Vimeo ids); null when the lesson has none yet',
  })
  content: Record<string, unknown> | null;

  @ApiProperty({ type: () => [MyLearningResourceDto] })
  resources: MyLearningResourceDto[];

  @ApiProperty()
  isRequired: boolean;

  @ApiProperty({ type: 'integer', nullable: true })
  estimatedMinutes: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  durationSeconds: number | null;

  @ApiProperty({ type: () => LearningItemSectionDto })
  section: LearningItemSectionDto;

  @ApiProperty({ enum: COMPLETION_MODES })
  completionMode: CompletionMode;

  @ApiProperty({ type: 'integer', minimum: 50, maximum: 100, description: 'The academy threshold for playback lessons' })
  completionPercent: number;

  @ApiProperty({ type: () => MyLearningItemProgressDto })
  progress: MyLearningItemProgressDto;

  @ApiProperty({ type: () => LearningNeighborsDto, description: 'The lessons before and after in learning order, across level boundaries' })
  neighbors: LearningNeighborsDto;

  @ApiProperty({ type: () => [LearningSessionDto], description: 'Sessions covering the lesson in the caller’s own classes of the course, by start time (cancelled ones too)' })
  sessions: LearningSessionDto[];

  @ApiProperty({ type: () => [LearningAssignmentDto], description: 'Non-draft assignments linked to one of `sessions`' })
  assignments: LearningAssignmentDto[];

  @ApiProperty({ type: () => [LearningExamDto], description: 'Scheduled or published exams linked to one of `sessions`' })
  exams: LearningExamDto[];
}

// ---------------------------------------------------------------------------
// API-232..234 — the learner's writes (no audit event — D-R139)
// ---------------------------------------------------------------------------

function IsPlaybackRanges(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isPlaybackRanges',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: `$property must be an array of at most ${REPORTED_RANGES_MAX} [start, end] pairs of numbers between 0 and ${PLAYBACK_SECONDS_MAX}`, ...options },
      validator: {
        validate(value: unknown): boolean {
          return isPlaybackRanges(value);
        },
      },
    });
  };
}

/** The raw JSON value (no implicit conversion of the nested pairs). */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

export class SavePlaybackDto {
  @ApiProperty({ type: Number, minimum: 0, maximum: PLAYBACK_SECONDS_MAX, example: 132.5, description: 'Where the medium is now, in seconds (raw JSON number)' })
  @Transform(rawNumber)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(PLAYBACK_SECONDS_MAX)
  positionSeconds: number;

  @ApiProperty({
    type: 'array',
    maxItems: REPORTED_RANGES_MAX,
    items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: 0, maximum: PLAYBACK_SECONDS_MAX } },
    example: [
      [120, 132.5],
    ],
    description: 'The intervals actually played since the previous save, `[start, end]` in seconds (raw JSON numbers); `[]` when nothing played',
  })
  @Transform(rawValue)
  @IsPlaybackRanges()
  ranges: [number, number][];
}

export class LearningVisitResultDto {
  @ApiProperty({ type: () => MyLearningItemProgressDto })
  progress: MyLearningItemProgressDto;
}

export class LearningPlaybackResultDto {
  @ApiProperty({ type: () => MyLearningItemProgressDto })
  progress: MyLearningItemProgressDto;

  @ApiProperty({ type: () => MyLearningProgressCountsDto })
  course: MyLearningProgressCountsDto;

  @ApiProperty({ description: 'True when this save completed the lesson' })
  completedNow: boolean;

  @ApiProperty({ description: 'True when the server clock trimmed what the save claimed (more new seconds than could have played since the previous save)' })
  capped: boolean;
}

export class LearningCompleteResultDto {
  @ApiProperty({ type: () => MyLearningItemProgressDto })
  progress: MyLearningItemProgressDto;

  @ApiProperty({ type: () => MyLearningProgressCountsDto, description: 'The progress of the lesson’s level (the group it is shown in)' })
  section: MyLearningProgressCountsDto;

  @ApiProperty({ type: () => MyLearningProgressCountsDto })
  course: MyLearningProgressCountsDto;

  @ApiProperty({ description: 'True when this request completed the lesson; false when it already was (nothing written)' })
  completedNow: boolean;
}
