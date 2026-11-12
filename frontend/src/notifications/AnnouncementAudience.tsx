// Who an announcement went to (J-F54), from its normalised audience: the class
// (code and name — or «a deleted class») or the academy, then its groups as tags.
import { Space, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Announcement } from '../api/announcements'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { audienceGroupKeys } from './announcements.format'

export function AnnouncementAudience({ announcement }: { announcement: Pick<Announcement, 'audience' | 'class'> }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { audience } = announcement

  const target =
    audience.kind === 'academy' ? (
      <Typography.Text strong>{t('announcements.audience.academy')}</Typography.Text>
    ) : announcement.class ? (
      <span>
        <Typography.Text strong dir="ltr">
          {announcement.class.code}
        </Typography.Text>{' '}
        <Typography.Text type="secondary">{localizedLabel(announcement.class.name, language)}</Typography.Text>
      </span>
    ) : (
      <Typography.Text type="secondary">{t('announcements.audience.deletedClass')}</Typography.Text>
    )

  return (
    <Space orientation="vertical" size={4}>
      {target}
      <Space size={4} wrap>
        {audienceGroupKeys(audience).map((key) => (
          <Tag key={key} style={{ margin: 0 }}>
            {t(key)}
          </Tag>
        ))}
      </Space>
    </Space>
  )
}
