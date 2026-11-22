// «آخر الإشعارات» on the admin home (J-F59): the caller's own latest notifications (API-167, by ownership — no key),
// with «show all» when the menu opens /notifications for this viewer. Personal notifications only: publishing an
// announcement to students or teachers (API-173) is a separate feature and has no button here.
import { Typography } from 'antd'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { MyNotificationList } from '../../api/notifications'
import { CardContent, RecentNotifications } from '../DashboardCards'
import type { Reloadable } from '../useLoad'

export function AdminRecentNotifications({ loaded, canOpenAll }: { loaded: Reloadable<MyNotificationList>; canOpenAll: boolean }) {
  const { t } = useTranslation()
  const headingId = useId()
  return (
    <section className="admin-panel" aria-labelledby={headingId}>
      <header className="admin-panel__header">
        <Typography.Title level={2} id={headingId} className="admin-section__title">
          {t('dashboard.recentNotifications')}
        </Typography.Title>
        {canOpenAll ? <Link to="/notifications">{t('dashboard.admin.allNotifications')}</Link> : null}
      </header>
      <CardContent loaded={loaded}>{(page) => <RecentNotifications items={page.items} />}</CardContent>
    </section>
  )
}
