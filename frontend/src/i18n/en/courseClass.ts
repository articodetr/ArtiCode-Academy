// The course drawer's class tabs — English of ../ar/courseClass.ts.
import type { courseClass as arCourseClass } from '../ar/courseClass'

export const courseClass: typeof arCourseClass = {
  tabs: {
    teachers: 'Teachers',
    students: 'Students',
  },
  loadFailed: 'Could not read the teachers and students of this course.',
  retry: 'Try again',
  rosterHidden: 'You may not see the students of this group.',
  selector: {
    label: 'Group',
    placeholder: 'Choose a group',
    locked: 'Save or discard your changes before switching the group.',
  },
  empty: {
    unpublished: 'Teachers are assigned and students enrolled once the course is published. Publish the course first.',
    noPermission: 'This course is not ready for teachers and students yet. The academy administration prepares it.',
    prepare: 'This course is not ready for teachers and students yet.',
  },
  prepare: {
    action: 'Prepare the course for teachers and students',
    hint: 'Lets you assign teachers and enroll students here. Students cannot subscribe by themselves until you press “Open enrollment” in the details tab.',
    resume: 'Preparing this course did not finish; complete it so students can be enrolled.',
    done: 'The course is ready for teachers and students.',
    codesExhausted: 'The course could not be prepared: every code reserved for it is taken.',
  },
}
