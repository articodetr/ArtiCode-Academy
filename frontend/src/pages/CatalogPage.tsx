// «Explore courses» (MOD-19, roadmap §4p): GET /api/catalog/courses (API-219)
// for the learners — the published courses only, whatever the reader's other
// keys (D-R129). A search box (sent ~300 ms after the last keystroke), the
// course type (free / paid), the level and «open for enrollment now» filters,
// a responsive card grid and keyset pages. Every number is the server's; a
// card leads to the course page (/catalog/:courseId), where a class is chosen
// and the enrollment is made. The route opens to the `student`/`guardian`
// server role keys (nav entry `catalog`).
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Empty, Flex, Input, Row, Select, Skeleton, Space, Switch, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { CoursePricing } from '../api/courses'
import { catalogFailureKey } from '../catalog/catalog.errors'
import { CATALOG_SEARCH_DELAY_MS, CATALOG_SEARCH_MAX_LENGTH, isCatalogNarrowed } from '../catalog/catalog.view'
import { CourseCard } from '../catalog/CourseCard'
import { useCatalogList } from '../catalog/useCatalogList'
import { PageHeader } from '../components/PageHeader'
import { useLevels } from '../courses/useLevels'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'

const SKELETON_CARDS = 4

export function CatalogPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const list = useCatalogList()
  const { filters, setFilters } = list
  const { levels } = useLevels()
  const [search, setSearch] = useState(filters.q ?? '')

  // The search box asks the server once the typing pauses.
  useEffect(() => {
    const q = search.trim()
    if (q === (filters.q ?? '')) return
    const timer = window.setTimeout(() => setFilters({ q: q || undefined }), CATALOG_SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [search, filters.q, setFilters])

  const narrowed = isCatalogNarrowed(filters)
  const clearFilters = () => {
    setSearch('')
    setFilters({ q: undefined, pricing: undefined, levelId: undefined, available: undefined })
  }
  const open = (courseId: string) => navigate(`/catalog/${courseId}`)
  const firstLoad = list.loading && list.items.length === 0 && !list.error

  return (
    <>
      <PageHeader title={t('catalog.title')} subtitle={t('catalog.subtitle')} />

      <Card style={{ marginBottom: 16 }}>
        <Flex gap={12} wrap align="center">
          <Input.Search
            allowClear
            value={search}
            maxLength={CATALOG_SEARCH_MAX_LENGTH}
            placeholder={t('catalog.searchPlaceholder')}
            aria-label={t('catalog.searchLabel')}
            onChange={(event) => setSearch(event.target.value)}
            onSearch={(value) => {
              setSearch(value)
              setFilters({ q: value.trim() || undefined })
            }}
            style={{ flex: '1 1 240px', minWidth: 0, maxWidth: 420 }}
          />
          <Select<CoursePricing | 'all'>
            aria-label={t('catalog.pricingLabel')}
            value={filters.pricing ?? 'all'}
            onChange={(value) => setFilters({ pricing: value === 'all' ? undefined : value })}
            options={[
              { value: 'all', label: t('catalog.pricingAll') },
              { value: 'free', label: t('catalog.free') },
              { value: 'paid', label: t('catalog.paid') },
            ]}
            style={{ minWidth: 150 }}
          />
          <Select<string | undefined>
            allowClear
            aria-label={t('catalog.levelLabel')}
            placeholder={t('catalog.levelAll')}
            value={filters.levelId}
            onChange={(value) => setFilters({ levelId: value || undefined })}
            options={levels.filter((level) => level.isActive).map((level) => ({ value: level.id, label: localizedLabel(level.name, language) }))}
            style={{ minWidth: 160 }}
          />
          <Space size={6}>
            <Switch
              aria-label={t('catalog.availableOnly')}
              checked={filters.available === true}
              onChange={(checked) => setFilters({ available: checked ? true : undefined })}
            />
            <Typography.Text>{t('catalog.availableOnly')}</Typography.Text>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('catalog.refresh')} />
        </Flex>
      </Card>

      {list.error ? (
        <Alert
          type="error"
          showIcon
          title={t('catalog.loadError')}
          description={t(catalogFailureKey(list.error))}
          action={
            <Button size="small" onClick={list.reload}>
              {t('catalog.retry')}
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
      ) : list.items.length === 0 && !list.error && !list.loading ? (
        <Card>
          <Empty description={narrowed ? t('catalog.emptyFiltered') : t('catalog.empty')}>
            {narrowed ? <Button onClick={clearFilters}>{t('catalog.clearFilters')}</Button> : null}
          </Empty>
        </Card>
      ) : (
        <Row gutter={[16, 16]} aria-busy={list.loading}>
          {list.items.map((card) => (
            <Col key={card.id} xs={24} sm={12} lg={8} xl={6}>
              <CourseCard card={card} onOpen={open} />
            </Col>
          ))}
        </Row>
      )}

      {list.canGoBack || list.nextCursor ? (
        <Flex justify="center" align="center" gap={12} style={{ marginTop: 16 }}>
          <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
            {t('catalog.previous')}
          </Button>
          <Typography.Text type="secondary">{t('catalog.page', { page: list.pageNumber })}</Typography.Text>
          <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
            {t('catalog.next')}
          </Button>
        </Flex>
      ) : null}
    </>
  )
}
