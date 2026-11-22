// Sets the browser tab title of a public page while it is shown — «page — academy» (pageTitle.ts) — and puts the
// previous title back when it goes. With `description`, it does the same for the page's
// `<meta name="description">` (PORTAL-04 PR-1: index.html carries the product's own line, which must not speak for an
// academy's public site); the tag is created when the document has none and removed again when it goes. Set from
// script, so a search engine that does not run JavaScript still reads index.html's line — no SEO is claimed here.
// Renders nothing; place it inside <PublicShell>.
import { useContext, useEffect } from 'react'
import { PublicAcademyNameContext, publicTitleOf } from './pageTitle'

export function PublicTitle({ page, description }: { page?: string; description?: string }) {
  const academy = useContext(PublicAcademyNameContext)
  const title = publicTitleOf(page, academy)
  const summary = description?.trim() ?? ''

  useEffect(() => {
    if (title === null) return
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])

  useEffect(() => {
    if (!summary) return
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]')
    const created = meta === null
    if (meta === null) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    const previous = meta.content
    meta.content = summary
    return () => {
      if (created) meta.remove()
      else meta.content = previous
    }
  }, [summary])

  return null
}
