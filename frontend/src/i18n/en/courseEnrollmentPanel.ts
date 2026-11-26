// PORTAL-04 phase 1: the course drawer's enrollment panel — English of ../ar/courseEnrollmentPanel.ts.
import type { courseEnrollmentPanel as arCourseEnrollmentPanel } from '../ar/courseEnrollmentPanel'

export const courseEnrollmentPanel: typeof arCourseEnrollmentPanel = {
  title: 'Course enrollment',
  unpublished: 'Publish the course first to open enrollment',
  loadFailed: 'Could not read the classes of this course.',
  retry: 'Try again',
  openState: 'Enrollment is open',
  closedState: 'Enrollment is closed',
  openHint: 'Students can enroll in this course through:',
  closedHint: 'Students cannot enroll in this course by themselves yet.',
  seats: 'Seats taken:',
  privateClass: 'Private class',
  privateHint: 'Private groups are managed from the course tabs (“Teachers” and “Students”); this button does not change them.',
  priceWarning: 'The fee plan of this course is deactivated; students cannot enroll until the course has a valid fee plan.',
  actions: {
    open: 'Open enrollment',
    stop: 'Stop enrollment',
  },
  create: {
    title: 'Open enrollment in this course',
    intro: 'A general class will be created for this course and opened for enrollment, with no timetable and no teacher. Teachers are assigned and students enrolled later from the “Teachers” and “Students” tabs of this course.',
    otherClasses: 'This course already has other groups, and this button does not change them; they are chosen in the course tabs (“Teachers” and “Students”).',
    capacity: 'Maximum number of students',
    capacityHint: 'The most students this class can take.',
    capacityInvalid: 'Enter a whole number from 1 to {{max}}.',
    startsOn: 'Start date',
    startsOnHint: 'Level opening dates are counted from this date',
    startsOnInvalid: 'Enter a valid start date.',
  },
  stop: {
    title: 'Stop enrollment in this course?',
    content: 'New students will no longer be able to enroll by themselves. Current students keep their access.',
    titlePartial: 'Stop enrollment through the general class?',
    contentPartial: 'Only the general class stops. Enrollment stays open through the private classes shown here, which are managed from the course tabs. Current students keep their access.',
  },
  done: {
    opened: 'Enrollment in the course is open.',
    stopped: 'Enrollment stopped. Current students keep their access.',
    stoppedPartial: 'Enrollment through the general class stopped; it is still open through the private classes.',
  },
  errors: {
    codesExhausted: 'Every code reserved for this course’s general group is taken; contact technical support.',
  },
}
