// The course's classes as the server holds them (API-050), shared by the
// «فتح الاشتراك» panel and the course drawer's class tabs, and the one write of
// those tabs: «تجهيز الدورة للمدرسين والطلاب» — the panel's general class
// created with self-service enrollment OFF and opened at once, so teachers can
// be assigned and students enrolled by the office while the subscription stays
// closed until «فتح الاشتراك» (whose plan finds this open general class and
// only switches self-enrollment on — `reenable`).
import { ApiError } from '../api/client'
import { changeClassStatus, createClass, listClasses } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import type { Course } from '../api/courses'
import { planPrepare } from './courses.classScope'
import { DEFAULT_GENERAL_CAPACITY, GENERAL_CLASS_NAME, GENERAL_CLASS_NOTE, generalClassCodes } from './courses.openEnrollment'

/** API-050 allows 100 items per page. */
export const COURSE_CLASSES_PAGE_SIZE = 100

/** Every class of the course: a plan must not miss one on a later page. */
export async function readCourseClasses(courseId: string, signal?: AbortSignal): Promise<AcademyClass[]> {
  const items: AcademyClass[] = []
  let cursor: string | undefined
  do {
    const page = await listClasses({ courseId, sort: 'code', limit: COURSE_CLASSES_PAGE_SIZE, cursor }, signal)
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return items
}

export type PrepareOutcome = 'prepared' | 'unpublished' | 'codes_exhausted'

/**
 * Starts from a fresh read for every candidate code, as the panel does: a taken code moves on to the next
 * one, and a general class left planned by an earlier press is opened instead of creating a second one.
 * Any other refusal is thrown for the caller to show.
 */
export async function prepareCourseClass(course: Pick<Course, 'id' | 'code' | 'status'>, startsOn: string): Promise<PrepareOutcome> {
  for (const code of generalClassCodes(course.code)) {
    const plan = planPrepare(course.status, await readCourseClasses(course.id))
    if (plan.kind === 'unpublished') return 'unpublished'
    if (plan.kind === 'ready') return 'prepared'
    if (plan.kind === 'open') {
      await changeClassStatus(plan.classId, { action: 'open' })
      return 'prepared'
    }
    let created: AcademyClass
    try {
      created = await createClass({
        courseId: course.id,
        code,
        name: { ...GENERAL_CLASS_NAME },
        capacity: DEFAULT_GENERAL_CAPACITY,
        startsOn,
        notes: GENERAL_CLASS_NOTE,
        // The office enrolls at once; the self-service subscription waits for «فتح الاشتراك».
        selfEnrollment: false,
      })
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'class_code_taken') continue
      throw caught
    }
    await changeClassStatus(created.id, { action: 'open' })
    return 'prepared'
  }
  return 'codes_exhausted'
}
