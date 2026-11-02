// The level list for the courses screen's filter and picker (API-037), read
// once per mount. A failure leaves the list empty: the screen still works
// without the level filter, and the server validates any level id anyway.
import { useEffect, useState } from 'react'
import { listLevels } from '../api/levels'
import type { Level } from '../api/levels'

export function useLevels(): { levels: Level[]; loading: boolean } {
  const [levels, setLevels] = useState<Level[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    listLevels(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setLevels(result.items)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  return { levels, loading }
}
