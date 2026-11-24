// «My School» — the learner's own learning (MOD-20, roadmap §4q): API-229..234.
// Types mirror backend/src/learning/my-learning.dto.ts. Ownership, no
// permission key: the server answers only the caller's own enrollments (and,
// for a guardian, their children's — read-only), opens a course's lessons only
// with an own active or completed enrollment (D-R132), and is the only
// authority on progress (D-R133): nothing here is computed or stored locally.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export const LEARNING_ITEM_KINDS = ['text', 'video', 'audio', 'pdf', 'image', 'file', 'live'] as const
export type LearningItemKind = (typeof LEARNING_ITEM_KINDS)[number]

/** How a lesson completes (D-R134). */
export type CompletionMode = 'manual' | 'playback' | 'attendance'
export type LearningState = 'not_started' | 'in_progress' | 'completed'
export type CompletionSource = 'manual' | 'playback' | 'attendance'
export type LearningAction = 'start' | 'continue' | 'review'

export interface ProgressCounts {
  total: number
  required: number
  completed: number
  completedRequired: number
  /** completedRequired ÷ required, floored; null without a required lesson. */
  percent: number | null
  isComplete: boolean
  completedAt: string | null
}

export interface ItemProgress {
  state: LearningState
  completedAt: string | null
  completionSource: CompletionSource | null
  positionSeconds: number | null
  watchedSeconds: number
  /** Played share of a playback lesson; null for any other lesson. */
  watchedPercent: number | null
}

// --- The lesson content by kind (D-R131) — the server's stored shapes. ------

export interface TextContent {
  body: LocalizedLabel
}
export interface Caption {
  language: 'ar' | 'en' | 'tr'
  url: string
  label?: string
}
export type VideoContent =
  | { provider: 'file'; url: string; durationSeconds: number; captions: Caption[] }
  | { provider: 'youtube'; videoId: string; url: string; durationSeconds: number | null }
  | { provider: 'vimeo'; videoId: string; url: string; durationSeconds: number | null }
export interface AudioContent {
  url: string
  durationSeconds: number
}
export interface PdfContent {
  url: string
}
export interface ImageContent {
  url: string
  alt: LocalizedLabel | null
}
export interface FileContent {
  url: string
  fileName: string | null
}
export interface LiveContent {
  note: LocalizedLabel | null
}
export type LessonContent = TextContent | VideoContent | AudioContent | PdfContent | ImageContent | FileContent | LiveContent

export interface LessonResource {
  title: LocalizedLabel
  url: string
}

// --- API-229 «My School» -----------------------------------------------------

/**
 * The next class session of a course card (D-R143): the earliest MOD-06 lesson of
 * that class that is not cancelled and has not ended yet, on the wall clock of its
 * own zone (D-R41); `syllabusItemId` = the curriculum lesson it covers, if any.
 */
export interface NextSession {
  id: string
  title: LocalizedLabel
  startsAt: string
  endsAt: string
  timeZone: string
  deliveryMode: string
  meetingUrl: string | null
  syllabusItemId: string | null
}

export interface MyLearningCourse {
  enrollmentId: string
  relation: 'self' | 'child'
  student: { id: string; fullName: string; displayName: string | null }
  enrollment: { status: 'active' | 'completed'; enrolledAt: string; activatedAt: string | null; completedAt: string | null }
  class: { id: string; code: string; name: LocalizedLabel; status: string; startsOn: string | null; endsOn: string | null }
  course: {
    id: string
    code: string
    name: LocalizedLabel
    summary: LocalizedLabel | null
    coverImageUrl: string | null
    /** J-F67: the course's own materials (its textbook); absent from an older server. */
    resources?: LessonResource[]
    level: { id: string; name: LocalizedLabel } | null
  }
  leadTeacher: { fullName: string; displayName: string | null } | null
  /** null when the class has no session left (D-R143). */
  nextSession: NextSession | null
  progress: ProgressCounts
  lastLesson: { id: string; title: LocalizedLabel; sectionNumber: number; sectionTitle: LocalizedLabel | null; openedAt: string } | null
  lastActivityAt: string | null
  /** null for a child's course: a guardian follows, never studies. */
  action: LearningAction | null
  canLearn: boolean
}

export interface MyLearning {
  items: MyLearningCourse[]
}

// --- API-230 the workspace ---------------------------------------------------

export interface WorkspaceItem {
  id: string
  title: LocalizedLabel
  kind: LearningItemKind
  isRequired: boolean
  estimatedMinutes: number | null
  durationSeconds: number | null
  completionMode: CompletionMode
  state: LearningState
  completedAt: string | null
  /** False while its level is not open yet (D-R145): listed, never opened, visited, played or completed. */
  available: boolean
  /**
   * ISO 8601: when the lesson was added to the curriculum (API-230 since J-F67 — «دروسي» lists every course's lessons
   * newest first). Not the day it was published: a draft published later keeps the day it was written. Absent from a
   * workspace built for the author's preview (API-226).
   */
  createdAt?: string
  /** J-F67: the lesson's downloadable resources, as API-231 lists them. Absent from the author's preview. */
  resources?: LessonResource[]
  /** J-F67: the scheduled or published exams of the learner's class linked to a session of this lesson, soonest first. */
  exams?: WorkspaceItemExam[]
}

/** An exam of the learner's class linked to a lesson (API-230 since J-F67) — what «my exams» already shows them. */
export interface WorkspaceItemExam {
  id: string
  title: LocalizedLabel
  delivery: 'manual' | 'online'
  status: 'scheduled' | 'published'
  scheduledAt: string | null
  closesAt: string | null
  /** The learner has taken it: a finished attempt (submitted or timed out) or a scored result. Absent from an older server. */
  done?: boolean
}

export interface WorkspaceSection {
  /** null = the lessons outside every level. */
  id: string | null
  /** 1-based: «المستوى الأول» = 1. */
  number: number
  title: LocalizedLabel | null
  description: LocalizedLabel | null
  items: WorkspaceItem[]
  progress: ProgressCounts
  /** False before the level's opening day (D-R145): the class's start + the level's `releaseAfterDays`, in the academy's zone. */
  isOpen: boolean
  /** `YYYY-MM-DD` (the academy's zone) of a level that opens on a date; null for a level that is always open. */
  opensOn: string | null
}

/** One class session of the workspace (D-R143): a MOD-06 lesson of the learner's class, with their own attendance only. */
export interface WorkspaceSession {
  id: string
  title: LocalizedLabel
  startsAt: string
  endsAt: string
  status: 'scheduled' | 'completed' | 'cancelled'
  deliveryMode: string
  /** null for a cancelled session. */
  meetingUrl: string | null
  timeZone: string
  /** The curriculum lesson the session covers, if any. */
  syllabusItemId: string | null
  attendance: { status: string; minutesLate: number | null } | null
}

export interface LearningWorkspace {
  course: { id: string; code: string; name: LocalizedLabel; coverImageUrl: string | null }
  enrollment: { id: string; status: 'active' | 'completed'; class: { id: string; code: string; name: LocalizedLabel } }
  /** The academy's share of a measured medium that completes it. */
  completionPercent: number
  sections: WorkspaceSection[]
  progress: ProgressCounts
  /** Never an unavailable lesson (D-R145): the first available one otherwise; null when none is. */
  resume: { itemId: string; reason: 'last' | 'replaced' | 'first'; positionSeconds: number | null } | null
  /** Every session of the chosen enrollment's class, by `startsAt` (at most 300). */
  sessions: WorkspaceSession[]
}

// --- API-231 one lesson ------------------------------------------------------

export interface LessonSession {
  id: string
  classId: string
  title: LocalizedLabel
  startsAt: string
  endsAt: string
  status: 'scheduled' | 'completed' | 'cancelled'
  deliveryMode: string
  meetingUrl: string | null
  timeZone: string
  attendance: { status: string; minutesLate: number | null } | null
}

export interface LessonAssignment {
  id: string
  classId: string
  title: LocalizedLabel
  dueAt: string | null
  status: string
  timeZone: string
}

export interface LessonExam {
  id: string
  classId: string
  title: LocalizedLabel
  type: string
  scheduledAt: string | null
  status: string
}

export interface LearningNeighbor {
  id: string
  title: LocalizedLabel
  available: boolean
}

export interface LearningItem {
  id: string
  courseId: string
  title: LocalizedLabel
  description: LocalizedLabel | null
  kind: LearningItemKind
  content: LessonContent | null
  resources: LessonResource[]
  isRequired: boolean
  estimatedMinutes: number | null
  durationSeconds: number | null
  section: { id: string | null; number: number; title: LocalizedLabel | null }
  completionMode: CompletionMode
  completionPercent: number
  progress: ItemProgress
  /** In learning order across the levels — none skipped; `available` is false toward a lesson of a level not open yet (D-R145). */
  neighbors: { previous: LearningNeighbor | null; next: LearningNeighbor | null }
  sessions: LessonSession[]
  assignments: LessonAssignment[]
  exams: LessonExam[]
}

/** The certificate a completion issued automatically. */
export interface LearningCertificate {
  id: string
  serial: string
}

export interface PlaybackResult {
  progress: ItemProgress
  course: ProgressCounts
  completedNow: boolean
  capped: boolean
  /** The certificate this save earned, else null. */
  certificate: LearningCertificate | null
}

export interface CompletionResult {
  progress: ItemProgress
  section: ProgressCounts
  course: ProgressCounts
  completedNow: boolean
  /** The certificate this completion earned, else null. */
  certificate: LearningCertificate | null
}

/** A played interval in seconds: [start, end). */
export type PlayedRange = [number, number]

export interface PlaybackInput {
  positionSeconds: number
  ranges: PlayedRange[]
}

/** API-229 */
export function getMyLearning(signal?: AbortSignal): Promise<MyLearning> {
  return apiRequest<MyLearning>('/api/me/learning', { signal })
}

/** API-230 */
export function getLearningWorkspace(courseId: string, signal?: AbortSignal): Promise<LearningWorkspace> {
  return apiRequest<LearningWorkspace>(`/api/me/learning/courses/${encodeURIComponent(courseId)}`, { signal })
}

/** API-231 — reads only; opening is recorded by visitLearningItem(). A lesson of a level not open yet: 403 level_not_open { itemId, opensOn } (also API-232..234). */
export function getLearningItem(itemId: string, signal?: AbortSignal): Promise<LearningItem> {
  return apiRequest<LearningItem>(`/api/me/learning/items/${encodeURIComponent(itemId)}`, { signal })
}

/** API-232 — the lesson was opened (never completes it). */
export function visitLearningItem(itemId: string): Promise<{ progress: ItemProgress }> {
  return apiRequest<{ progress: ItemProgress }>(`/api/me/learning/items/${encodeURIComponent(itemId)}/visit`, { method: 'POST', body: {} })
}

/** API-233 — the played intervals since the previous save; `keepalive` for the save sent while the page hides. */
export function savePlayback(itemId: string, input: PlaybackInput, options: { keepalive?: boolean } = {}): Promise<PlaybackResult> {
  return apiRequest<PlaybackResult>(`/api/me/learning/items/${encodeURIComponent(itemId)}/playback`, {
    method: 'PUT',
    body: input,
    keepalive: options.keepalive,
  })
}

/** API-234 — «mark as complete» for a manual lesson; idempotent. */
export function completeLearningItem(itemId: string): Promise<CompletionResult> {
  return apiRequest<CompletionResult>(`/api/me/learning/items/${encodeURIComponent(itemId)}/complete`, { method: 'POST', body: {} })
}
