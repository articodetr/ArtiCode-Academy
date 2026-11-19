// MOD-20 (roadmap §4q, D-R137) — the learning progress of a class for its
// teachers and the office (API-235). Every number is computed on read by the
// same rules as the learner's own pages (learning.read.ts +
// learning.progress.ts), so a teacher sees exactly what the learner sees.
import { ApiProperty } from '@nestjs/swagger';
import type { LocalizedText } from '../authorization/localized-text.js';
import { EnrollmentStudentDto } from '../enrollments/enrollments.dto.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';

export const CLASS_PROGRESS_ENROLLMENT_STATUSES = ['active', 'completed'] as const;
export type ClassProgressEnrollmentStatus = (typeof CLASS_PROGRESS_ENROLLMENT_STATUSES)[number];

/** Progress over the published lessons of the course — `progressOf()` of learning.progress.ts (the shape of «my learning»). */
export class ClassLearningCountsDto {
  @ApiProperty({ type: 'integer', description: 'Published lessons of the course' })
  total: number;

  @ApiProperty({ type: 'integer', description: 'Required published lessons' })
  required: number;

  @ApiProperty({ type: 'integer', description: 'Published lessons completed, required or not' })
  completed: number;

  @ApiProperty({ type: 'integer', description: 'Required lessons completed' })
  completedRequired: number;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0, maximum: 100, description: 'completedRequired ÷ required, floored; null without a required lesson' })
  percent: number | null;

  @ApiProperty({ description: 'Every required lesson completed (false without a required lesson)' })
  isComplete: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601 — the latest completion among the required lessons once complete; else null' })
  completedAt: string | null;
}

export class ClassLearningCourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;
}

export class ClassLearningTotalsDto {
  @ApiProperty({ type: 'integer', description: 'Published lessons of the course' })
  lessons: number;

  @ApiProperty({ type: 'integer', description: 'Of those, the required ones' })
  required: number;
}

export class ClassLearningLastLessonDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;
}

export class ClassLearningStudentDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ enum: CLASS_PROGRESS_ENROLLMENT_STATUSES })
  enrollmentStatus: ClassProgressEnrollmentStatus;

  @ApiProperty({ type: EnrollmentStudentDto, description: 'The caller’s projection (D-R07): contact fields are null without `users.read_contact`' })
  student: EnrollmentStudentDto;

  @ApiProperty({ type: ClassLearningCountsDto, description: 'The student’s progress on the course — it follows the student across the classes of the course (D-R133)' })
  progress: ClassLearningCountsDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601 — the latest lesson opening or completion in the course; null before any' })
  lastActivityAt: string | null;

  @ApiProperty({ type: ClassLearningLastLessonDto, nullable: true, description: 'The lesson the student opened last, while it is still published' })
  lastLesson: ClassLearningLastLessonDto | null;
}

export class ClassLearningProgressDto {
  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ type: ClassLearningCourseDto })
  course: ClassLearningCourseDto;

  @ApiProperty({ type: ClassLearningTotalsDto })
  totals: ClassLearningTotalsDto;

  @ApiProperty({ type: [ClassLearningStudentDto], description: 'The active and completed enrollments of the class, in enrollment order' })
  students: ClassLearningStudentDto[];
}
