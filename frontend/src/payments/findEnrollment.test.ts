import { describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/http'
import { findEnrollment } from './findEnrollment'

const classOf = (id: string) => ({ id, code: id, name: { ar: id }, status: 'running', startsOn: null, endsOn: null, course: { id: 'c', code: 'C', name: { ar: 'c' } }, leadTeacher: null })

describe('findEnrollment (CH-0226)', () => {
  it('reads the student’s enrollments once (API-200) and picks the one in the class', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      return jsonResponse(200, { items: [{ id: 'e-new', class: classOf('k-2') }, { id: 'e-1', class: classOf('k-1') }] })
    })
    expect(await findEnrollment('k-1', 's-1')).toBe('e-1')
    expect(await findEnrollment('k-9', 's-1')).toBeNull()
    expect(urls).toEqual(['/api/users/s-1/enrollments', '/api/users/s-1/enrollments'])
  })

  it('falls back to the class roster on a server without API-200 (404 without a code)', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      if (url.startsWith('/api/users/')) return jsonResponse(404, { statusCode: 404, message: 'Cannot GET' })
      return jsonResponse(200, { items: [{ id: 'e-7', student: { id: 's-1' } }], nextCursor: null })
    })
    expect(await findEnrollment('k-1', 's-1')).toBe('e-7')
    expect(urls[1]).toMatch(/^\/api\/classes\/k-1\/enrollments/)
  })
})
