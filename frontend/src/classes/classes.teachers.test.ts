import { describe, expect, it } from 'vitest'
import { TEACHER_IDS, makeClassTeacher, makeTeacherCandidate } from '../test/classes'
import { candidateRefusal, defaultRoleFor, planTeachersReplacement, teacherDraftsOf, teacherListProblems } from './classes.teachers'

const lead = makeClassTeacher()
const assistant = makeClassTeacher({ userId: TEACHER_IDS[1], fullName: 'منى', role: 'assistant' })

describe('classes.teachers', () => {
  it('sends nothing when the draft holds the same users with the same roles, whatever the order', () => {
    expect(planTeachersReplacement([lead, assistant], teacherDraftsOf([assistant, lead]))).toBeNull()
    expect(planTeachersReplacement([], [])).toBeNull()
  })

  it('sends the whole final list when a user is added, removed or changes role', () => {
    const drafts = teacherDraftsOf([lead, assistant])
    expect(planTeachersReplacement([lead, assistant], drafts.slice(0, 1))).toEqual({ teachers: [{ userId: TEACHER_IDS[0], role: 'lead' }] })
    expect(planTeachersReplacement([lead], drafts)).toEqual({
      teachers: [
        { userId: TEACHER_IDS[0], role: 'lead' },
        { userId: TEACHER_IDS[1], role: 'assistant' },
      ],
    })
    expect(planTeachersReplacement([lead], [{ ...drafts[0]!, role: 'assistant' }])).toEqual({ teachers: [{ userId: TEACHER_IDS[0], role: 'assistant' }] })
    expect(planTeachersReplacement([lead], [])).toEqual({ teachers: [] })
  })

  it('mirrors teachers_invalid: more than one lead or a repeated user', () => {
    expect(teacherListProblems(teacherDraftsOf([lead, assistant]))).toBeNull()
    expect(teacherListProblems(teacherDraftsOf([lead, { ...assistant, role: 'lead' }]))).toEqual({ duplicates: [], leadCount: 2 })
    expect(teacherListProblems(teacherDraftsOf([lead, lead]))).toEqual({ duplicates: [TEACHER_IDS[0]], leadCount: 2 })
  })

  it('makes the first added teacher the lead and the others assistants', () => {
    expect(defaultRoleFor([])).toBe('lead')
    expect(defaultRoleFor(teacherDraftsOf([assistant]))).toBe('lead')
    expect(defaultRoleFor(teacherDraftsOf([lead]))).toBe('assistant')
  })

  it('refuses a candidate already listed, without the teacher role, or neither invited nor active', () => {
    const drafts = teacherDraftsOf([lead])
    expect(candidateRefusal(makeTeacherCandidate(), drafts)).toBeNull()
    expect(candidateRefusal(makeTeacherCandidate({ status: 'invited' }), drafts)).toBeNull()
    expect(candidateRefusal(makeTeacherCandidate({ id: TEACHER_IDS[0] }), drafts)).toBe('already_listed')
    expect(candidateRefusal(makeTeacherCandidate({ roles: ['staff'] }), drafts)).toBe('not_a_teacher')
    expect(candidateRefusal(makeTeacherCandidate({ status: 'suspended' }), drafts)).toBe('not_eligible')
    expect(candidateRefusal(makeTeacherCandidate({ deletedAt: '2026-11-01T00:00:00.000Z' }), drafts)).toBe('not_eligible')
  })
})
