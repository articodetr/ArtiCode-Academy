// The quick actions of the admin home (J-F59): the cards the viewer may use (admin.actions.ts), 6 per row on a wide
// screen down to 2 on a phone (admin.css — container queries on the section's own width). A phone shows the first
// PHONE_VISIBLE_ACTIONS and a «show more» button for the rest; wider screens show every card and no button.
import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { Button, Typography } from 'antd'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PHONE_VISIBLE_ACTIONS } from './admin.actions'
import type { QuickAction } from './admin.actions'
import { useTwoTone } from './admin.tones'
import { QuickActionCard } from './QuickActionCard'

export function AdminQuickActions({ actions }: { actions: QuickAction[] }) {
  const { t } = useTranslation()
  const twoTone = useTwoTone()
  const [expanded, setExpanded] = useState(false)
  const headingId = useId()
  const listId = useId()
  const hidden = actions.length - PHONE_VISIBLE_ACTIONS

  return (
    <section className="admin-actions" aria-labelledby={headingId}>
      <Typography.Title level={2} id={headingId} className="admin-section__title">
        {t('dashboard.admin.quickActions')}
      </Typography.Title>
      {actions.length === 0 ? (
        <Typography.Text type="secondary">{t('dashboard.admin.noActions')}</Typography.Text>
      ) : (
        <>
          <ul id={listId} className={expanded ? 'admin-actions__grid' : 'admin-actions__grid admin-actions__grid--collapsed'}>
            {actions.map((action, index) => (
              <QuickActionCard
                key={action.key}
                to={action.to}
                title={t(`dashboard.admin.actions.${action.key}`)}
                icon={action.icon}
                twoTone={twoTone}
                extra={index >= PHONE_VISIBLE_ACTIONS}
              />
            ))}
          </ul>
          {hidden > 0 ? (
            // Shown on a phone only (admin.css); a wider screen already shows every card.
            <div className="admin-actions__more">
              <Button
                type="link"
                icon={expanded ? <UpOutlined /> : <DownOutlined />}
                iconPlacement="end"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((value) => !value)}
              >
                {/* `n`, not `count`: a number in brackets needs no Arabic plural form (KI-117). */}
                {expanded ? t('dashboard.admin.showLess') : t('dashboard.admin.showMore', { n: hidden })}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
