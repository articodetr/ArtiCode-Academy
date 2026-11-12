import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { makeAcademyAnnouncement, makeAnnouncement } from '../test/announcements'
import { audienceGroupKeys, audienceSummary, audienceTarget } from './announcements.format'

const t = i18n.t.bind(i18n)

describe('announcements.format', () => {
  it('names the groups of a class audience and the roles of an academy audience, in their own order', () => {
    expect(audienceGroupKeys(makeAnnouncement().audience)).toEqual(['announcements.groups.students', 'announcements.groups.guardians'])
    expect(audienceGroupKeys({ kind: 'class', classId: 'c', students: false, guardians: false, teachers: true })).toEqual(['announcements.groups.teachers'])
    expect(audienceGroupKeys(makeAcademyAnnouncement().audience)).toEqual(['announcements.roleGroups.student', 'announcements.roleGroups.guardian'])
  })

  it('says the class by code and name, the academy, or a deleted class', () => {
    expect(audienceTarget(makeAnnouncement(), t, 'ar')).toBe('PY-101-A — بايثون — الفصل أ')
    expect(audienceTarget(makeAnnouncement(), t, 'en')).toBe('PY-101-A — Python — class A')
    expect(audienceTarget(makeAcademyAnnouncement(), t, 'ar')).toBe(ar.announcements.audience.academy)
    expect(audienceTarget(makeAnnouncement({ class: null }), t, 'ar')).toBe(ar.announcements.audience.deletedClass)
  })

  it('puts the target and its groups on one line', () => {
    expect(audienceSummary(makeAcademyAnnouncement(), t, 'ar')).toBe(`${ar.announcements.audience.academy} · ${ar.announcements.roleGroups.student}، ${ar.announcements.roleGroups.guardian}`)
  })
})
