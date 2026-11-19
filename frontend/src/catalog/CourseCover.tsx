// The cover image of a course (MOD-19): decorative (`alt=""` — the title next
// to it names the course), loaded only from an address coverSrc() accepts and
// hidden for good when it fails to load. Mount it with `key={src}` so a new
// address gets a fresh try.
import { useState } from 'react'
import { coverSrc } from './catalog.view'

export function CourseCover({ url, height = 160 }: { url: string | null; height?: number }) {
  const [broken, setBroken] = useState(false)
  const src = coverSrc(url)
  if (!src || broken) return null
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      data-testid="course-cover"
      style={{ display: 'block', width: '100%', height, objectFit: 'cover' }}
    />
  )
}
