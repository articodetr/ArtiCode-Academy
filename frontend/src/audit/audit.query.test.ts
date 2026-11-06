import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION_SUGGESTIONS, DEFAULT_AUDIT_FILTERS, EMPTY_FILTER_VALUES, beforeToIso, hasActiveFilters, toListParams, validateAuditFilters } from './audit.query'

const ACTOR = '0192f0a0-0000-7000-8000-000000000001'

describe('validateAuditFilters', () => {
  it('accepts blank values and values the server accepts', () => {
    expect(validateAuditFilters(EMPTY_FILTER_VALUES)).toEqual({})
    expect(validateAuditFilters({ action: ' users.status. ', actorUserId: ACTOR.toUpperCase(), entityType: 'users', entityId: 'S-2026-001', before: '2026-10-30T12:00' })).toEqual({})
  })

  it('mirrors the server patterns: action prefix, actor UUID, entity type, entity id length, before', () => {
    expect(validateAuditFilters({ ...EMPTY_FILTER_VALUES, action: 'Users.' })).toEqual({ action: 'audit.validation.action' })
    expect(validateAuditFilters({ ...EMPTY_FILTER_VALUES, action: 'users%' })).toEqual({ action: 'audit.validation.action' })
    expect(validateAuditFilters({ ...EMPTY_FILTER_VALUES, action: `a${'b'.repeat(64)}` })).toEqual({ action: 'audit.validation.action' })
    expect(validateAuditFilters({ ...EMPTY_FILTER_VALUES, actorUserId: 'user-1' })).toEqual({ actorUserId: 'audit.validation.uuid' })
    expect(validateAuditFilters({ ...EMPTY_FILTER_VALUES, entityType: 'Users' })).toEqual({ entityType: 'audit.validation.entityType' })
    expect(validateAuditFilters({ ...EMPTY_FILTER_VALUES, entityId: 'x'.repeat(129), entityType: 'users' })).toEqual({ entityId: 'audit.validation.entityIdMax' })
    expect(validateAuditFilters({ ...EMPTY_FILTER_VALUES, before: 'yesterday' })).toEqual({ before: 'audit.validation.before' })
  })

  it('requires the entity type when an entity id is given (API-011)', () => {
    expect(validateAuditFilters({ ...EMPTY_FILTER_VALUES, entityId: ACTOR })).toEqual({ entityType: 'audit.validation.entityTypeRequired' })
  })
})

describe('toListParams', () => {
  it('sends the limit alone for the default filters and the first page', () => {
    expect(toListParams(DEFAULT_AUDIT_FILTERS)).toEqual({ limit: 50 })
  })

  it('trims the values, converts `before` to ISO 8601 and appends the cursor', () => {
    const params = toListParams({ action: ' roles. ', actorUserId: ` ${ACTOR} `, entityType: 'roles', entityId: ' role-1 ', before: '2026-10-30T12:00', limit: 100 }, 'cursor-2')
    expect(params).toEqual({
      limit: 100,
      action: 'roles.',
      actorUserId: ACTOR,
      entityType: 'roles',
      entityId: 'role-1',
      before: new Date('2026-10-30T12:00').toISOString(),
      cursor: 'cursor-2',
    })
  })
})

describe('beforeToIso / hasActiveFilters / suggestions', () => {
  it('reads a datetime-local value as local time and drops blanks', () => {
    expect(beforeToIso('')).toBeUndefined()
    expect(beforeToIso('   ')).toBeUndefined()
    expect(beforeToIso('nope')).toBeUndefined()
    expect(beforeToIso('2026-10-30T09:30')).toBe(new Date(2026, 9, 30, 9, 30).toISOString())
  })

  it('reports whether a filter is set, ignoring the page size', () => {
    expect(hasActiveFilters(DEFAULT_AUDIT_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTER_VALUES, entityId: ' ' })).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTER_VALUES, action: 'auth.' })).toBe(true)
  })

  it('offers only prefixes the server accepts', () => {
    for (const suggestion of AUDIT_ACTION_SUGGESTIONS) {
      expect(validateAuditFilters({ ...EMPTY_FILTER_VALUES, action: suggestion })).toEqual({})
    }
    expect(new Set(AUDIT_ACTION_SUGGESTIONS).size).toBe(AUDIT_ACTION_SUGGESTIONS.length)
  })

  it('offers the MOD-07 class schedule event once, inside the classes family (J-F07)', () => {
    expect(AUDIT_ACTION_SUGGESTIONS.filter((suggestion) => suggestion === 'classes.schedule.changed')).toEqual(['classes.schedule.changed'])
    expect(AUDIT_ACTION_SUGGESTIONS.indexOf('classes.schedule.changed')).toBeGreaterThan(AUDIT_ACTION_SUGGESTIONS.indexOf('classes.'))
  })

  it('offers every MOD-04 event of the 12.4 dictionary once, the syllabus event among them (O7-F)', () => {
    const mod04Events = [
      'levels.created',
      'levels.updated',
      'levels.deleted',
      'levels.reordered',
      'courses.created',
      'courses.updated',
      'courses.status.changed',
      'courses.deleted',
      'courses.syllabus.changed',
    ]
    for (const event of mod04Events) {
      expect(AUDIT_ACTION_SUGGESTIONS.filter((suggestion) => suggestion === event)).toEqual([event])
    }
    // Both MOD-04 families can also be searched by prefix.
    expect(AUDIT_ACTION_SUGGESTIONS).toEqual(expect.arrayContaining(['levels.', 'courses.']))
  })
})
