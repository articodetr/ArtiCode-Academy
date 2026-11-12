import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { FAR_TIME_ZONE } from '../test/lessons'
import { renderWithProviders } from '../test/render'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { LessonZoneNote } from './LessonZone'

const rowsSentence = () => ar.lessons.zone.rows.replace('{{zone}}', deviceTimeZone())
const daysSentence = (zone: string) => ar.lessons.zone.days.replace('{{zone}}', zone)

describe('LessonZoneNote', () => {
  it('says nothing when the academy’s days and every row are in the device’s zone', () => {
    renderWithProviders(<LessonZoneNote timeZones={[deviceTimeZone(), deviceTimeZone()]} dayZone={deviceTimeZone()} />)
    expect(screen.queryByTestId('lesson-zone-note')).not.toBeInTheDocument()
  })

  it('names the days’ zone when a row’s zone differs from it, even with the academy in the device’s zone (J-F48 — the owner’s note 2 on #105)', () => {
    expect(deviceTimeZone()).not.toBe(FAR_TIME_ZONE)
    // The academy shares the device's zone; a lesson of another zone is returned by an academy day that its row does not show.
    renderWithProviders(<LessonZoneNote timeZones={[deviceTimeZone(), FAR_TIME_ZONE]} dayZone={deviceTimeZone()} />)
    const note = screen.getByTestId('lesson-zone-note')
    expect(note).toHaveTextContent(rowsSentence())
    expect(note).toHaveTextContent(daysSentence(deviceTimeZone()))
  })

  it('names the days’ zone when it is not the device’s, and the rows’ zones only when one differs from the device’s', () => {
    // Every row in the academy's zone, which is not the device's: both sentences.
    const { unmount } = renderWithProviders(<LessonZoneNote timeZones={[FAR_TIME_ZONE]} dayZone={FAR_TIME_ZONE} />)
    expect(screen.getByTestId('lesson-zone-note')).toHaveTextContent(rowsSentence())
    expect(screen.getByTestId('lesson-zone-note')).toHaveTextContent(daysSentence(FAR_TIME_ZONE))
    unmount()

    // Every row in the device's zone, the days in the academy's: the days alone.
    renderWithProviders(<LessonZoneNote timeZones={[deviceTimeZone()]} dayZone={FAR_TIME_ZONE} />)
    expect(screen.getByTestId('lesson-zone-note')).toHaveTextContent(daysSentence(FAR_TIME_ZONE))
    expect(screen.getByTestId('lesson-zone-note')).not.toHaveTextContent(rowsSentence())
  })
})
