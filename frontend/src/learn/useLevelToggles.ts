// Which levels of the curriculum sidebar are expanded. The level holding the
// current lesson opens by itself whenever the learner arrives at a lesson of
// it; the others keep the state the learner gave them for the browser session
// only (sessionStorage — a convenience of the screen, never progress, which is
// the server's alone — D-R133). Storage may be unavailable (private mode,
// blocked site data): the screen then works without remembering.
import { useCallback, useEffect, useState } from 'react'

const STORAGE_PREFIX = 'aca.learn.levels.'

function readToggles(storageKey: string): Record<string, boolean> {
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
  } catch {
    return {}
  }
}

function writeToggles(storageKey: string, toggles: Record<string, boolean>) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(toggles))
  } catch {
    // Remembering is a convenience only.
  }
}

export interface LevelToggles {
  isOpen: (key: string) => boolean
  toggle: (key: string) => void
}

/** `currentKey` = the key (learn.state sectionKeyOf) of the level holding the current lesson, or null. */
export function useLevelToggles(courseId: string, currentKey: string | null): LevelToggles {
  const storageKey = `${STORAGE_PREFIX}${courseId}`
  const [toggles, setToggles] = useState<Record<string, boolean>>(() => readToggles(storageKey))
  const [seenKey, setSeenKey] = useState<string | null>(null)

  // Arriving at a lesson of a collapsed level opens it (adjusted during render, not in an effect).
  if (currentKey !== seenKey) {
    setSeenKey(currentKey)
    if (currentKey !== null && toggles[currentKey] === false) setToggles({ ...toggles, [currentKey]: true })
  }

  useEffect(() => {
    writeToggles(storageKey, toggles)
  }, [storageKey, toggles])

  const isOpen = useCallback((key: string) => toggles[key] ?? key === currentKey, [toggles, currentKey])
  const toggle = useCallback(
    (key: string) => setToggles((previous) => ({ ...previous, [key]: !(previous[key] ?? key === currentKey) })),
    [currentKey],
  )
  return { isOpen, toggle }
}
