import { describe, expect, it } from 'vitest'
import type { AcademyClass } from '../api/classes'
import { ApiError } from '../api/client'
import { makeClass, makeClassList } from '../test/classes'
import { COURSE_ID, makeCourse } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { prepareCourseClass, readCourseClasses } from './courseClasses'
import { GENERAL_CLASS_NAME, GENERAL_CLASS_NOTE, generalClassCodes } from './courses.openEnrollment'

interface Call {
  method: string
  url: string
  body: unknown
}

/** API-050/052/054 in memory: reads return what the writes left; `takenCodes` answer `409 class_code_taken`. */
function mockClassesServer(initial: AcademyClass[], options: { takenCodes?: string[]; failCreate?: Response } = {}) {
  const state = { classes: [...initial] }
  const writes: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    if (method === 'GET') return jsonResponse(200, makeClassList(state.classes))
    writes.push({ method, url, body })
    if (url === '/api/classes') {
      if (options.failCreate) return options.failCreate
      const code = String(body?.code)
      if (options.takenCodes?.includes(code)) return jsonResponse(409, { statusCode: 409, code: 'class_code_taken', classCode: code, message: 'taken' })
      const created = makeClass({ id: `created-${state.classes.length}`, code, status: 'planned', notes: String(body?.notes), selfEnrollment: body?.selfEnrollment === true, teachers: [] })
      state.classes = [...state.classes, created]
      return jsonResponse(201, created)
    }
    const id = url.split('/')[3]!
    const opened = { ...state.classes.find((klass) => klass.id === id)!, status: 'open' as const }
    state.classes = state.classes.map((klass) => (klass.id === id ? opened : klass))
    return jsonResponse(200, opened)
  })
  return { state, writes }
}

const published = makeCourse({ status: 'published' })

describe('readCourseClasses', () => {
  it('reads every page of the course’s classes, by code, 100 at a time', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      return url.includes('cursor=') ? jsonResponse(200, makeClassList([makeClass({ id: 'b', code: 'B' })])) : jsonResponse(200, makeClassList([makeClass({ id: 'a', code: 'A' })], 'next-page'))
    })
    expect((await readCourseClasses(COURSE_ID)).map((klass) => klass.id)).toEqual(['a', 'b'])
    expect(urls).toEqual([`/api/classes?courseId=${COURSE_ID}&sort=code&limit=100`, `/api/classes?courseId=${COURSE_ID}&sort=code&limit=100&cursor=next-page`])
  })
})

describe('prepareCourseClass', () => {
  it('creates the general class with self-service OFF and opens it at once', async () => {
    const { writes, state } = mockClassesServer([])
    expect(await prepareCourseClass(published, '2026-11-26')).toBe('prepared')
    expect(writes).toEqual([
      {
        method: 'POST',
        url: '/api/classes',
        body: { courseId: COURSE_ID, code: 'PY-101-GEN', name: GENERAL_CLASS_NAME, capacity: 1000, startsOn: '2026-11-26', notes: GENERAL_CLASS_NOTE, selfEnrollment: false },
      },
      { method: 'POST', url: '/api/classes/created-0/status', body: { action: 'open' } },
    ])
    expect(state.classes[0]).toMatchObject({ status: 'open', selfEnrollment: false })
  })

  it('moves to the next code when one is taken', async () => {
    const { writes } = mockClassesServer([], { takenCodes: ['PY-101-GEN'] })
    expect(await prepareCourseClass(published, '2026-11-26')).toBe('prepared')
    expect(writes.filter((call) => call.url === '/api/classes').map((call) => (call.body as { code: string }).code)).toEqual(['PY-101-GEN', 'PY-101-GEN2'])
  })

  it('says so when every code is taken, and opens nothing', async () => {
    const { writes } = mockClassesServer([], { takenCodes: generalClassCodes('PY-101') })
    expect(await prepareCourseClass(published, '2026-11-26')).toBe('codes_exhausted')
    expect(writes.every((call) => call.url === '/api/classes')).toBe(true)
  })

  it('resumes a half-done press: our planned general class is only opened, no second class', async () => {
    const { writes } = mockClassesServer([makeClass({ id: 'half', code: 'PY-101-GEN', notes: GENERAL_CLASS_NOTE, status: 'planned' })])
    expect(await prepareCourseClass(published, '2026-11-26')).toBe('prepared')
    expect(writes).toEqual([{ method: 'POST', url: '/api/classes/half/status', body: { action: 'open' } }])
  })

  it('writes nothing for a course that is not published, or that has a class to work on meanwhile', async () => {
    const first = mockClassesServer([])
    expect(await prepareCourseClass(makeCourse({ status: 'draft' }), '2026-11-26')).toBe('unpublished')
    expect(first.writes).toEqual([])
    const second = mockClassesServer([makeClass({ status: 'open' })])
    expect(await prepareCourseClass(published, '2026-11-26')).toBe('prepared')
    expect(second.writes).toEqual([])
  })

  it('throws any other refusal of the server for the caller to show', async () => {
    mockClassesServer([], { failCreate: jsonResponse(422, { statusCode: 422, code: 'course_not_published', message: 'no' }) })
    await expect(prepareCourseClass(published, '2026-11-26')).rejects.toBeInstanceOf(ApiError)
  })
})
