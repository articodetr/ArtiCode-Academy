// The print page of a certificate (J-F51 — D-R50, ADR-067): no server PDF —
// the page builds the certificate from its snapshot (CertificateSheet) and the
// browser prints it, or saves it as a PDF from its print dialog. It lives
// outside the app layout, so neither the screen nor the paper carries the
// menu or the header; the toolbar (back, the language of the certificate,
// print) and the notices are hidden in print by certificates.css. Two routes:
// /certificates/:id/print reads API-131 (the holders of
// `certificates.read_all` or `certificates.issue`), /my-certificates/:id/print
// finds the certificate in API-135 (a student's own, or a guardian's linked
// child's). The printed days are the academy's (API-035), so they match the
// year of the serial (D-R53). A revoked certificate is printed with a «revoked»
// mark and the date of the revocation shows above it — never the reason.
import { ArrowLeftOutlined, ArrowRightOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Flex, Segmented, Skeleton, Space, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useAcademy } from '../academy/useAcademy'
import { academyZoneOf } from '../assignments/assignments.zone'
import { CertificateSheet } from '../certificates/CertificateSheet'
import { describeCertificatesFailure, failureMessage } from '../certificates/certificates.errors'
import { formatCertificateDay } from '../certificates/certificates.format'
import { usePrintedCertificate } from '../certificates/usePrintedCertificate'
import type { PrintSource } from '../certificates/usePrintedCertificate'
import { useLocalized } from '../i18n/useLocalized'
import { SUPPORTED_LANGUAGES, isLanguage } from '../i18n/language'
import type { Language } from '../i18n/language'
// The page's own classes (toolbar, notices, print rules) live beside the sheet's.
import '../certificates/certificates.css'

const BACK_PATHS: Readonly<Record<PrintSource, string>> = { academy: '/certificates', own: '/my-certificates' }

const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { ar: 'العربية', en: 'English' }

export function CertificatePrintPage({ source }: { source: PrintSource }) {
  const { id } = useParams<{ id: string }>()
  const { t, i18n } = useTranslation()
  const { language } = useLocalized()
  const { academy, error: academyError } = useAcademy()
  const zone = academyZoneOf(academy) ?? undefined
  // The printed days wait for the academy's zone (the shared API-035 reading) — this device's when it cannot be read.
  const zoneSettled = academy !== null || academyError !== null
  const reading = usePrintedCertificate(source, id)
  const [printLanguage, setPrintLanguage] = useState<Language>(language)
  // The certificate speaks the language chosen for it, whatever the language of the app.
  const sheetT = useMemo(() => i18n.getFixedT(printLanguage), [i18n, printLanguage])
  const certificate = reading.certificate
  const ready = certificate !== null && !reading.loading && zoneSettled

  let body
  if (reading.loading || (certificate && !zoneSettled)) {
    body = <Skeleton active paragraph={{ rows: 10 }} data-testid="certificate-print-loading" />
  } else if (reading.error) {
    body = (
      <Alert
        className="certificate-print-notice"
        type="error"
        showIcon
        title={failureMessage(t, describeCertificatesFailure(reading.error))}
        action={
          <Button size="small" icon={<ReloadOutlined />} onClick={reading.reload}>
            {t('certificates.refresh')}
          </Button>
        }
      />
    )
  } else if (!certificate) {
    body = <Alert className="certificate-print-notice" type="warning" showIcon title={t('certificates.print.notFound')} />
  } else {
    body = (
      <>
        {certificate.status === 'revoked' ? (
          <Alert
            className="certificate-print-notice"
            type="error"
            showIcon
            title={t('certificates.print.revokedNotice', { date: formatCertificateDay(certificate.revokedAt, language, zone) })}
          />
        ) : null}
        <CertificateSheet
          serial={certificate.serial}
          verificationCode={certificate.verificationCode}
          status={certificate.status}
          snapshot={certificate.snapshot}
          language={printLanguage}
          t={sheetT}
          timeZone={zone}
          origin={window.location.origin}
        />
      </>
    )
  }

  return (
    <div className="certificate-print-page">
      <Flex className="certificate-print-toolbar" justify="space-between" align="center" wrap gap={12}>
        <Link to={BACK_PATHS[source]}>
          <Button icon={language === 'ar' ? <ArrowRightOutlined /> : <ArrowLeftOutlined />}>{t(source === 'own' ? 'certificates.print.backOwn' : 'certificates.print.back')}</Button>
        </Link>
        <Space wrap>
          <Typography.Text type="secondary">{t('certificates.print.language')}</Typography.Text>
          <Segmented<Language>
            value={printLanguage}
            options={SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] }))}
            onChange={(value) => {
              if (isLanguage(value)) setPrintLanguage(value)
            }}
            aria-label={t('certificates.print.language')}
          />
          <Button type="primary" icon={<PrinterOutlined />} disabled={!ready} onClick={() => window.print()}>
            {t('certificates.print.print')}
          </Button>
        </Space>
      </Flex>
      {ready ? (
        <Typography.Paragraph className="certificate-print-notice" type="secondary" style={{ fontSize: 12 }}>
          {t('certificates.print.hint')}
        </Typography.Paragraph>
      ) : null}
      {body}
    </div>
  )
}
