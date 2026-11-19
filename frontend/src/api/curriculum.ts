// The curriculum of a course (MOD-20 «My School», roadmap §4q): API-226 GET and
// API-227 PUT /api/courses/:id/curriculum, API-228 PUT …/items/:itemId/content.
// Types mirror backend/src/learning/curriculum.dto.ts (the contract of agent A).
// A course is organised in levels (`course_sections` — «المستوى الأول» …, D-R130,
// never the catalog's `levels` table), each holding its lessons in order; the
// lessons outside every level form one trailing group (`looseItems`). Reading
// needs `courses.manage` or teaching a class of the course (`canManage: false`
// then); anyone else gets 404 course_not_found. The PUT replaces the whole
// structure (a level or lesson without `id` is new, a missing one is deleted —
// refused with 409 lesson_has_progress while learners have progress on it);
// the content of one saved lesson is written on its own (API-228).
import { COURSES_PATH } from './courses'
import { apiRequest } from './client'
import type { Caption, CompletionMode, LearningItemKind, LessonContent, LessonResource } from './learning'
import type { LocalizedLabel } from './users'

/** Mirrors of the server limits: at most 50 levels and 200 lessons, a lesson at most a day (1440 minutes), 20 resources. */
export const CURRICULUM_SECTIONS_MAX = 50
export const CURRICULUM_ITEMS_MAX = 200
export const LESSON_MINUTES_MAX = 1440
export const LESSON_RESOURCES_MAX = 20
/** A title or description in one language (LocalizedTextDto). */
export const CURRICULUM_TEXT_MAX = 200

/** Mirrors of backend/src/learning/learning.content.ts (the 400 content_invalid of API-228). */
export const CONTENT_TEXT_MAX = 8000
export const CONTENT_SHORT_TEXT_MAX = 300
export const CONTENT_URL_MAX = 2048
export const MEDIA_SECONDS_MAX = 86_400
export const CAPTIONS_MAX = 5
export const CAPTION_LABEL_MAX = 60
export const FILE_NAME_MAX = 200

export const VIDEO_PROVIDERS = ['file', 'youtube', 'vimeo'] as const
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number]

/** `CurriculumItemDto`: one lesson as its author sees it. */
export interface CurriculumItem {
  id: string
  /** Its position in the flattened order (levels in order, then the loose lessons). */
  sortOrder: number
  title: LocalizedLabel
  description: LocalizedLabel | null
  estimatedMinutes: number | null
  kind: LearningItemKind
  /** The stored content of its kind; null = none yet (or a stored value that no longer fits). */
  content: LessonContent | null
  resources: LessonResource[]
  isRequired: boolean
  isPublished: boolean
  completionMode: CompletionMode
  /** The media's own length when known, else the estimate in seconds; null without either. */
  durationSeconds: number | null
  /** Learners with progress on it: such a lesson cannot be deleted, only unpublished (D-R135). */
  progressCount: number
  updatedAt: string
}

/** One level («المستوى {number}»), empty ones too. */
export interface CurriculumSection {
  id: string
  /** 1-based. */
  number: number
  sortOrder: number
  title: LocalizedLabel | null
  description: LocalizedLabel | null
  items: CurriculumItem[]
}

/** `CurriculumDto` (API-226/227). */
export interface Curriculum {
  courseId: string
  courseCode: string
  /** False for a teacher of the course without `courses.manage`: read-only. */
  canManage: boolean
  sections: CurriculumSection[]
  /** The lessons outside every level, in order. */
  looseItems: CurriculumItem[]
}

/** One lesson of the PUT body: no `id` = a new lesson; absent description/minutes = none. Kind, content and resources are not here (API-228). */
export interface CurriculumItemInput {
  id?: string
  title: LocalizedLabel
  description?: LocalizedLabel | null
  estimatedMinutes?: number | null
  isRequired: boolean
  isPublished: boolean
}

/** One level of the PUT body: no `id` = a new level; absent title/description = none. */
export interface CurriculumSectionInput {
  id?: string
  title?: LocalizedLabel | null
  description?: LocalizedLabel | null
  items: CurriculumItemInput[]
}

/** API-227: the COMPLETE structure in its new order. */
export interface CurriculumInput {
  sections: CurriculumSectionInput[]
  looseItems?: CurriculumItemInput[]
}

/** What API-228 takes for a video: the stored shape without the server-derived `videoId`. */
export interface VideoContentInput {
  provider: VideoProvider
  url: string
  durationSeconds?: number | null
  captions?: Caption[]
}

/** The content of API-228 by kind (D-R131); the server re-checks it (400 content_invalid). */
export type LessonContentInputValue =
  | { body: LocalizedLabel }
  | VideoContentInput
  | { url: string; durationSeconds: number }
  | { url: string }
  | { url: string; alt: LocalizedLabel | null }
  | { url: string; fileName: string | null }
  | { note: LocalizedLabel | null }

/** API-228 body: all three present — `content` may be null, `resources` may be empty. */
export interface LessonContentInput {
  kind: LearningItemKind
  content: LessonContentInputValue | null
  resources: LessonResource[]
}

export const curriculumPath = (courseId: string) => `${COURSES_PATH}/${encodeURIComponent(courseId)}/curriculum`

export const lessonContentPath = (courseId: string, itemId: string) => `${curriculumPath(courseId)}/items/${encodeURIComponent(itemId)}/content`

/** API-226 */
export function getCurriculum(courseId: string, signal?: AbortSignal): Promise<Curriculum> {
  return apiRequest<Curriculum>(curriculumPath(courseId), { signal })
}

/** API-227 — answers the curriculum as the server holds it after the write. */
export function replaceCurriculum(courseId: string, input: CurriculumInput): Promise<Curriculum> {
  return apiRequest<Curriculum>(curriculumPath(courseId), { method: 'PUT', body: input })
}

/** API-228 — answers the lesson after the write. */
export function updateLessonContent(courseId: string, itemId: string, input: LessonContentInput): Promise<CurriculumItem> {
  return apiRequest<CurriculumItem>(lessonContentPath(courseId, itemId), { method: 'PUT', body: input })
}
