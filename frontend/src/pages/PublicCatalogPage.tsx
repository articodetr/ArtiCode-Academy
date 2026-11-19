// The public course catalog for visitors (MOD-20, D-R138): /explore, outside
// the app layout and without a sign-in. GET /api/public/catalog/courses
// (API-236 — no token, 60/min per IP) gives the published courses only; the
// academy decides whether visitors may browse (`settings.catalog.publicBrowsing`)
// and while it does not the server answers `404 catalog_not_public`, which shows
// a calm page with the way to sign in. A search box (sent ~300 ms after the
// last keystroke), a card grid and «المزيد» for the next page. A signed-in user
// goes to the signed-in catalog (/catalog) instead.
import { Alert, Button, Card, Col, Empty, Flex, Input, Row, Skeleton, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { isCatalogNotPublic } from '../api/publicCatalog'
import { CatalogClosed } from '../publicCatalog/CatalogClosed'
import { PublicCourseCard } from '../publicCatalog/PublicCourseCard'
import { PUBLIC_SEARCH_DELAY_MS, PUBLIC_SEARCH_MAX_LENGTH, publicFailureKey } from '../publicCatalog/publicCatalog.view'
import { PublicOnly, PublicShell } from '../publicCatalog/PublicShell'
import { usePublicCatalogList } from '../publicCatalog/usePublicCatalogList'

const SKELETON_CARDS = 4

export function PublicCatalogPage() {
  return (
    <PublicOnly signedInTo="/catalog">
      <PublicShell>
        <PublicCatalogList />
      </PublicShell>
    </PublicOnly>
  )
}

function PublicCatalogList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const list = usePublicCatalogList()
  const { query, setQuery } = list
  const [search, setSearch] = useState('')

  // The search box asks the server once the typing pauses.
  useEffect(() => {
    const q = search.trim()
    if (q === query) return
    const timer = window.setTimeout(() => setQuery(q), PUBLIC_SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [search, query, setQuery])

  if (list.error && isCatalogNotPublic(list.error)) return <CatalogClosed />

  const open = (courseId: string) => navigate(`/explore/${encodeURIComponent(courseId)}`)
  const firstLoad = list.loading && list.items.length === 0 && !list.error
  const pageError = list.error && !list.failedMore ? list.error : null
  const clearSearch = () => {
    setSearch('')
    setQuery('')
  }

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={2} style={{ marginBottom: 4 }}>
          {t('publicCatalog.list.title')}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {t('publicCatalog.list.subtitle')}
        </Typography.Paragraph>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          value={search}
          maxLength={PUBLIC_SEARCH_MAX_LENGTH}
          placeholder={t('publicCatalog.list.searchPlaceholder')}
          aria-label={t('publicCatalog.list.searchLabel')}
          onChange={(event) => setSearch(event.target.value)}
          onSearch={(value) => {
            setSearch(value)
            setQuery(value)
          }}
          style={{ maxWidth: 480 }}
        />
      </Card>

      {pageError ? (
        <Alert
          type="error"
          showIcon
          title={t('publicCatalog.list.loadError')}
          description={t(publicFailureKey(pageError))}
          action={
            <Button size="small" onClick={list.retry}>
              {t('publicCatalog.list.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {firstLoad ? (
        <Row gutter={[16, 16]}>
          {Array.from({ length: SKELETON_CARDS }, (_, index) => (
            <Col key={index} xs={24} sm={12} lg={8} xl={6}>
              <Card>
                <Skeleton active />
              </Card>
            </Col>
          ))}
        </Row>
      ) : list.items.length === 0 && !list.loading && !pageError ? (
        <Card>
          <Empty description={query ? t('publicCatalog.list.emptyFiltered') : t('publicCatalog.list.empty')}>
            {query ? <Button onClick={clearSearch}>{t('publicCatalog.list.clearSearch')}</Button> : null}
          </Empty>
        </Card>
      ) : (
        <Row gutter={[16, 16]} aria-busy={list.loading}>
          {list.items.map((card) => (
            <Col key={card.id} xs={24} sm={12} lg={8} xl={6}>
              <PublicCourseCard card={card} onOpen={open} />
            </Col>
          ))}
        </Row>
      )}

      {list.failedMore ? (
        <Alert
          type="error"
          showIcon
          title={t('publicCatalog.list.moreError')}
          description={t(publicFailureKey(list.error))}
          action={
            <Button size="small" onClick={list.retry}>
              {t('publicCatalog.list.retry')}
            </Button>
          }
          style={{ marginTop: 16 }}
        />
      ) : list.nextCursor ? (
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Button onClick={list.more} loading={list.loading} disabled={list.loading}>
            {t('publicCatalog.list.more')}
          </Button>
        </Flex>
      ) : null}
    </>
  )
}
