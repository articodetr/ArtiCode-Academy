// The full-page states 403 and 404 (redesign, 2026-11-14): antd's Result illustrations are purple and blue, so the
// app draws its own — a navy icon on a soft navy disc with a chalk-yellow accent, the code, one sentence and the way
// back. Text and roles stay what the pages had (title = the code, the message, one primary button).
import { LockOutlined, CompassOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import './StatusPage.css'

interface StatusPageProps {
  code: '403' | '404'
  message: string
}

export function StatusPage({ code, message }: StatusPageProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className="status-page" role="alert">
      <div className="status-page__art" aria-hidden="true">
        <span className="status-page__disc">{code === '403' ? <LockOutlined /> : <CompassOutlined />}</span>
        <span className="status-page__accent" />
      </div>
      <h1 className="status-page__code tabular-nums">{code}</h1>
      <p className="status-page__message">{message}</p>
      <Button type="primary" size="large" onClick={() => navigate('/')}>
        {t('errors.backHome')}
      </Button>
    </div>
  )
}
