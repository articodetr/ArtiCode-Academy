import { describe, expect, it } from 'vitest'
import type { Assignment } from '../api/assignments'
import { makeAssignment } from '../test/assignments'
import {
  actionNeedsOpenClass,
  allowedAssignmentActions,
  assignmentEditability,
  availableAssignmentActions,
  isAssignmentDeletable,
  isClassOpenForAssignments,
  isDangerousAssignmentAction,
  lockedAssignmentFields,
  nextAssignmentStatus,
} from './assignments.status'

const withClass = (status: Assignment['class']['status'], overrides: Partial<Assignment> = {}) => makeAssignment({ ...overrides, class: { ...makeAssignment().class, status } })
const submitted = { students: 2, submitted: 1, graded: 1, returned: 0 }

describe('assignments.status (mirror of backend/src/assignments/assignments.status.ts)', () => {
  it('moves draft → open → closed → open and nothing else; grading/graded lead nowhere (D-R37)', () => {
    expect(nextAssignmentStatus('publish', 'draft')).toBe('open')
    expect(nextAssignmentStatus('close', 'open')).toBe('closed')
    expect(nextAssignmentStatus('reopen', 'closed')).toBe('open')
    expect(nextAssignmentStatus('publish', 'open')).toBeNull()
    expect(nextAssignmentStatus('close', 'draft')).toBeNull()
    expect(nextAssignmentStatus('reopen', 'open')).toBeNull()
    expect(allowedAssignmentActions('draft')).toEqual(['publish'])
    expect(allowedAssignmentActions('open')).toEqual(['close'])
    expect(allowedAssignmentActions('closed')).toEqual(['reopen'])
    expect(allowedAssignmentActions('grading')).toEqual([])
    expect(allowedAssignmentActions('graded')).toEqual([])
  })

  it('needs an open class for publish and reopen, never for close; a planned, open or running class is open', () => {
    expect(actionNeedsOpenClass('publish')).toBe(true)
    expect(actionNeedsOpenClass('reopen')).toBe(true)
    expect(actionNeedsOpenClass('close')).toBe(false)
    expect(['planned', 'open', 'running'].every((status) => isClassOpenForAssignments(status as Assignment['class']['status']))).toBe(true)
    expect(isClassOpenForAssignments('completed')).toBe(false)
    expect(isClassOpenForAssignments('cancelled')).toBe(false)
  })

  it('deletes a draft without submissions only, and locks everything of a closed assignment or the grading rules once submitted', () => {
    expect(isAssignmentDeletable('draft', 0)).toBe(true)
    expect(isAssignmentDeletable('draft', 1)).toBe(false)
    expect(isAssignmentDeletable('open', 0)).toBe(false)
    expect(lockedAssignmentFields('closed', 0, ['title', 'weight'])).toEqual(['title', 'weight'])
    expect(lockedAssignmentFields('open', 3, ['title', 'maxScore', 'dueAt', 'allowLate', 'latePenaltyPercent', 'maxAttempts'])).toEqual(['maxScore', 'allowLate', 'latePenaltyPercent', 'maxAttempts'])
    expect(lockedAssignmentFields('open', 0, ['maxScore'])).toEqual([])
  })

  it('offers publish and delete for a draft, close for an open assignment, reopen for a closed one — nothing without assignments.manage', () => {
    expect(availableAssignmentActions(makeAssignment({ status: 'draft' }), true)).toEqual(['publish', 'delete'])
    expect(availableAssignmentActions(makeAssignment({ status: 'open' }), true)).toEqual(['close'])
    expect(availableAssignmentActions(makeAssignment({ status: 'closed' }), true)).toEqual(['reopen'])
    expect(availableAssignmentActions(makeAssignment({ status: 'draft' }), false)).toEqual([])
    // A draft with a submission (not reachable through the API, but the rule) is not deletable.
    expect(availableAssignmentActions(makeAssignment({ status: 'draft', submissions: submitted }), true)).toEqual(['publish'])
  })

  it('keeps close and the deletion of a draft for an assignment of a completed or cancelled class, and nothing else', () => {
    expect(availableAssignmentActions(withClass('completed', { status: 'open' }), true)).toEqual(['close'])
    expect(availableAssignmentActions(withClass('cancelled', { status: 'draft' }), true)).toEqual(['delete'])
    expect(availableAssignmentActions(withClass('completed', { status: 'closed' }), true)).toEqual([])
  })

  it('edits a draft or open assignment of an open class with assignments.manage, the grading rules locked once submitted', () => {
    expect(assignmentEditability(makeAssignment({ status: 'draft' }), true)).toEqual({ editable: true, gradingLocked: false })
    expect(assignmentEditability(makeAssignment({ status: 'open', submissions: submitted }), true)).toEqual({ editable: true, gradingLocked: true })
    expect(assignmentEditability(makeAssignment({ status: 'closed' }), true).editable).toBe(false)
    expect(assignmentEditability(withClass('completed', { status: 'open' }), true).editable).toBe(false)
    expect(assignmentEditability(makeAssignment(), false).editable).toBe(false)
  })

  it('confirms only the deletion as dangerous (a closed assignment can be reopened)', () => {
    expect(isDangerousAssignmentAction('delete')).toBe(true)
    expect(isDangerousAssignmentAction('close')).toBe(false)
    expect(isDangerousAssignmentAction('publish')).toBe(false)
  })
})
