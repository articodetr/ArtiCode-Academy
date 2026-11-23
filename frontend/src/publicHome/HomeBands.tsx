// The presentation bands of the public home page, in the page's order: the
// feature strip under the welcome, the trust band, «about», the figures, the
// certificate, the promotional band and «why learn with us». Every sentence is
// true of the product as it works today (lessons by video, audio, text and files;
// a class with assignments, exams and grades; progress in «مدرستي»; a certificate
// anyone can verify; guardians; two-step sign-in). None claims an accreditation,
// a partner, a rating or a number of students, which the server does not hold.
// A band's button appears only where its viewer has somewhere to go
// (`programsPath` — homeProgramsPath()).
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  BellOutlined,
  BookOutlined,
  CheckCircleFilled,
  CheckOutlined,
  ClockCircleOutlined,
  EditOutlined,
  GlobalOutlined,
  LaptopOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  SafetyOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserSwitchOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import { Button, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useLocalized } from '../i18n/useLocalized'
import { HOME_IMAGES } from './homeImages'
import { formatHomeStat } from './publicHome.view'
import type { HomeStats } from './publicHome.view'

function ForwardIcon() {
  const { language } = useLocalized()
  return language === 'ar' ? <ArrowLeftOutlined /> : <ArrowRightOutlined />
}

const FEATURES: { key: 'online' | 'certificates' | 'teachers' | 'pace'; icon: ReactNode }[] = [
  { key: 'online', icon: <LaptopOutlined /> },
  { key: 'certificates', icon: <SafetyCertificateOutlined /> },
  { key: 'teachers', icon: <TeamOutlined /> },
  { key: 'pace', icon: <ClockCircleOutlined /> },
]

export function HomeFeatureStrip() {
  const { t } = useTranslation()
  return (
    <section className="public-home__strip-band" aria-label={t('publicHome.features.label')}>
      <div className="public-home__container">
        <ul className="public-home__strip">
          {FEATURES.map((item) => (
            <li key={item.key} className="public-home__strip-item">
              <span className="public-home__strip-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>
                <strong>{t(`publicHome.features.${item.key}.title`)}</strong>
                <span>{t(`publicHome.features.${item.key}.text`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const TRUST: { key: 'verify' | 'security' | 'guardians' | 'grades' | 'languages'; icon: ReactNode }[] = [
  { key: 'verify', icon: <SafetyCertificateOutlined /> },
  { key: 'security', icon: <SafetyOutlined /> },
  { key: 'guardians', icon: <UserSwitchOutlined /> },
  { key: 'grades', icon: <TrophyOutlined /> },
  { key: 'languages', icon: <GlobalOutlined /> },
]

export function HomeTrustBand() {
  const { t } = useTranslation()
  return (
    <section className="public-home__trust" aria-labelledby="public-home-trust">
      <div className="public-home__container public-home__trust-inner">
        <div className="public-home__trust-head">
          <Typography.Title level={2} id="public-home-trust" className="public-home__trust-title">
            {t('publicHome.trust.title')}
          </Typography.Title>
          <p>{t('publicHome.trust.text')}</p>
        </div>
        <ul className="public-home__trust-list">
          {TRUST.map((item) => (
            <li key={item.key}>
              <span aria-hidden="true">{item.icon}</span>
              {t(`publicHome.trust.items.${item.key}`)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const ABOUT_POINTS = ['media', 'structure', 'live', 'practice', 'progress', 'certificate'] as const

export function HomeAbout({ programsPath }: { programsPath: string | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <section id="about" className="public-home__section public-home__section--about" aria-labelledby="public-home-about">
      <div className="public-home__container public-home__split">
        <div>
          <span className="public-home__kicker">{t('publicHome.about.label')}</span>
          <Typography.Title level={2} id="public-home-about" className="public-home__section-title">
            {t('publicHome.about.title')}
          </Typography.Title>
          <p className="public-home__lead">{t('publicHome.about.text')}</p>
          <ul className="public-home__checks">
            {ABOUT_POINTS.map((key) => (
              <li key={key}>
                <CheckCircleFilled aria-hidden="true" />
                {t(`publicHome.about.points.${key}`)}
              </li>
            ))}
          </ul>
          {programsPath ? (
            <Button type="primary" size="large" className="public-home__pill-button" icon={<ForwardIcon />} iconPlacement="end" onClick={() => navigate(programsPath)}>
              {t('publicHome.about.action')}
            </Button>
          ) : null}
        </div>
        <div className="public-home__photo-frame">
          <img src={HOME_IMAGES.aboutLearners} alt="" width={960} height={680} loading="lazy" decoding="async" />
          <div className="public-home__photo-badge">
            <span aria-hidden="true">
              <TeamOutlined />
            </span>
            {t('publicHome.about.badge')}
          </div>
        </div>
      </div>
    </section>
  )
}

/** The figures of the published courses; zero figures are left out, and the whole band without any. */
export function HomeStatsBand({ stats }: { stats: HomeStats | null }) {
  const { t } = useTranslation()
  if (!stats) return null
  const items = [
    { key: 'programs', value: stats.programs },
    { key: 'lessons', value: stats.lessons },
    { key: 'hours', value: stats.hours },
    { key: 'openClasses', value: stats.openClasses },
  ] as const
  return (
    <section className="public-home__stats" aria-labelledby="public-home-stats" data-testid="home-stats">
      <div className="public-home__container">
        <Typography.Title level={2} id="public-home-stats" className="public-home__stats-title">
          {t('publicHome.stats.title')}
        </Typography.Title>
        <dl className="public-home__stats-grid">
          {items
            .filter((item) => item.value > 0)
            .map((item) => (
              <div key={item.key}>
                <dd>
                  <bdi dir="ltr">{formatHomeStat(item.value, stats.partial)}</bdi>
                </dd>
                <dt>{t(`publicHome.stats.${item.key}`)}</dt>
              </div>
            ))}
        </dl>
      </div>
    </section>
  )
}

const CERTIFICATE_POINTS = ['completion', 'serial', 'verify', 'print'] as const

export function HomeCertificate() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <section className="public-home__section public-home__section--certificate" aria-labelledby="public-home-certificate">
      <div className="public-home__container public-home__split">
        <div>
          <span className="public-home__kicker">{t('publicHome.certificate.label')}</span>
          <Typography.Title level={2} id="public-home-certificate" className="public-home__section-title">
            {t('publicHome.certificate.titleStart')} <span className="public-home__highlight">{t('publicHome.certificate.titleHighlight')}</span>
          </Typography.Title>
          <p className="public-home__lead">{t('publicHome.certificate.text')}</p>
          <ul className="public-home__checks">
            {CERTIFICATE_POINTS.map((key) => (
              <li key={key}>
                <CheckCircleFilled aria-hidden="true" />
                {t(`publicHome.certificate.points.${key}`)}
              </li>
            ))}
          </ul>
          <Button type="primary" size="large" className="public-home__pill-button" icon={<SafetyCertificateOutlined />} onClick={() => navigate('/verify')}>
            {t('publicHome.certificate.action')}
          </Button>
        </div>
        {/* A drawing of a certificate: no name, serial or grade — it can never pass for a real one. */}
        <div className="public-home__cert-stage" aria-hidden="true">
          <div className="public-home__cert">
            <span className="public-home__cert-ribbon">{t('publicHome.certificate.sample')}</span>
            <span className="public-home__cert-seal">
              <SafetyCertificateOutlined />
            </span>
            <strong>{t('publicHome.certificate.sampleTitle')}</strong>
            <i className="public-home__cert-line public-home__cert-line--name" />
            <i className="public-home__cert-line" />
            <i className="public-home__cert-line public-home__cert-line--short" />
            <span className="public-home__cert-foot">
              <i />
              <CheckOutlined />
              <i />
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

export function HomePromo({ programsPath }: { programsPath: string | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <section className="public-home__promo" aria-labelledby="public-home-promo">
      <div className="public-home__container public-home__promo-grid">
        <div>
          <Typography.Title level={2} id="public-home-promo" className="public-home__promo-title">
            {t('publicHome.promo.title')}
          </Typography.Title>
          <p>{t('publicHome.promo.text')}</p>
          {programsPath ? (
            <Button size="large" className="public-home__promo-button" icon={<ForwardIcon />} iconPlacement="end" onClick={() => navigate(programsPath)}>
              {t('publicHome.promo.action')}
            </Button>
          ) : null}
        </div>
        <div className="public-home__photo-frame public-home__photo-frame--promo">
          <img src={HOME_IMAGES.promoTraining} alt="" width={900} height={600} loading="lazy" decoding="async" />
          <div className="public-home__photo-badge">
            <span aria-hidden="true">
              <VideoCameraOutlined />
            </span>
            {t('publicHome.promo.badge')}
          </div>
        </div>
      </div>
    </section>
  )
}

const WHY: { key: 'structured' | 'media' | 'feedback' | 'exams' | 'alerts' | 'guardians'; icon: ReactNode; tone: number }[] = [
  { key: 'structured', icon: <ApartmentOutlined />, tone: 1 },
  { key: 'media', icon: <PlayCircleOutlined />, tone: 2 },
  { key: 'feedback', icon: <EditOutlined />, tone: 3 },
  { key: 'exams', icon: <BookOutlined />, tone: 4 },
  { key: 'alerts', icon: <BellOutlined />, tone: 5 },
  { key: 'guardians', icon: <UserSwitchOutlined />, tone: 6 },
]

export function HomeWhy() {
  const { t } = useTranslation()
  return (
    <section className="public-home__section public-home__section--why" aria-labelledby="public-home-why">
      <div className="public-home__container">
        <div className="public-home__section-head public-home__section-head--center">
          <span className="public-home__kicker">{t('publicHome.why.label')}</span>
          <Typography.Title level={2} id="public-home-why" className="public-home__section-title">
            {t('publicHome.why.title')}
          </Typography.Title>
        </div>
        <div className="public-home__why-grid">
          <ul className="public-home__why-list">
            {WHY.map((item) => (
              <li key={item.key}>
                <span className={`public-home__why-icon public-home__why-icon--${item.tone}`} aria-hidden="true">
                  {item.icon}
                </span>
                <span>
                  <strong>{t(`publicHome.why.items.${item.key}.title`)}</strong>
                  <span>{t(`publicHome.why.items.${item.key}.text`)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="public-home__why-photo">
            <img src={HOME_IMAGES.whyClassroom} alt="" width={800} height={760} loading="lazy" decoding="async" />
          </div>
        </div>
      </div>
    </section>
  )
}
