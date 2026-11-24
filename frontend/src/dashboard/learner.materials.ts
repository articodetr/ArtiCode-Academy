// The learner home's «educational content» (J-F63): the books and files of a course, from what the lessons already
// carry — a PDF or file lesson's own document and every lesson's `resources` (API-231). API-230 lists the lessons
// without their addresses, so only a bounded number of them is read, the documents first. A lesson of a level that is
// not open yet is never read (D-R145). Pure rules, no React.
import type { FileContent, LearningItem, LearningWorkspace, MyLearningCourse, PdfContent, WorkspaceItem } from '../api/learning'
import type { LocalizedLabel } from '../api/users'
import { fileNameOf, isHttpsUrl } from '../learn/learn.format'
import { byRecentActivity } from '../mySchool/mySchool.view'

/** How many lessons of a course the home reads at most; the whole course is one click away. */
export const MATERIAL_LESSONS_MAX = 12

/** A resource whose address ends like a document can be saved; any other link (a web page) only opens. */
const DOCUMENT_PATH = /\.(pdf|docx?|pptx?|xlsx?|odt|ods|odp|rtf|txt|csv|epub|zip|rar|7z)$/i

export type MaterialKind = 'pdf' | 'file' | 'link'

export interface MaterialRow {
  key: string
  kind: MaterialKind
  url: string
  /** A resource's own title; null for a lesson's document, which goes by the lesson's title. */
  title: LocalizedLabel | null
  /** The file's name when it has one. */
  fileName: string | null
  downloadable: boolean
  lessonId: string
  lessonTitle: LocalizedLabel
}

/** The student's own courses they can open, one row per course, most recent activity first. */
export function materialCoursesOf(items: readonly MyLearningCourse[], studentId: string | undefined): MyLearningCourse[] {
  const seen = new Set<string>()
  return items
    .filter((item) => item.canLearn && item.relation === 'self' && (!studentId || item.student.id === studentId))
    .sort(byRecentActivity)
    .filter((item) => {
      if (seen.has(item.course.id)) return false
      seen.add(item.course.id)
      return true
    })
}

function isDocumentUrl(url: string): boolean {
  try {
    return DOCUMENT_PATH.test(new URL(url).pathname)
  } catch {
    return false
  }
}

function availableItemsOf(workspace: Pick<LearningWorkspace, 'sections'>): WorkspaceItem[] {
  return workspace.sections.flatMap((section) => section.items).filter((item) => item.available)
}

/**
 * Which lessons to read, most useful first: every PDF and file lesson, then the others from the learner's current
 * lesson onward and finally the ones before it (their `resources` are only known once read).
 */
export function materialLessonsOf(workspace: Pick<LearningWorkspace, 'sections' | 'resume'>, max = MATERIAL_LESSONS_MAX): { ids: string[]; truncated: boolean } {
  const items = availableItemsOf(workspace)
  const isDocument = (item: WorkspaceItem) => item.kind === 'pdf' || item.kind === 'file'
  const documents = items.filter(isDocument)
  const others = items.filter((item) => !isDocument(item))
  const from = Math.max(
    others.findIndex((item) => item.id === workspace.resume?.itemId),
    0,
  )
  const ordered = [...documents, ...others.slice(from), ...others.slice(0, from)]
  return { ids: ordered.slice(0, max).map((item) => item.id), truncated: ordered.length > max }
}

/** The rows of the lessons read, in learning order; one address is listed once. */
export function materialsOf(workspace: Pick<LearningWorkspace, 'sections'>, lessons: readonly LearningItem[]): MaterialRow[] {
  const position = new Map(availableItemsOf(workspace).map((item, index) => [item.id, index]))
  const ordered = [...lessons].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0))
  const seen = new Set<string>()
  const rows: MaterialRow[] = []
  const add = (row: Omit<MaterialRow, 'key'>) => {
    if (!isHttpsUrl(row.url) || seen.has(row.url)) return
    seen.add(row.url)
    rows.push({ ...row, key: `${row.lessonId}:${row.url}` })
  }
  for (const lesson of ordered) {
    const base = { lessonId: lesson.id, lessonTitle: lesson.title }
    if (lesson.kind === 'pdf' && lesson.content) {
      const { url } = lesson.content as PdfContent
      add({ ...base, kind: 'pdf', url, title: null, fileName: isHttpsUrl(url) ? fileNameOf(url, null) : null, downloadable: true })
    }
    if (lesson.kind === 'file' && lesson.content) {
      const { url, fileName } = lesson.content as FileContent
      add({ ...base, kind: 'file', url, title: null, fileName: isHttpsUrl(url) ? fileNameOf(url, typeof fileName === 'string' ? fileName : null) : null, downloadable: true })
    }
    for (const resource of lesson.resources) {
      const document = isDocumentUrl(resource.url)
      add({ ...base, kind: document && /\.pdf$/i.test(new URL(resource.url).pathname) ? 'pdf' : document ? 'file' : 'link', url: resource.url, title: resource.title, fileName: document ? fileNameOf(resource.url, null) : null, downloadable: document })
    }
  }
  return rows
}
