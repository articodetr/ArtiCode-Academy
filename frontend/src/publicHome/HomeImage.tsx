// One of the four pictures of /home (`place` = its key in Settings → Homepage Images): an <img> with the attributes
// its band gives it (size, `alt=""`, `loading`, `decoding`, `fetchPriority`), whose source follows homeImageSrc() —
// the academy's own picture, the built-in default, or a transparent pixel that keeps the frame while API-205 loads.
// An academy picture that fails to load falls back to the default of its place, once: a failing default is left
// as it is (no loop), and a new source is tried afresh.
import { useState } from 'react'
import type { ImgHTMLAttributes } from 'react'
import { HOME_IMAGE_PLACEHOLDER, defaultHomeImageSrc } from './homeImages.view'
import { useHomeImageSrc } from './homeImagesContext'
import type { HomeImageKey } from './homeImageSlots'

export type HomeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'onError'> & { place: HomeImageKey }

export function HomeImage({ place, ...attributes }: HomeImageProps) {
  const src = useHomeImageSrc(place)
  const fallback = defaultHomeImageSrc(place)
  const [failed, setFailed] = useState(false)
  // Forget a failure as soon as the source changes (adjusted while rendering — no effect, no extra paint).
  const [seen, setSeen] = useState(src)
  if (seen !== src) {
    setSeen(src)
    setFailed(false)
  }
  const custom = src !== null && src !== fallback
  const shown = src === null ? HOME_IMAGE_PLACEHOLDER : custom && failed ? fallback : src

  return (
    <img
      {...attributes}
      src={shown}
      data-home-image={place}
      onError={() => {
        if (custom && !failed) setFailed(true)
      }}
    />
  )
}
