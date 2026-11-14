// The printable certificate (J-F51 — D-R50/D-R51, ADR-067): built from the
// snapshot alone — the student's names, the course, the class, the academy
// and the grade as they were at issuance, so a later edit never changes a
// printed certificate — with the serial (D-R53), the completion and issue
// days, and a QR code of the public verification page with its code (D-R56; the
// link became a QR code in the redesign, 2026-11-14 — the code stays printed for typing by hand). The
// wording is the frontend's (certificates.sheet.*), in the language chosen for
// the print, independent of the language of the app (a fixed `t`). A revoked
// certificate carries a «revoked» watermark, on screen and on paper.
import { QRCodeSVG } from 'qrcode.react'
import type { CertificateSnapshot, CertificateStatus } from '../api/certificates'
import { directionOf } from '../i18n/language'
import type { Language } from '../i18n/language'
import type { Translate } from '../users/users.format'
import { localizedLabel } from '../users/users.format'
import { bandOf, formatCertificateDay, formatPercent, printedStudentName } from './certificates.format'
import { groupVerificationCode, verificationUrl } from './certificates.links'
import './certificates.css'

interface CertificateSheetProps {
  serial: string
  verificationCode: string
  status: CertificateStatus
  snapshot: CertificateSnapshot
  /** The language of the printed text and names. */
  language: Language
  /** A translation function fixed to `language`. */
  t: Translate
  /** The zone of the printed days (the academy's, so the day matches the year of the serial); this device's when absent. */
  timeZone?: string
  /** This app's origin, for the verification link. */
  origin: string
}

export function CertificateSheet({ serial, verificationCode, status, snapshot, language, t, timeZone, origin }: CertificateSheetProps) {
  const academy = localizedLabel(snapshot.academy.name, language)
  const band = bandOf(snapshot.grade, language)
  return (
    <article className="certificate-sheet" dir={directionOf(language)} lang={language} aria-label={t('certificates.sheet.title')} data-testid="certificate-sheet">
      {status === 'revoked' ? (
        <div className="certificate-sheet__watermark" data-testid="certificate-revoked-mark">
          {t('certificates.sheet.revokedMark')}
        </div>
      ) : null}
      {academy ? <div className="certificate-sheet__academy">{academy}</div> : null}
      <h1 className="certificate-sheet__title">{t('certificates.sheet.title')}</h1>
      <p className="certificate-sheet__lead">{t('certificates.sheet.awards', { academy: academy || t('common.appName') })}</p>
      <p className="certificate-sheet__student">{printedStudentName(snapshot.student, language)}</p>
      <p className="certificate-sheet__lead">{t('certificates.sheet.completed')}</p>
      <p className="certificate-sheet__course">
        {localizedLabel(snapshot.course.name, language)} (<bdi dir="ltr">{snapshot.course.code}</bdi>)
      </p>
      <p className="certificate-sheet__lead">
        {t('certificates.sheet.inClass', { name: localizedLabel(snapshot.class.name, language) })} (<bdi dir="ltr">{snapshot.class.code}</bdi>)
      </p>
      <p className="certificate-sheet__grade">
        {t('certificates.sheet.grade', { band })} — <bdi dir="ltr">{formatPercent(snapshot.grade.percent)}</bdi>
      </p>
      <dl className="certificate-sheet__facts">
        {snapshot.completedAt ? (
          <div>
            <dt>{t('certificates.sheet.completedOn')}</dt>
            <dd>{formatCertificateDay(snapshot.completedAt, language, timeZone)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t('certificates.sheet.issuedOn')}</dt>
          <dd>{formatCertificateDay(snapshot.issuedAt, language, timeZone)}</dd>
        </div>
        <div>
          <dt>{t('certificates.sheet.serial')}</dt>
          <dd>
            <bdi dir="ltr">{serial}</bdi>
          </dd>
        </div>
      </dl>
      <div className="certificate-sheet__verify">
        <QRCodeSVG
          value={verificationUrl(verificationCode, origin)}
          size={96}
          level="M"
          marginSize={0}
          fgColor="#16305c"
          title={t('certificates.sheet.qrLabel')}
          className="certificate-sheet__qr"
          data-testid="certificate-qr"
        />
        <p>
          {t('certificates.sheet.verify')}
          <br />
          {t('certificates.sheet.code')} <bdi dir="ltr">{groupVerificationCode(verificationCode)}</bdi>
        </p>
      </div>
    </article>
  )
}
