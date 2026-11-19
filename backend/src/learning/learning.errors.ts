// Error vocabulary of MOD-20 — «My School»: the course curriculum (levels and
// lesson content), the learning workspace and the learners' progress (roadmap
// §4q, decisions D-R130..D-R139). Same shape as CatalogHttpException: the
// body is `{ statusCode, error, code, message, ...details }` and the frontend
// maps the stable `code` to a localized message. A detail is never named
// `code` — it would overwrite the error code. The MOD-04 codes a curriculum
// write can also answer (course_not_found, syllabus_invalid) stay in
// courses.errors.ts.
//
//   curriculum_invalid          400  — the curriculum PUT names an unknown or repeated level or lesson id
//                                      ({ unknownSections, duplicateSections, unknownItems, duplicateItems })
//   content_invalid             400  — the content or the resources do not fit the lesson kind (D-R131)
//                                      ({ problems: string[] })
//   lesson_has_progress         409  — a lesson some learner has progress on cannot be deleted; unpublish it
//                                      instead (D-R135) ({ itemIds })
//   lesson_not_found            404  — no curriculum lesson with this id in this course (authors) or none
//                                      the caller may open (learners: unpublished, another course, no access)
//                                      ({ itemId })
//   not_enrolled                403  — the caller has no active or completed enrollment of their own in a
//                                      class of this course (D-R132) ({ courseId, reason: not_enrolled | pending })
//   learning_course_not_found   404  — no course with this id ({ courseId })
//   completion_by_playback      409  — this lesson completes by playing its media, not by the button (D-R134)
//                                      ({ itemId, thresholdPercent })
//   completion_by_attendance    409  — a live lesson completes by attending a session that covers it (D-R134)
//                                      ({ itemId })
//   playback_not_tracked        409  — this lesson has no measurable media (D-R134) ({ itemId })
//   catalog_not_public          404  — the academy does not offer its catalog to visitors (D-R138)
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const LEARNING_ERROR_CODES = [
  'curriculum_invalid',
  'content_invalid',
  'lesson_has_progress',
  'lesson_not_found',
  'not_enrolled',
  'learning_course_not_found',
  'completion_by_playback',
  'completion_by_attendance',
  'playback_not_tracked',
  'catalog_not_public',
] as const;

export type LearningErrorCode = (typeof LEARNING_ERROR_CODES)[number];

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class LearningHttpException extends HttpException {
  readonly code: LearningErrorCode;

  constructor(status: HttpStatus, code: LearningErrorCode, message: string, details: Record<string, unknown> = {}) {
    super({ statusCode: status, error: STATUS_CODES[status] ?? 'Error', code, message, ...details }, status);
    this.code = code;
  }
}

export interface CurriculumIdProblems {
  unknownSections: string[];
  duplicateSections: string[];
  unknownItems: string[];
  duplicateItems: string[];
}

export const learningError = {
  curriculumInvalid: (problems: CurriculumIdProblems) =>
    new LearningHttpException(HttpStatus.BAD_REQUEST, 'curriculum_invalid', 'Unknown or repeated level or lesson ids in the curriculum', { ...problems }),
  contentInvalid: (problems: readonly string[]) =>
    new LearningHttpException(HttpStatus.BAD_REQUEST, 'content_invalid', 'The content does not fit the lesson kind', { problems: [...problems] }),
  lessonHasProgress: (itemIds: readonly string[]) =>
    new LearningHttpException(HttpStatus.CONFLICT, 'lesson_has_progress', 'Learners have progress on these lessons; unpublish them instead of deleting', {
      itemIds: [...itemIds],
    }),
  lessonNotFound: (itemId: string) => new LearningHttpException(HttpStatus.NOT_FOUND, 'lesson_not_found', 'No lesson with this id', { itemId }),
  notEnrolled: (courseId: string, reason: 'not_enrolled' | 'pending') =>
    new LearningHttpException(HttpStatus.FORBIDDEN, 'not_enrolled', 'No active or completed enrollment of your own in this course', { courseId, reason }),
  courseNotFound: (courseId: string) =>
    new LearningHttpException(HttpStatus.NOT_FOUND, 'learning_course_not_found', 'No course with this id', { courseId }),
  completionByPlayback: (itemId: string, thresholdPercent: number) =>
    new LearningHttpException(HttpStatus.CONFLICT, 'completion_by_playback', 'This lesson completes by playing its media', { itemId, thresholdPercent }),
  completionByAttendance: (itemId: string) =>
    new LearningHttpException(HttpStatus.CONFLICT, 'completion_by_attendance', 'A live lesson completes by attending a session that covers it', { itemId }),
  playbackNotTracked: (itemId: string) =>
    new LearningHttpException(HttpStatus.CONFLICT, 'playback_not_tracked', 'This lesson has no measurable media', { itemId }),
  catalogNotPublic: () => new LearningHttpException(HttpStatus.NOT_FOUND, 'catalog_not_public', 'This academy does not offer its catalog to visitors'),
};
