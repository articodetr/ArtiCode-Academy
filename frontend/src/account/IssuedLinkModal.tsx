// Shows a freshly issued invitation or reset link ONCE (MOD-03-T12): the
// absolute link with a copy button, when it expires and what happened to the
// e-mail copy. Handing the link over by hand is the only delivery channel
// until LR-01 (D-R01/D-R08); the server never returns the token again.
import { CopyOutlined } from '@ant-design/icons'
import { Alert, App, Button, Descriptions, Input, Modal, Space } from 'antd'
import type { InputRef } from 'antd'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { IssuedLink } from '../api/account'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { absoluteLink } from './account.links'

export type IssuedLinkKind = 'invitation' | 'reset'

interface IssuedLinkModalProps {
  kind: IssuedLinkKind
  /** The server response; null keeps the modal closed. */
  issued: IssuedLink | null
  onClose: () => void
}

export function IssuedLinkModal({ kind, issued, onClose }: IssuedLinkModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const inputRef = useRef<InputRef>(null)
  const link = issued ? absoluteLink(issued.link, window.location.origin) : ''

  const copy = async () => {
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(link)
      message.success(t('account.issued.copied'))
    } catch {
      inputRef.current?.select()
      message.warning(t('account.issued.copyFailed'))
    }
  }

  return (
    <Modal
      open={issued !== null}
      title={t(`account.issued.${kind}.title`)}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          {t('account.issued.close')}
        </Button>
      }
      destroyOnHidden
    >
      {issued ? (
        <>
          <Alert type="warning" showIcon message={t('account.issued.onceHint')} style={{ marginBottom: 16 }} />
          <Space.Compact style={{ width: '100%' }}>
            <Input
              ref={inputRef}
              readOnly
              value={link}
              dir="ltr"
              aria-label={t('account.issued.link')}
              onFocus={(event) => event.target.select()}
            />
            <Button icon={<CopyOutlined />} onClick={() => void copy()}>
              {t('account.issued.copy')}
            </Button>
          </Space.Compact>
          <Descriptions
            column={1}
            size="small"
            style={{ marginTop: 16 }}
            items={[
              { key: 'expiresAt', label: t('account.issued.expiresAt'), children: formatDateTime(issued.expiresAt, language) },
              {
                key: 'delivery',
                label: t('account.issued.delivery.label'),
                children: t(`account.issued.delivery.${issued.delivery.status}`, { defaultValue: issued.delivery.status }),
              },
            ]}
          />
        </>
      ) : null}
    </Modal>
  )
}
