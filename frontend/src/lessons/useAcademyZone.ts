// The academy's zone for the lessons screens (D-R41 — J-F28): the zone of
// «today», of the day filters and of the times typed for a new lesson, from the
// shared API-035 reading (academy/useAcademy — the header already holds it, so
// no request of its own), or this device's when the academy could not be read.
// `settled` turns true once the reading answered either way: the lists wait for
// it, so their first request already carries the academy's days.
import { useMemo } from 'react'
import { useAcademy } from '../academy/useAcademy'
import { academyZoneOf } from './lessons.format'
import type { LessonZone } from './lessons.format'

export function useAcademyZone(): LessonZone & { settled: boolean } {
  const { academy, error } = useAcademy()
  return useMemo(() => ({ ...academyZoneOf(academy), settled: academy !== null || error !== null }), [academy, error])
}
