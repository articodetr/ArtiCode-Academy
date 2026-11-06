// The academy's scheduling settings for the weekly schedule screens (J-F07):
// one GET /api/academy (API-035, every signed-in user) per mount, read through
// schedulingSettingsOf(). A failed read means no restriction — the server
// still refuses a slot outside the working days (D-R28).
import { useEffect, useState } from 'react'
import { getAcademy } from '../api/academy'
import { NO_SCHEDULING_SETTINGS, schedulingSettingsOf } from './schedule.settings'
import type { SchedulingSettingsView } from './schedule.settings'

export function useSchedulingSettings(): { settings: SchedulingSettingsView; loaded: boolean } {
  const [settings, setSettings] = useState<SchedulingSettingsView | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getAcademy(controller.signal)
      .then((academy) => {
        if (!controller.signal.aborted) setSettings(schedulingSettingsOf(academy))
      })
      .catch(() => {
        if (!controller.signal.aborted) setSettings({ ...NO_SCHEDULING_SETTINGS })
      })
    return () => controller.abort()
  }, [])

  return { settings: settings ?? NO_SCHEDULING_SETTINGS, loaded: settings !== null }
}
