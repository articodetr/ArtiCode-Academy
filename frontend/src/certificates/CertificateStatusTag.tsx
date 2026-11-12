// The status of a certificate (J-F51): issued (valid) or revoked for good (D-R55).
// Its own words under certificates.status.* — the shared `labels.*` vocabulary
// carries no certificate statuses.
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CertificateStatus } from '../api/certificates'

const COLORS: Readonly<Record<CertificateStatus, string>> = { issued: 'green', revoked: 'red' }

export function CertificateStatusTag({ status }: { status: CertificateStatus }) {
  const { t } = useTranslation()
  return <Tag color={COLORS[status] ?? 'default'}>{t(`certificates.status.${status}`)}</Tag>
}
