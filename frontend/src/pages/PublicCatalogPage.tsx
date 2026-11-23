// The public course catalog for visitors (MOD-20, D-R138): /explore, outside
// the app layout and without a sign-in. GET /api/public/catalog/courses
// (API-236 — no token, 60/min per IP) gives the published courses only; the
// academy decides whether visitors may browse (`settings.catalog.publicBrowsing`)
// and while it does not the server answers `404 catalog_not_public`, which shows
// a calm panel with the way to sign in. A signed-in user goes to the signed-in
// catalog (/catalog) instead.
//
// The look (PORTAL-04 PR-2, in the identity approved for /home): a full-width
// head band — breadcrumb, «استكشف البرامج التعليمية», a line about the page and
// a large search box (sent ~300 ms after the last keystroke, or at once on
// Enter) — then the results: what is listed (all, or the results of a search),
// how many once the list is complete, the same course cards as /home in a
// responsive grid, «عرض المزيد» for the next page, and each state as a designed
// panel (loading cards, failure with a retry, nothing published, nothing found
// with a way to clear the search, closed). The search lives in the address
// (`?q=`), so a refresh, a shared link and the browser's back button from a
// course page keep it; each card's link carries it on to the course page
// (`/explore/:id?q=`), whose «العودة إلى الدورات» leads back to the same
// results. Only the server's filter exists — the search — so no
// other filter is offered (a category or price filter needs API-236 to support
// it first — #205).
import { DisconnectOutlined, InboxOutlined, LockOutlined, LoginOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Breadcrumb, Button, Col, Input, Row, Skeleton, Typography } from 'antd'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { isCatalogNotPublic } from '../api/publicCatalog'
import { PublicCourseCard } from '../publicCatalog/PublicCourseCard'
import { PUBLIC_SEARCH_DELAY_MS, PUBLIC_SEARCH_MAX_LENGTH, exploreSearchOf, publicCoursePathFor, publicFailureKey } from '../publicCatalog/publicCatalog.view'
import { PublicOnly, PublicShell } from '../publicCatalog/PublicShell'
import { PublicTitle } from '../publicCatalog/PublicTitle'
import { PublicAcademyNameContext } from '../publicCatalog/pageTitle'
import { usePublicCatalogList } from '../publicCatalog/usePublicCatalogList'
import { HomeNotice } from '../publicHome/HomeNotice'
// The state panels (HomeNotice) are styled there; the page's own look is in publicExplore.css.
import '../publicHome/publicHome.css'
import '../publicCatalog/publicExplore.css'

const SKELETON_CARDS = 6

export function PublicCatalogPage() {
  return (
    <PublicOnly signedInTo="/catalog">
      <PublicShell bleed>
        <PublicCatalogList />
      </PublicShell>
    </PublicOnly>
  )
}

function PublicCatalogList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const academy = useContext(PublicAcademyNameContext)
  // The address is the one place the search lives: the list asks the server for what it names, and the box holds only
  // what is being typed. Typing writes the address once it pauses (replace: no trail of history entries), Enter at once.
  const [params, setParams] = useSearchParams()
  const query = exploreSearchOf(params)
  const list = usePublicCatalogList(query)
  const [search, setSearch] = useState(query)
  // The search this page last wrote: its echo, arriving a moment later (the router updates in a transition), is not
  // a change made elsewhere and must not overwrite what is being typed meanwhile.
  const written = useRef<string | null>(null)

  const applySearch = useCallback(
    (value: string) => {
      const q = value.trim().slice(0, PUBLIC_SEARCH_MAX_LENGTH)
      written.current = q
      setParams(q ? { q } : {}, { replace: true })
    },
    [setParams],
  )

  // The address moved elsewhere — a link («البرامج» in the header), the browser's back or forward — so the box shows it.
  useEffect(() => {
    if (written.current === query) {
      written.current = null
      return
    }
    written.current = null
    setSearch(query)
  }, [query])

  // The search box asks the server once the typing pauses.
  useEffect(() => {
    const q = search.trim()
    if (q === query) return
    const timer = window.setTimeout(() => applySearch(q), PUBLIC_SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [search, query, applySearch])

  const closed = Boolean(list.error && isCatalogNotPublic(list.error))
  // A card opened from a search carries it to the course page (`/explore/:id?q=`), whose «العودة إلى الدورات» returns here.
  const pathOf = (courseId: string) => publicCoursePathFor(courseId, query)
  const firstLoad = list.loading && list.items.length === 0 && !list.error
  const pageError = list.error && !list.failedMore && !closed ? list.error : null
  const complete = !list.loading && !list.error && list.nextCursor === null
  const clearSearch = () => {
    setSearch('')
    applySearch('')
  }

  return (
    <div className="public-explore">
      <PublicTitle
        page={t('publicCatalog.list.tabTitle')}
        description={academy ? t('publicCatalog.list.metaDescriptionNamed', { name: academy }) : t('publicCatalog.list.metaDescription')}
      />

      <section className="public-explore__head" aria-labelledby="public-explore-title">
        <div className="public-explore__container public-explore__head-inner">
          <Breadcrumb
            className="public-explore__breadcrumb"
            aria-label={t('publicCatalog.list.breadcrumbLabel')}
            items={[{ title: <Link to="/home">{t('publicCatalog.header.homeLink')}</Link> }, { title: <span aria-current="page">{t('publicCatalog.header.programsLink')}</span> }]}
          />
          <Typography.Title level={1} id="public-explore-title" className="public-explore__title">
            {t('publicCatalog.list.title')}
          </Typography.Title>
          {/* «تصفّح البرامج المنشورة…» would contradict a closed catalog: the panel below says what to do instead. */}
          {closed ? null : <p className="public-explore__subtitle">{t('publicCatalog.list.subtitle')}</p>}
          {closed ? null : (
            <form
              role="search"
              className="public-explore__search"
              onSubmit={(event) => {
                event.preventDefault()
                applySearch(search)
              }}
            >
              <Input
                size="large"
                allowClear
                value={search}
                maxLength={PUBLIC_SEARCH_MAX_LENGTH}
                prefix={<SearchOutlined aria-hidden="true" className="public-explore__search-icon" />}
                placeholder={t('publicCatalog.list.searchPlaceholder')}
                aria-label={t('publicCatalog.list.searchLabel')}
                onChange={(event) => setSearch(event.target.value)}
              />
            </form>
          )}
        </div>
      </section>

      <section className="public-explore__results" aria-label={query ? t('publicCatalog.list.resultsFor', { q: query }) : t('publicCatalog.list.allResults')}>
        <div className="public-explore__container">
          {closed ? (
            <HomeNotice
              testId="catalog-closed"
              tone="info"
              icon={<LockOutlined />}
              title={t('publicCatalog.closed.title')}
              text={t('publicCatalog.closed.text')}
              action={
                <Button type="primary" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
                  {t('publicCatalog.closed.signIn')}
                </Button>
              }
            />
          ) : (
            <>
              <div className="public-explore__toolbar">
                <span className="public-explore__toolbar-label">
                  {query ? <bdi>{t('publicCatalog.list.resultsFor', { q: query })}</bdi> : t('publicCatalog.list.allResults')}
                </span>
                <span className="public-explore__toolbar-end">
                  {complete && list.items.length > 0 ? <span className="public-explore__count">{t('publicCatalog.list.count', { count: list.items.length })}</span> : null}
                  {query ? (
                    <Button type="link" size="small" onClick={clearSearch} className="public-explore__clear">
                      {t('publicCatalog.list.clearSearch')}
                    </Button>
                  ) : null}
                </span>
              </div>

              {pageError ? (
                <HomeNotice
                  tone="error"
                  icon={<DisconnectOutlined />}
                  title={t('publicCatalog.list.loadError')}
                  text={t(publicFailureKey(pageError))}
                  action={
                    <Button icon={<ReloadOutlined />} onClick={list.retry}>
                      {t('publicCatalog.list.retry')}
                    </Button>
                  }
                />
              ) : firstLoad ? (
                <Row gutter={[24, 24]} aria-busy="true">
                  {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                    <Col key={index} xs={24} sm={12} lg={8}>
                      <div className="public-card public-card--skeleton">
                        <div className="public-card__media public-explore__skeleton-media" />
                        <div className="public-card__body">
                          <Skeleton active title={{ width: '70%' }} paragraph={{ rows: 2 }} />
                        </div>
                      </div>
                    </Col>
                  ))}
                </Row>
              ) : list.items.length === 0 && !list.loading ? (
                query ? (
                  <HomeNotice
                    tone="neutral"
                    icon={<SearchOutlined />}
                    title={t('publicCatalog.list.emptyFilteredTitle')}
                    text={t('publicCatalog.list.emptyFiltered')}
                    action={<Button onClick={clearSearch}>{t('publicCatalog.list.clearSearch')}</Button>}
                  />
                ) : (
                  <HomeNotice tone="neutral" icon={<InboxOutlined />} title={t('publicCatalog.list.emptyTitle')} text={t('publicCatalog.list.empty')} />
                )
              ) : (
                <Row gutter={[24, 24]} aria-busy={list.loading} className={list.loading ? 'public-explore__grid is-busy' : 'public-explore__grid'}>
                  {list.items.map((card) => (
                    <Col key={card.id} xs={24} sm={12} lg={8}>
                      <PublicCourseCard card={card} href={pathOf(card.id)} headingLevel={2} />
                    </Col>
                  ))}
                </Row>
              )}

              {list.failedMore ? (
                <div className="public-explore__more-error">
                  <HomeNotice
                    tone="error"
                    icon={<DisconnectOutlined />}
                    title={t('publicCatalog.list.moreError')}
                    text={t(publicFailureKey(list.error))}
                    action={
                      <Button icon={<ReloadOutlined />} onClick={list.retry}>
                        {t('publicCatalog.list.retry')}
                      </Button>
                    }
                  />
                </div>
              ) : list.nextCursor && !pageError ? (
                <div className="public-explore__more">
                  <Button size="large" onClick={list.more} loading={list.loading} disabled={list.loading}>
                    {t('publicCatalog.list.more')}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
