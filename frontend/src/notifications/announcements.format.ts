// How an announcement's audience reads on screen.
import type { Announcement } from '../api/announcements'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

type Translate = (key: string, options?: Record<string, unknown>) => string

export function audienceLabel(announcement: Pick<Announcement, 'audience' | 'class'>, t: Translate, language: Language): string {
  const { audience } = announcement
  if (audience.kind === 'academy') {
    return `${t('notifications.announcements.audience.academy')}: ${audience.roleKeys.map((key) => t(`roles.${key}`)).join(' · ')}`
  }
  const cls = announcement.class ? `${announcement.class.code} — ${localizedLabel(announcement.class.name, language)}` : t('notifications.announcements.audience.classGone')
  const groups = (['students', 'guardians', 'teachers'] as const).filter((group) => audience[group]).map((group) => t(`notifications.announcements.groups.${group}`))
  return `${cls} (${groups.join(' · ')})`
}
