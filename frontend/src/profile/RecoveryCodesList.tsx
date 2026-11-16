// A new set of recovery codes, shown ONCE (API-208 after enabling, API-210 after regenerating): the server keeps
// only their hashes and never returns them again. The codes can be copied or saved as a text file built in the
// browser (a Blob — nothing goes to the network), and «close» stays off until the user ticks that they are saved.
// Until then a reload or a tab close gets the browser's own prompt. The codes live in the props of this view only:
// never in storage, never in a log; they go when the dialog closes.
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Checkbox, Space } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { preventUnload } from '../common/unsavedChanges'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { RECOVERY_CODES_FILE_NAME, recoveryCodesClipboardText, recoveryCodesFileText } from './mfa.format'
import './mfa.css'

interface RecoveryCodesListProps {
  /** The codes of the server's answer, `XXXXX-XXXXX` each. */
  codes: readonly string[]
  /** When they were made (ISO 8601) — a line of the downloaded file. */
  generatedAt: string
  /** «Close», possible only after the tick. */
  onDone: () => void
}

/** Saves `content` through a temporary Blob link; nothing goes to the server. */
function downloadTextFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function RecoveryCodesList({ codes, generatedAt, onDone }: RecoveryCodesListProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [saved, setSaved] = useState(false)
  const list = useRef<HTMLOListElement>(null)

  // A reload or a tab close would take the codes away for good: the browser asks first until they are saved.
  useEffect(() => {
    if (saved) return
    const listener = (event: BeforeUnloadEvent) => preventUnload(event)
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [saved])

  const copy = async () => {
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(recoveryCodesClipboardText(codes))
      message.success(t('profile.mfa.codes.copied'))
    } catch {
      // No clipboard (a plain-HTTP origin, a refused permission): select the codes for a manual copy.
      if (list.current) window.getSelection()?.selectAllChildren(list.current)
      message.warning(t('profile.mfa.codes.copyFailed'))
    }
  }

  const download = () => {
    downloadTextFile(
      RECOVERY_CODES_FILE_NAME,
      recoveryCodesFileText(codes, {
        title: t('profile.mfa.codes.fileTitle'),
        generatedAt: t('profile.mfa.codes.fileGeneratedAt', { when: formatDateTime(generatedAt, language) }),
        hint: t('profile.mfa.codes.fileHint'),
      }),
    )
  }

  return (
    <>
      <Alert type="warning" showIcon title={t('profile.mfa.codes.warning')} description={t('profile.mfa.codes.hint')} />
      <ol ref={list} className="profile-mfa__codes" dir="ltr" aria-label={t('profile.mfa.codes.listLabel')} data-testid="mfa-recovery-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <Space wrap>
        <Button icon={<CopyOutlined />} onClick={() => void copy()}>
          {t('profile.mfa.codes.copy')}
        </Button>
        <Button icon={<DownloadOutlined />} onClick={download}>
          {t('profile.mfa.codes.download')}
        </Button>
      </Space>
      <div style={{ marginTop: 16 }}>
        <Checkbox checked={saved} onChange={(event) => setSaved(event.target.checked)}>
          {t('profile.mfa.codes.saved')}
        </Checkbox>
      </div>
      <div className="profile-mfa__footer">
        <Button type="primary" disabled={!saved} onClick={onDone}>
          {t('profile.mfa.codes.close')}
        </Button>
      </div>
    </>
  )
}
