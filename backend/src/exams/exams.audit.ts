// Audit names shared by the exam services. Kept apart from exams.service.ts so
// the services of the online side (exam-questions, attempts, grading) can name
// the entity type without importing the service that injects them.

/** Audit `entity_type` of every exam event. */
export const EXAMS_ENTITY_TYPE = 'exams';

/** Audit `entity_type` of the events of one attempt at an online exam. */
export const EXAM_ATTEMPTS_ENTITY_TYPE = 'exam_attempts';
