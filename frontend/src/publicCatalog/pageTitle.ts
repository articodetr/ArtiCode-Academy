// The browser tab title of the public pages (PORTAL-04): «page — academy». The shell shares the academy's own name
// (API-205; empty while unknown or after a failed read — never the product name) through this context, and a page
// names itself with <PublicTitle>. Pure composition rule: publicTitleOf().
import { createContext } from 'react'

export const PublicAcademyNameContext = createContext('')

/** «page — academy», the academy alone, the page alone, or null (leave the document's title as it is). */
export function publicTitleOf(page: string | undefined, academy: string): string | null {
  const parts = [page?.trim() ?? '', academy.trim()].filter((part) => part.length > 0)
  return parts.length > 0 ? parts.join(' — ') : null
}
