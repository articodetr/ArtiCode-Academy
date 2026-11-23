// «كيف تبدأ الدراسة؟» on the public home page: the three steps as the product
// works today — choose a program, sign in with the account the academy gives
// (no self-registration exists yet — PR-3), enroll in a class (at once for a free
// program, after payment and the academy's approval for a paid one — MOD-19) and
// follow the lessons in «مدرستي». No figure, testimonial or name is shown.
// An ordered list of three cards, the middle one in the page's colour; one under
// the other on a phone.
import { CompassOutlined, LoginOutlined, ReadOutlined } from '@ant-design/icons'
import { Typography } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const STEPS: { key: 'choose' | 'signIn' | 'learn'; icon: ReactNode }[] = [
  { key: 'choose', icon: <CompassOutlined /> },
  { key: 'signIn', icon: <LoginOutlined /> },
  { key: 'learn', icon: <ReadOutlined /> },
]

export function HomeSteps() {
  const { t } = useTranslation()
  return (
    <section className="public-home__section public-home__section--soft" aria-labelledby="public-home-steps">
      <div className="public-home__container">
        <div className="public-home__section-head public-home__section-head--center">
          <span className="public-home__kicker">{t('publicHome.steps.label')}</span>
          <Typography.Title level={2} id="public-home-steps" className="public-home__section-title">
            {t('publicHome.steps.title')}
          </Typography.Title>
          <p className="public-home__section-subtitle">{t('publicHome.steps.subtitle')}</p>
        </div>
        <ol className="public-home__steps">
          {STEPS.map((step, index) => (
            <li key={step.key} className="public-home__step">
              <span className="public-home__step-badge" aria-hidden="true">
                <span className="public-home__step-icon">{step.icon}</span>
                <span className="public-home__step-number">{index + 1}</span>
              </span>
              <div className="public-home__step-body">
                <Typography.Title level={3} className="public-home__step-title">
                  {t(`publicHome.steps.${step.key}.title`)}
                </Typography.Title>
                <p className="public-home__step-text">{t(`publicHome.steps.${step.key}.text`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
