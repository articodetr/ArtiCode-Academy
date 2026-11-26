import { describe, expect, it } from 'vitest'
import type { AcademyClass } from '../api/classes'
import { makeClass } from '../test/classes'
import {
  COURSE_CLASS_TABS,
  awaitsOpening,
  classChoices,
  isCourseClassTab,
  pickDefaultClass,
  planPrepare,
  resolveSelectedClass,
  showsClassSelector,
  visibleCourseClassTabs,
} from './courses.classScope'
import { GENERAL_CLASS_NAME, GENERAL_CLASS_NOTE } from './courses.openEnrollment'

const general = (overrides: Partial<AcademyClass> = {}) => makeClass({ id: 'general', code: 'PY-101-GEN', name: { ...GENERAL_CLASS_NAME }, notes: GENERAL_CLASS_NOTE, ...overrides })
const own = (overrides: Partial<AcademyClass> = {}) => makeClass({ id: 'own', code: 'PY-101-A', notes: null, ...overrides })

const holding = (...keys: string[]) => (key: string) => keys.includes(key)

describe('pickDefaultClass', () => {
  it('picks the general class first, open or running before planned', () => {
    const plannedGeneral = general({ id: 'g-planned', code: 'PY-101-GEN2', status: 'planned' })
    const liveGeneral = general({ id: 'g-live', status: 'running' })
    const liveOwn = own({ status: 'open' })
    expect(pickDefaultClass([liveOwn, plannedGeneral, liveGeneral])?.id).toBe('g-live')
    expect(pickDefaultClass([liveOwn, plannedGeneral])?.id).toBe('g-planned')
  })

  it('else the course’s other open or running class, else a planned one', () => {
    expect(pickDefaultClass([own({ id: 'planned', status: 'planned' }), own({ id: 'live', code: 'PY-101-B', status: 'running' })])?.id).toBe('live')
    expect(pickDefaultClass([own({ id: 'planned', status: 'planned' })])?.id).toBe('planned')
  })

  it('never picks an ended class: a course with completed or cancelled classes only has none', () => {
    expect(pickDefaultClass([general({ status: 'completed' }), own({ status: 'cancelled' })])).toBeNull()
    expect(pickDefaultClass([])).toBeNull()
  })

  it('keeps the server’s order (by code) between equals', () => {
    expect(pickDefaultClass([own({ id: 'a', code: 'A', status: 'open' }), own({ id: 'b', code: 'B', status: 'open' })])?.id).toBe('a')
  })
})

describe('the selector', () => {
  it('is shown only when the course has more than one class, or a single ended one', () => {
    expect(showsClassSelector([])).toBe(false)
    expect(showsClassSelector([general({ status: 'open' })])).toBe(false)
    expect(showsClassSelector([own({ status: 'planned' })])).toBe(false)
    expect(showsClassSelector([general({ status: 'open' }), own({ status: 'completed' })])).toBe(true)
    expect(showsClassSelector([own({ status: 'completed' })])).toBe(true)
  })

  it('offers every class: the pickable ones in the default order, then the completed, then the cancelled', () => {
    const cancelled = own({ id: 'cancelled', status: 'cancelled' })
    const completed = own({ id: 'completed', status: 'completed' })
    const plannedOwn = own({ id: 'planned-own', status: 'planned' })
    const liveOwn = own({ id: 'live-own', status: 'open' })
    const liveGeneral = general({ id: 'live-general', status: 'open' })
    expect(classChoices([cancelled, completed, plannedOwn, liveOwn, liveGeneral]).map((klass) => klass.id)).toEqual(['live-general', 'live-own', 'planned-own', 'completed', 'cancelled'])
  })

  it('keeps the admin’s choice while the course still has it, and falls back to the default otherwise', () => {
    const classes = [general({ status: 'open' }), own({ status: 'completed' })]
    expect(resolveSelectedClass(classes, 'own')?.id).toBe('own')
    expect(resolveSelectedClass(classes, null)?.id).toBe('general')
    expect(resolveSelectedClass(classes, 'deleted-meanwhile')?.id).toBe('general')
    expect(resolveSelectedClass([own({ status: 'completed' })], null)).toBeNull()
  })
})

describe('planPrepare', () => {
  it('refuses a course that is not published, whatever its classes', () => {
    expect(planPrepare('draft', [])).toEqual({ kind: 'unpublished' })
    expect(planPrepare('archived', [general({ status: 'planned' })])).toEqual({ kind: 'unpublished' })
  })

  it('creates the general class when the course has no class to work on (ended ones do not count)', () => {
    expect(planPrepare('published', [])).toEqual({ kind: 'create' })
    expect(planPrepare('published', [general({ status: 'completed' })])).toEqual({ kind: 'create' })
  })

  it('only opens our general class left planned by an earlier press', () => {
    expect(planPrepare('published', [general({ status: 'planned' })])).toEqual({ kind: 'open', classId: 'general' })
    expect(awaitsOpening(general({ status: 'planned' }))).toBe(true)
  })

  it('writes nothing when a usable class is there, and never opens an admin’s own planned class', () => {
    expect(planPrepare('published', [general({ status: 'open' })])).toEqual({ kind: 'ready', classId: 'general' })
    expect(planPrepare('published', [own({ status: 'planned' })])).toEqual({ kind: 'ready', classId: 'own' })
    expect(awaitsOpening(own({ status: 'planned' }))).toBe(false)
    expect(awaitsOpening(general({ status: 'open' }))).toBe(false)
  })
})

describe('visibleCourseClassTabs', () => {
  it('shows nothing without classes.read: the API lists no class', () => {
    expect(visibleCourseClassTabs(holding('classes.manage', 'enrollments.read', 'enrollments.manage', 'grades.read_all', 'certificates.read_all'))).toEqual([])
  })

  it('applies the class drawer’s gates', () => {
    expect(visibleCourseClassTabs(holding('classes.read'))).toEqual(['teachers', 'schedule'])
    expect(visibleCourseClassTabs(holding('classes.read', 'enrollments.read'))).toEqual(['teachers', 'students', 'schedule', 'learning'])
    expect(visibleCourseClassTabs(holding('classes.read', 'grades.read_all', 'certificates.issue'))).toEqual(['teachers', 'schedule', 'gradebook', 'certificates'])
    expect(visibleCourseClassTabs(holding('classes.read', 'enrollments.read', 'grades.read_all', 'certificates.read_all'))).toEqual([...COURSE_CLASS_TABS])
  })

  it('knows its own tab keys', () => {
    expect(isCourseClassTab('teachers')).toBe(true)
    expect(isCourseClassTab('details')).toBe(false)
    expect(isCourseClassTab('curriculum')).toBe(false)
  })
})
