// What a visitor sees while the academy keeps its catalog for signed-in users
// (API-236/237 `404 catalog_not_public` — D-R138): a calm page, no error
// colours, and the way to sign in. `registrationOpen` (API-205, read by the page
// that mounts this panel — since PORTAL-04 `selfRegistration` or `googleSignUp`,
// accountCreationOpen()): the academy lets a visitor create an account, so the
// panel says so and links to it; otherwise it only invites the sign-in.
import { LoginOutlined } from '@ant-design/icons'
import { Button, Card, Result } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'

export function CatalogClosed({ registrationOpen = false }: { registrationOpen?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <Card data-testid="catalog-closed">
      <Result
        status="info"
        title={t('publicCatalog.closed.title')}
        subTitle={t(registrationOpen ? 'studentRegistration.entry.accountsNote' : 'publicCatalog.closed.text')}
        extra={
          <>
            <Button type="primary" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
              {t('publicCatalog.closed.signIn')}
            </Button>
            {registrationOpen ? (
              <Link to="/register" className="public-register-link">
                {t('studentRegistration.entry.createAccount')}
              </Link>
            ) : null}
          </>
        }
      />
    </Card>
  )
}
