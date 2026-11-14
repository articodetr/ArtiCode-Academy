// Announcements (MOD-12-T05): API-173 POST /api/announcements, API-174 GET
// /api/announcements, API-175 GET /api/announcements/:id. Types mirror
// backend/src/notifications/announcements.dto.ts and announcements.audience.ts.
// All three need `notifications.send`; an academy audience needs
// `classes.manage` too, and a class audience a class the caller teaches (or
// any class with `classes.manage`). The sender reads their own announcements,
// a holder of `classes.manage` all of them — the server decides.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

/** Mirrors of the DTO limits — counted in code points after trimming, like the CHECKs. */
export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 200
export const ANNOUNCEMENT_BODY_MAX_LENGTH = 4000
export const ANNOUNCEMENT_MAX_RECIPIENTS = 5000

/** The system roles an academy audience may name, in the order the server normalises them. */
export const ANNOUNCEMENT_ROLE_KEYS = ['student', 'guardian', 'teacher', 'staff'] as const
export type AnnouncementRoleKey = (typeof ANNOUNCEMENT_ROLE_KEYS)[number]

/** The groups of a class audience. */
export const ANNOUNCEMENT_CLASS_GROUPS = ['students', 'guardians', 'teachers'] as const
export type AnnouncementClassGroup = (typeof ANNOUNCEMENT_CLASS_GROUPS)[number]

export interface ClassAudience {
  kind: 'class'
  classId: string
  students: boolean
  guardians: boolean
  teachers: boolean
}

export interface AcademyAudience {
  kind: 'academy'
  roleKeys: AnnouncementRoleKey[]
}

export type AnnouncementAudience = ClassAudience | AcademyAudience

/** Body of API-173 (`CreateAnnouncementDto`). */
export interface CreateAnnouncementInput {
  audience: AnnouncementAudience
  title: string
  body: string
  sendEmail?: boolean
}

export interface AnnouncementClass {
  id: string
  code: string
  name: LocalizedLabel
}

export interface AnnouncementSender {
  id: string
  fullName: string
  displayName: string | null
}

/** `AnnouncementDto`. */
export interface Announcement {
  id: string
  audience: AnnouncementAudience
  /** null for an academy announcement and for a class that no longer exists. */
  class: AnnouncementClass | null
  title: string
  body: string
  sendEmail: boolean
  recipientCount: number
  sender: AnnouncementSender | null
  createdAt: string
}

export interface AnnouncementList {
  items: Announcement[]
  nextCursor: string | null
}

/** `AnnouncementEmailCountsDto`. */
export interface AnnouncementEmailCounts {
  none: number
  queued: number
  sent: number
  failed: number
  skipped: number
}

/** `AnnouncementDetailDto` (API-175). */
export interface AnnouncementDetail extends Announcement {
  readCount: number
  email: AnnouncementEmailCounts
}

export interface ListAnnouncementsParams {
  classId?: string
  /** 1–100, server default 20. */
  limit?: number
  cursor?: string
}

export const ANNOUNCEMENTS_PATH = '/api/announcements'

/** `/api/announcements?…` with the given parameters only, in a fixed order. */
export function announcementsListPath(params: ListAnnouncementsParams = {}): string {
  const query = new URLSearchParams()
  if (params.classId) query.set('classId', params.classId)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${ANNOUNCEMENTS_PATH}?${search}` : ANNOUNCEMENTS_PATH
}

export function listAnnouncements(params: ListAnnouncementsParams = {}, signal?: AbortSignal): Promise<AnnouncementList> {
  return apiRequest<AnnouncementList>(announcementsListPath(params), { signal })
}

export function getAnnouncement(id: string, signal?: AbortSignal): Promise<AnnouncementDetail> {
  return apiRequest<AnnouncementDetail>(`${ANNOUNCEMENTS_PATH}/${encodeURIComponent(id)}`, { signal })
}

/** API-173 answers 201 with the announcement (`AnnouncementDto`). */
export function createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement> {
  return apiRequest<Announcement>(ANNOUNCEMENTS_PATH, { method: 'POST', body: input })
}
