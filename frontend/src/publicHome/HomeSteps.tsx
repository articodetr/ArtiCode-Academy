// «كيف تبدأ الدراسة؟» on the public home page: the three steps as the product
// works today — choose a program, sign in with the account the academy gives
// (no self-registration exists yet), enroll in a class (at once for a free
// program, after payment and the academy's approval for a paid one — MOD-19) and
// follow the lessons in «مدرستي». No figure, testimonial or name is shown.
import { CompassOutlined, LoginOutlined, ReadOutlined } from '@ant-design/icons'
import { Card, Col, Row, Typography } from 'antd'
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
    <section className="public-home__section" aria-labelledby="public-home-steps">
      <Typography.Title level={2} id="public-home-steps" className="public-home__section-title">
        {t('publicHome.steps.title')}
      </Typography.Title>
      <Row gutter={[16, 16]} className="public-home__steps">
        {STEPS.map((step, index) => (
          <Col key={step.key} xs={24} md={8}>
            <Card className="public-home__step">
              <div className="public-home__step-head">
                <span className="public-home__step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="public-home__step-icon" aria-hidden="true">
                  {step.icon}
                </span>
              </div>
              <Typography.Title level={3} className="public-home__step-title">
                {t(`publicHome.steps.${step.key}.title`)}
              </Typography.Title>
              <Typography.Paragraph type="secondary" className="public-home__step-text">
                {t(`publicHome.steps.${step.key}.text`)}
              </Typography.Paragraph>
            </Card>
          </Col>
        ))}
      </Row>
    </section>
  )
}
