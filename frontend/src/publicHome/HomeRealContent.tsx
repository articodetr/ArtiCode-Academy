// Two sections of the page's design that wait for real content: students' words
// and articles. The server holds neither, and the page never makes them up, so
// each renders nothing until it is handed real items (a future API or a reviewed
// content source) — no heading, no empty frame.
import { Typography } from 'antd'
import { useTranslation } from 'react-i18next'

export interface HomeTestimonial {
  id: string
  name: string
  quote: string
  photoUrl?: string
}

export interface HomeArticle {
  id: string
  href: string
  title: string
  summary: string
  category?: string
  date?: string
  imageUrl?: string
}

export function HomeTestimonials({ items }: { items: readonly HomeTestimonial[] }) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  return (
    <section className="public-home__section public-home__section--soft" aria-labelledby="public-home-testimonials" data-testid="home-testimonials">
      <div className="public-home__container">
        <div className="public-home__section-head public-home__section-head--center">
          <Typography.Title level={2} id="public-home-testimonials" className="public-home__section-title">
            {t('publicHome.testimonials.title')}
          </Typography.Title>
        </div>
        <ul className="public-home__cards">
          {items.map((item) => (
            <li key={item.id} className="public-home__quote">
              <blockquote>{item.quote}</blockquote>
              <span className="public-home__quote-person">
                {item.photoUrl ? <img src={item.photoUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
                <bdi dir="auto">{item.name}</bdi>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function HomeArticles({ items }: { items: readonly HomeArticle[] }) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  return (
    <section className="public-home__section" aria-labelledby="public-home-articles" data-testid="home-articles">
      <div className="public-home__container">
        <div className="public-home__section-head public-home__section-head--center">
          <Typography.Title level={2} id="public-home-articles" className="public-home__section-title">
            {t('publicHome.articles.title')}
          </Typography.Title>
        </div>
        <ul className="public-home__cards">
          {items.map((item) => (
            <li key={item.id} className="public-home__article">
              {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
              <div>
                {item.category ? <span className="public-home__kicker">{item.category}</span> : null}
                <Typography.Title level={3}>{item.title}</Typography.Title>
                {item.date ? <time dateTime={item.date}>{item.date}</time> : null}
                <p>{item.summary}</p>
                <a href={item.href}>{t('publicHome.articles.readMore')}</a>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
