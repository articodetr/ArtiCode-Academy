// Manual announcements (MOD-12-T05 — J-F54): API-173 POST /api/announcements,
// API-174 GET /api/announcements and API-175 GET /api/announcements/:id. Types
// mirror backend/src/notifications/announcements.dto.ts field by field (the
// audience in its normalised answer shape — announcements.audience.ts). The
// three routes need `notifications.send` (the teacher and the academy admin by
// seed). Without `classes.manage` a holder announces to the classes they teach
// and reads their own announcements; with it, to any class or to the academy by
// role, and reads every announcement (D-R85). The title and the body are plain
// text, stored and returned as typed (trimmed) — never HTML. An announcement
// cannot be edited or withdrawn; API-173 has no idempotency key, so the
// composer disables its send button while a request runs.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

/** The system roles an academy audience may name, in the order a normalised audience lists them (ANNOUNCEMENT_ROLE_KEYS). */
export const ANNOUNCEMENT_ROLE_KEYS = ['student', 'guardian', 'teacher', 'staff'] as const
export type AnnouncementRoleKey = (typeof ANNOUNCEMENT_ROLE_KEYS)[number]

/** The groups of a class audience, in the order the composer offers them. */
export const ANNOUNCEMENT_CLASS_GROUPS = ['students', 'guardians', 'teachers'] as const
export type AnnouncementClassGroup = (typeof ANNOUNCEMENT_CLASS_GROUPS)[number]

/** CHECK `ck_announcements_title_length` / `ck_announcements_body_length`: characters (code points) after trimming. */
export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 200
export const ANNOUNCEMENT_BODY_MAX_LENGTH = 4000
/** Recipients one announcement may reach (D-R85). */
export const ANNOUNCEMENT_MAX_RECIPIENTS = 5000

/** A class audience: the students with an active enrollment, their guardians and/or the teachers of the class. */
export interface ClassAnnouncementAudience {
  kind: 'class'
  classId: string
  students: boolean
  guardians: boolean
  teachers: boolean
}

/** An academy audience: everyone who holds one of the roles (needs `classes.manage`). */
export interface AcademyAnnouncementAudience {
  kind: 'academy'
  roleKeys: AnnouncementRoleKey[]
}

/** `AnnouncementAudienceDto` as every answer carries it: normalised — the three groups spelled out, the role keys in the fixed order. */
export type AnnouncementAudience = ClassAnnouncementAudience | AcademyAnnouncementAudience

/** `AnnouncementClassDto`. */
export interface AnnouncementClass {
  id: string
  code: string
  name: LocalizedLabel
}

/** `AnnouncementSenderDto`. */
export interface AnnouncementSender {
  id: string
  fullName: string
  displayName: string | null
}

/** `AnnouncementDto` (API-173 answer, API-174 items). */
export interface Announcement {
  id: string
  audience: AnnouncementAudience
  /** The class of a class announcement; null for an academy announcement and for a class deleted since (`audience.classId` keeps its id). */
  class: AnnouncementClass | null
  /** As the sender typed it (trimmed) — plain text. */
  title: string
  /** As the sender typed it (trimmed) — plain text, never HTML. */
  body: string
  /** Whether the sender asked for an e-mail copy. */
  sendEmail: boolean
  /** Recipients when it was sent: active accounts, each once, without the sender. */
  recipientCount: number
  /** null when the sender's account no longer exists. */
  sender: AnnouncementSender | null
  /** ISO 8601 */
  createdAt: string
}

/** `AnnouncementListDto`: newest first (keyset on the UUIDv7 id). */
export interface AnnouncementList {
  items: Announcement[]
  nextCursor: string | null
}

/** `AnnouncementEmailCountsDto`: the e-mail copies by state — counts only, never an address. */
export interface AnnouncementEmailCounts {
  /** No e-mail was due: not asked for, no confirmed address, or the recipient switched the category off. */
  none: number
  queued: number
  sent: number
  failed: number
  /** Due, but the academy has no mail transport (or the recipient lost the address before sending). */
  skipped: number
}

/** `AnnouncementDetailDto` (API-175): computed on read from the current notifications; `recipientCount` stays the count when sent. */
export interface AnnouncementDetail extends Announcement {
  /** Recipients who marked its notification as read. */
  readCount: number
  email: AnnouncementEmailCounts
}

/** The audience of a request: a class audience with its three groups, or an academy audience with its role keys and nothing else. */
export type AnnouncementAudienceInput = ClassAnnouncementAudience | AcademyAnnouncementAudience

/** `CreateAnnouncementDto` (API-173). */
export interface CreateAnnouncementInput {
  audience: AnnouncementAudienceInput
  /** 1–200 characters after trimming, no NUL. */
  title: string
  /** 1–4,000 characters after trimming, no NUL — plain text. */
  body: string
  /** A JSON boolean; false by default. */
  sendEmail?: boolean
}

/** `ListAnnouncementsQueryDto`. */
export interface ListAnnouncementsParams {
  /** 1–100, server default 20. */
  limit?: number
  cursor?: string
  /** Announcements sent to this class only (an unknown id = an empty list). */
  classId?: string
}

export const ANNOUNCEMENTS_PATH = '/api/announcements'

/** `/api/announcements?…` with the given parameters only, in a fixed order. */
export function announcementsPath(params: ListAnnouncementsParams = {}): string {
  const query = new URLSearchParams()
  if (params.classId) query.set('classId', params.classId)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${ANNOUNCEMENTS_PATH}?${search}` : ANNOUNCEMENTS_PATH
}

/** API-173: 400 (validation | `audience_invalid { problems }`), 403 `permission_denied { missing }`, 404 `class_not_found`, 422 `audience_empty` | `audience_too_large { recipients, max }`. */
export function createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement> {
  return apiRequest<Announcement>(ANNOUNCEMENTS_PATH, { method: 'POST', body: input })
}

/** API-174: the caller's announcements — every announcement for a holder of `classes.manage`. */
export function listAnnouncements(params: ListAnnouncementsParams = {}, signal?: AbortSignal): Promise<AnnouncementList> {
  return apiRequest<AnnouncementList>(announcementsPath(params), { signal })
}

/** API-175: 404 `announcement_not_found` for an unknown one and for another sender's without `classes.manage`. */
export function getAnnouncement(id: string, signal?: AbortSignal): Promise<AnnouncementDetail> {
  return apiRequest<AnnouncementDetail>(`${ANNOUNCEMENTS_PATH}/${encodeURIComponent(id)}`, { signal })
}
