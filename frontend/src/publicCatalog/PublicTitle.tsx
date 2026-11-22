// Sets the browser tab title of a public page while it is shown — «page — academy» (pageTitle.ts) — and puts the
// previous title back when it goes. Renders nothing; place it inside <PublicShell>.
import { useContext, useEffect } from 'react'
import { PublicAcademyNameContext, publicTitleOf } from './pageTitle'

export function PublicTitle({ page }: { page?: string }) {
  const academy = useContext(PublicAcademyNameContext)
  const title = publicTitleOf(page, academy)

  useEffect(() => {
    if (title === null) return
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])

  return null
}
