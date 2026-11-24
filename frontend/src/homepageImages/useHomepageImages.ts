// The homepage images of the settings tab (GET /api/academy/homepage-images), on the
// pattern of grades/useGradeSchemes.ts: loading is derived from the request key and a
// failure keeps the last answer behind the error. Every write answers the whole list,
// which `replace()` shows as the server sent it — nothing is computed here.
import { useCallback, useEffect, useState } from 'react'
import { getHomepageImages } from '../api/homepageImages'
import type { HomepageImages } from '../api/homepageImages'

export interface HomepageImagesState {
  images: HomepageImages | null
  loading: boolean
  /** The last load failure, or null. */
  error: unknown
  reload: () => void
  /** Shows the list a write answered. */
  replace: (images: HomepageImages) => void
}

export function useHomepageImages(): HomepageImagesState {
  const [images, setImages] = useState<HomepageImages | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [settledKey, setSettledKey] = useState(-1)

  useEffect(() => {
    const controller = new AbortController()
    getHomepageImages(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setImages(result)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught)
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettledKey(requestKey)
      })
    return () => controller.abort()
  }, [requestKey])

  const reload = useCallback(() => setRequestKey((key) => key + 1), [])
  const replace = useCallback((next: HomepageImages) => {
    setImages(next)
    setError(null)
  }, [])

  return { images, loading: settledKey !== requestKey, error, reload, replace }
}
