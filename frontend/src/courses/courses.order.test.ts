import { describe, expect, it } from 'vitest'
import { canReorderCourses } from './courses.order'

describe('canReorderCourses (PORTAL-04-COURSE-ORDER)', () => {
  it('allows the arrows in the plain office order only', () => {
    expect(canReorderCourses({ sort: 'position', q: '', status: undefined })).toBe(true)
    expect(canReorderCourses({ sort: 'position', q: '   ', status: undefined })).toBe(true)
  })

  it('refuses them with a search, a status filter or another sort', () => {
    expect(canReorderCourses({ sort: 'position', q: 'web', status: undefined })).toBe(false)
    expect(canReorderCourses({ sort: 'position', q: '', status: 'draft' })).toBe(false)
    expect(canReorderCourses({ sort: 'code', q: '', status: undefined })).toBe(false)
    expect(canReorderCourses({ sort: 'createdAt', q: '', status: undefined })).toBe(false)
  })
})
