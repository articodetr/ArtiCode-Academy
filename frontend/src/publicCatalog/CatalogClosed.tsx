// What a visitor sees while the academy keeps its catalog for signed-in users
// (API-236/237 `404 catalog_not_public` — D-R138): a calm page, no error
// colours, and the way to sign in.
import { LoginOutlined } from '@ant-design/icons'
import { Button, Card, Result } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export function CatalogClosed() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <Card data-testid="catalog-closed">
      <Result
        status="info"
        title={t('publicCatalog.closed.title')}
        subTitle={t('publicCatalog.closed.text')}
        extra={
          <Button type="primary" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
            {t('publicCatalog.closed.signIn')}
          </Button>
        }
      />
    </Card>
  )
}
