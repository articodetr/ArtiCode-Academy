// MOD-20 — the curriculum client (API-226..228): paths, methods, bodies, the Bearer token and the abort signal.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { COURSE_ID } from '../test/courses'
import { ITEM_IDS, makeCurriculum, makeCurriculumItem } from '../test/curriculum'
import { jsonResponse, mockFetch } from '../test/http'
import { curriculumPath, getCurriculum, lessonContentPath, replaceCurriculum, updateLessonContent } from './curriculum'

describe('curriculum API (API-226..228)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the paths with encoded ids', () => {
    expect(curriculumPath(COURSE_ID)).toBe(`/api/courses/${COURSE_ID}/curriculum`)
    expect(lessonContentPath('c/1', 'i 2')).toBe('/api/courses/c%2F1/curriculum/items/i%202/content')
  })

  it('reads the curriculum with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeCurriculum()))
    const controller = new AbortController()
    const curriculum = await getCurriculum(COURSE_ID, controller.signal)
    expect(curriculum.sections).toHaveLength(2)
    expect(curriculum.looseItems).toHaveLength(1)
    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe(`/api/courses/${COURSE_ID}/curriculum`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
  })

  it('replaces the structure and writes one lesson content with a PUT and the JSON body', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(200, url.endsWith('/content') ? makeCurriculumItem({ kind: 'pdf', content: { url: 'https://cdn.example.org/a.pdf' } }) : makeCurriculum()))
    const structure = { sections: [{ id: 's-1', items: [{ id: ITEM_IDS[0], title: { ar: 'درس' }, isRequired: true, isPublished: false }] }], looseItems: [] }
    await replaceCurriculum(COURSE_ID, structure)
    const content = { kind: 'pdf' as const, content: { url: 'https://cdn.example.org/a.pdf' }, resources: [] }
    expect((await updateLessonContent(COURSE_ID, ITEM_IDS[0], content)).kind).toBe('pdf')
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [`/api/courses/${COURSE_ID}/curriculum`, 'PUT', JSON.stringify(structure)],
      [`/api/courses/${COURSE_ID}/curriculum/items/${ITEM_IDS[0]}/content`, 'PUT', JSON.stringify(content)],
    ])
  })
})
