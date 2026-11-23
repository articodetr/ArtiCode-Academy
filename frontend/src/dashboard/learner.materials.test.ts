import { describe, expect, it } from 'vitest'
import { makeItem, makeWorkspace, withSecondLevelClosed } from '../learn/learn.fixtures'
import { makeChildCourse, makeLearningCourse } from '../mySchool/mySchool.fixtures'
import { materialCoursesOf, materialLessonsOf, materialsOf } from './learner.materials'

describe('the books and files of the learner home (J-F63)', () => {
  it('reads the documents first, then the lessons from the current one on, within the limit', () => {
    expect(materialLessonsOf(makeWorkspace())).toEqual({ ids: ['i3', 'i2', 'i4', 'i1'], truncated: false })
    expect(materialLessonsOf(makeWorkspace(), 2)).toEqual({ ids: ['i3', 'i2'], truncated: true })
  })

  it('never reads a lesson of a level that is not open yet', () => {
    expect(materialLessonsOf(withSecondLevelClosed(makeWorkspace())).ids).toEqual(['i2', 'i1'])
  })

  it('lists a lesson document and its resources in learning order, each address once', () => {
    const workspace = makeWorkspace()
    const rows = materialsOf(workspace, [
      makeItem('i3'),
      makeItem('i1', {
        resources: [
          { title: { ar: 'كتاب الوحدة' }, url: 'https://files.example.org/book.docx' },
          { title: { ar: 'موقع المرجع' }, url: 'https://example.org/reference' },
          { title: { ar: 'نسخة مكررة' }, url: 'https://files.example.org/guide.pdf' },
        ],
      }),
    ])
    expect(rows.map((row) => [row.lessonId, row.kind, row.downloadable])).toEqual([
      ['i1', 'file', true],
      ['i1', 'link', false],
      ['i1', 'pdf', true],
    ])
    expect(rows[2]).toMatchObject({ url: 'https://files.example.org/guide.pdf', fileName: 'guide.pdf' })
  })

  it('shows a file lesson by its own name and drops an address that is not https', () => {
    const rows = materialsOf(makeWorkspace(), [
      makeItem('i4', { kind: 'file', content: { url: 'https://files.example.org/a1b2', fileName: 'ملخص.pdf' } }),
      makeItem('i1', { resources: [{ title: { ar: 'غير آمن' }, url: 'http://example.org/x.pdf' }] }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'file', fileName: 'ملخص.pdf', downloadable: true, title: null })
  })

  it('offers only the student their own courses, each once', () => {
    const own = makeLearningCourse({ enrollmentId: 'e1' })
    const again = makeLearningCourse({ enrollmentId: 'e2', course: own.course })
    const child = makeChildCourse({ enrollmentId: 'e3' })
    expect(materialCoursesOf([own, again, child], undefined)).toHaveLength(1)
    expect(materialCoursesOf([child], undefined)).toEqual([])
  })
})
