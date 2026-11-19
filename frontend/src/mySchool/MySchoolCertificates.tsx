// «Certificates» of «My School» (MOD-20): the reader's own certificates — and,
// for a guardian, the children's — as API-135 returns them (issued and revoked,
// newest first): the course, the serial, the grade, the issue date and the
// print page of an issued one; the full page with the verification links is
// «my certificates».
import { Button, Card, Empty, Skeleton, Space, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { MyCertificateItem } from '../api/myCertificates'
import { CertificateStatusTag } from '../certificates/CertificateStatusTag'
import { gradeLine } from '../certificates/certificates.format'
import { myCertificatePrintPath } from '../certificates/certificates.links'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDateTime, localizedLabel } from '../users/users.format'
import { mySchoolFailureKey } from './mySchool.view'
import { SourceAlert } from './SourceAlert'

const MY_CERTIFICATES_PATH = '/my-certificates'

interface CertificatesSource {
  items: MyCertificateItem[]
  error: unknown
  loading: boolean
  reload: () => void
}

export function MySchoolCertificates({ source }: { source: CertificatesSource }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()

  const all = (
    <div>
      <Button onClick={() => navigate(MY_CERTIFICATES_PATH)}>{t('mySchool.certificates.all')}</Button>
    </div>
  )

  // A retry shows the loading state again until its answer arrives.
  if (source.loading && source.items.length === 0) return <Skeleton active />
  if (source.error) {
    return <SourceAlert title={t('mySchool.certificates.loadError')} description={t(mySchoolFailureKey(source.error))} onRetry={source.reload} />
  }
  if (source.items.length === 0) return <Empty description={t('mySchool.certificates.empty')} />

  return (
    <>
      <div className="ms-grid">
        {source.items.map((item) => (
          <Card
            key={item.id}
            size="small"
            data-testid={`certificate-${item.id}`}
            title={localizedLabel(item.course.name, language)}
            extra={<CertificateStatusTag status={item.status} />}
            styles={{ body: { display: 'flex', flexDirection: 'column', gap: 6 } }}
          >
            {item.relation === 'child' ? <Typography.Text strong>{t('mySchool.card.student', { name: displayNameOf(item.student) })}</Typography.Text> : null}
            <Typography.Text type="secondary">
              {t('mySchool.certificates.serial')}: <bdi dir="ltr">{item.serial}</bdi>
            </Typography.Text>
            <Typography.Text type="secondary">
              {t('mySchool.certificates.grade')}: <bdi>{gradeLine(item.grade, language)}</bdi>
            </Typography.Text>
            <Typography.Text type="secondary">
              {t('mySchool.certificates.issuedAt')}: {formatDateTime(item.issuedAt, language)}
            </Typography.Text>
            {item.status === 'issued' ? (
              <Space>
                <Button type="primary" onClick={() => navigate(myCertificatePrintPath(item.id))}>
                  {t('mySchool.certificates.print')}
                </Button>
              </Space>
            ) : null}
          </Card>
        ))}
      </div>
      {all}
    </>
  )
}
