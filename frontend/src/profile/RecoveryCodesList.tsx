// A new set of recovery codes, shown ONCE (API-208 after enabling, API-210 after regenerating): the server keeps
// only their hashes and never returns them again. The codes can be copied or saved as a text file built in the
// browser (a Blob — nothing goes to the network), and «close» stays off until the user ticks that they are saved —
// a line under the tick says so, tied to both (`aria-describedby`), since «close» is the only way out here.
// Whether they are saved belongs to the dialog (`saved` / `onSavedChange`): until then it also holds a browser
// back, a reload and a tab close (useMfaLeaveGuard). The view takes the cursor on its heading when it replaces
// the form. The codes live in the props of this view only: never in storage, never in a log, never in a React
// key; they go when the dialog closes — and with it the link of a downloaded file.
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Checkbox, Space, Typography } from 'antd'
import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { RECOVERY_CODES_FILE_NAME, recoveryCodesClipboardText, recoveryCodesFileText } from './mfa.format'
import './mfa.css'

interface RecoveryCodesListProps {
  /** The codes of the server's answer, `XXXXX-XXXXX` each. */
  codes: readonly string[]
  /** When they were made (ISO 8601) — a line of the downloaded file. */
  generatedAt: string
  /** Whether the user ticked that the codes are saved. */
  saved: boolean
  onSavedChange: (saved: boolean) => void
  /** «Close», possible only after the tick. */
  onDone: () => void
}

/**
 * How long the link of a downloaded file lives. Firefox and Safari start a Blob download after the click has
 * returned, so a link revoked at once can cancel it; a minute is ample, and the view revokes what is left when
 * it goes.
 */
export const DOWNLOAD_LINK_LIFETIME_MS = 60_000

/** Hands `content` to the browser as a file through a temporary Blob link — nothing goes to the server. Returns the link, to revoke later. */
function downloadTextFile(fileName: string, content: string): string {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  return url
}

export function RecoveryCodesList({ codes, generatedAt, saved, onSavedChange, onDone }: RecoveryCodesListProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const list = useRef<HTMLOListElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const closeHintId = useId()
  // The Blob links handed to the browser and not revoked yet, each with the timer that will revoke it.
  const links = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // The form that asked for the codes is gone, and the cursor with it: it lands on the heading, from where a
  // screen reader goes on to the warning and the codes.
  useEffect(() => {
    heading.current?.focus()
  }, [])

  // The view goes (and the codes with it): no link to a file of them stays behind, and no timer.
  useEffect(() => {
    const pending = links.current
    return () => {
      for (const [url, timer] of pending) {
        clearTimeout(timer)
        URL.revokeObjectURL(url)
      }
      pending.clear()
    }
  }, [])

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
    const url = downloadTextFile(
      RECOVERY_CODES_FILE_NAME,
      recoveryCodesFileText(codes, {
        title: t('profile.mfa.codes.fileTitle'),
        generatedAt: t('profile.mfa.codes.fileGeneratedAt', { when: formatDateTime(generatedAt, language) }),
        hint: t('profile.mfa.codes.fileHint'),
      }),
    )
    const pending = links.current
    pending.set(
      url,
      setTimeout(() => {
        pending.delete(url)
        URL.revokeObjectURL(url)
      }, DOWNLOAD_LINK_LIFETIME_MS),
    )
  }

  return (
    <>
      <h2 ref={heading} id={headingId} tabIndex={-1} className="profile-mfa__codes-title">
        {t('profile.mfa.codes.listLabel')}
      </h2>
      <Alert type="warning" showIcon title={t('profile.mfa.codes.warning')} description={t('profile.mfa.codes.hint')} />
      <ol ref={list} className="profile-mfa__codes" dir="ltr" aria-labelledby={headingId} data-testid="mfa-recovery-codes">
        {codes.map((code, index) => (
          // By position: the list never changes while it is shown, and a key must not carry a code.
          <li key={index}>
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
        <Checkbox checked={saved} aria-describedby={closeHintId} onChange={(event) => onSavedChange(event.target.checked)}>
          {t('profile.mfa.codes.saved')}
        </Checkbox>
        {/* «Close» is off and it is the only way out: say what turns it on — to the eye, and to a screen reader on
            the tick and on the button. */}
        <div id={closeHintId} className="profile-mfa__close-hint" data-testid="mfa-close-hint">
          <Typography.Text type="secondary">{t('profile.mfa.codes.closeHint')}</Typography.Text>
        </div>
      </div>
      <div className="profile-mfa__footer">
        <Button type="primary" disabled={!saved} aria-describedby={closeHintId} onClick={onDone}>
          {t('profile.mfa.codes.close')}
        </Button>
      </div>
    </>
  )
}
