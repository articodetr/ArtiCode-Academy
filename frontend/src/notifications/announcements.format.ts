// Pure presentation helpers of the announcements (J-F54): who an announcement
// was sent to, from its normalised audience (API-173..175). No React; callers
// pass `t`. Unit-tested in announcements.format.test.ts.
import type { Announcement, AnnouncementAudience } from '../api/announcements'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'
import type { Translate } from '../users/users.format'

/** Translation keys of the groups an audience names, in its own order: a class's groups, or the academy's roles. */
export function audienceGroupKeys(audience: AnnouncementAudience): string[] {
  if (audience.kind === 'class') {
    const keys: string[] = []
    if (audience.students) keys.push('announcements.groups.students')
    if (audience.guardians) keys.push('announcements.groups.guardians')
    if (audience.teachers) keys.push('announcements.groups.teachers')
    return keys
  }
  return audience.roleKeys.map((key) => `announcements.roleGroups.${key}`)
}

/** «PY-101-A — the class name», «the academy», or a deleted class (its id stays in the audience). */
export function audienceTarget(announcement: Pick<Announcement, 'audience' | 'class'>, t: Translate, language: Language): string {
  if (announcement.audience.kind === 'academy') return t('announcements.audience.academy')
  if (!announcement.class) return t('announcements.audience.deletedClass')
  return `${announcement.class.code} — ${localizedLabel(announcement.class.name, language)}`
}

/** The audience in one line: the target, then its groups. */
export function audienceSummary(announcement: Pick<Announcement, 'audience' | 'class'>, t: Translate, language: Language): string {
  const groups = audienceGroupKeys(announcement.audience).map((key) => t(key))
  return `${audienceTarget(announcement, t, language)} · ${groups.join(t('announcements.listSeparator'))}`
}
