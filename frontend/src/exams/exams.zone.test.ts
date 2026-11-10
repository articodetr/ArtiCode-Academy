import { describe, expect, it } from 'vitest'
import { examZoneOf } from './exams.zone'

describe('examZoneOf (the zone the server will give the exam — D-R41)', () => {
  const current = { lessonId: 'l-1', timeZone: 'Asia/Riyadh' }

  it('keeps the exam’s own zone while its lesson link stays, follows a newly chosen lesson, else the academy, else the device', () => {
    expect(examZoneOf({ lessonId: 'l-1', lessonZone: 'Europe/Istanbul', current, academyZone: 'Asia/Dubai', deviceZone: 'UTC' })).toEqual({ zone: 'Asia/Riyadh', source: 'exam' })
    expect(examZoneOf({ lessonId: 'l-2', lessonZone: 'Europe/Istanbul', current, academyZone: 'Asia/Dubai', deviceZone: 'UTC' })).toEqual({ zone: 'Europe/Istanbul', source: 'lesson' })
    expect(examZoneOf({ lessonId: undefined, lessonZone: null, current, academyZone: 'Asia/Dubai', deviceZone: 'UTC' })).toEqual({ zone: 'Asia/Dubai', source: 'academy' })
    expect(examZoneOf({ lessonId: 'l-3', lessonZone: null, academyZone: null, deviceZone: 'UTC' })).toEqual({ zone: 'UTC', source: 'device' })
  })
})
