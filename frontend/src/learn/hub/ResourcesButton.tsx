// A button of downloadable files (J-F67), shared by a lesson row (its attachments) and a card of «دوراتي» (the course's
// own materials — its textbook): one file opens at its own https address in a new tab; more than one is a small menu.
import { DownOutlined, PaperClipOutlined } from '@ant-design/icons'
import { Dropdown } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { LessonResource } from '../../api/learning'
import { useLocalized } from '../../i18n/useLocalized'
import { localizedLabel } from '../../users/users.format'

interface ResourcesButtonProps {
  resources: readonly LessonResource[]
  /** The label of one file. */
  label: string
  /** The label of several, with their count. */
  labelMany: string
  /** What the files belong to, for a screen reader (the lesson's or the course's name). */
  context: string
  /** The button's look: `hub-btn--open` (a lesson row) or `hub-btn--book` (a card). */
  className: string
  icon?: ReactNode
}

export function ResourcesButton({ resources, label, labelMany, context, className, icon = <PaperClipOutlined aria-hidden /> }: ResourcesButtonProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  if (resources.length === 0) return null
  if (resources.length === 1) {
    const resource = resources[0]!
    return (
      <a className={`hub-btn ${className}`} href={resource.url} target="_blank" rel="noopener noreferrer" title={localizedLabel(resource.title, language)}>
        {icon} {label}
        <span className="learn-sr-only">
          : {localizedLabel(resource.title, language)} — {context} {t('mySchool.card.newTab')}
        </span>
      </a>
    )
  }
  return (
    <Dropdown
      trigger={['click']}
      destroyOnHidden
      menu={{
        items: resources.map((resource, index) => ({
          key: `${index}:${resource.url}`,
          label: (
            <a href={resource.url} target="_blank" rel="noopener noreferrer">
              {localizedLabel(resource.title, language)}
            </a>
          ),
        })),
      }}
    >
      <button type="button" className={`hub-btn ${className}`}>
        {icon} {labelMany} <DownOutlined aria-hidden />
        <span className="learn-sr-only">: {context}</span>
      </button>
    </Dropdown>
  )
}
