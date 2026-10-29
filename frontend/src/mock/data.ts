// Local demo data for the UI prototype. Nothing here comes from the server.
// Every list is replaced by API calls as the corresponding backend module lands.

import type { Role } from '../auth/roles'
import type { Language, LocalizedText } from '../i18n/language'

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export const DAY_ORDER: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export interface MockUser {
  id: string
  name: LocalizedText
  email: string
  role: Role
  status: 'active' | 'inactive' | 'pending'
  joinedAt: string
}

export interface MockCourse {
  id: string
  code: string
  name: LocalizedText
  level: LocalizedText
  teacher: LocalizedText
  students: number
  status: 'published' | 'draft' | 'archived'
}

export interface MockClass {
  id: string
  name: LocalizedText
  course: LocalizedText
  teacher: LocalizedText
  capacity: number
  enrolled: number
  room: string
}

export interface MockScheduleEntry {
  id: string
  day: DayKey
  start: string
  end: string
  className: LocalizedText
  teacher: LocalizedText
  room: string
}

export interface MockLesson {
  id: string
  title: LocalizedText
  course: LocalizedText
  type: 'live' | 'recorded'
  date: string
  durationMin: number
  status: 'scheduled' | 'completed' | 'cancelled'
}

export interface MockAssignment {
  id: string
  title: LocalizedText
  course: LocalizedText
  dueDate: string
  submitted: number
  total: number
  status: 'open' | 'closed' | 'grading'
}

export interface MockExam {
  id: string
  title: LocalizedText
  course: LocalizedText
  date: string
  durationMin: number
  maxScore: number
  avgScore: number | null
  status: 'scheduled' | 'in_progress' | 'graded'
}

export interface MockCertificate {
  id: string
  serial: string
  student: LocalizedText
  course: LocalizedText
  issuedAt: string
  grade: LocalizedText
}

export interface MockPayment {
  id: string
  invoice: string
  student: LocalizedText
  amount: number
  currency: string
  dueDate: string
  status: 'paid' | 'pending' | 'overdue'
  method: LocalizedText | null
}

export interface MockNotification {
  id: string
  title: LocalizedText
  body: LocalizedText
  channel: 'inApp' | 'email' | 'sms'
  sentAt: string
  read: boolean
}

export interface MockReport {
  id: string
  name: LocalizedText
  description: LocalizedText
  category: 'academic' | 'financial' | 'attendance'
}

export interface MockAcademySettings {
  nameAr: string
  nameEn: string
  defaultLanguage: Language
  timezone: string
  currency: string
}

const T = {
  teacher1: { ar: 'محمد الشهري', en: 'Mohammed Alshehri' },
  teacher2: { ar: 'نورة القحطاني', en: 'Noura Alqahtani' },
  student1: { ar: 'أحمد السالم', en: 'Ahmed Alsalem' },
  student2: { ar: 'ليان المطيري', en: 'Layan Almutairi' },
  student3: { ar: 'يوسف الدوسري', en: 'Yousef Aldosari' },
  coursePython: { ar: 'أساسيات بايثون', en: 'Python Fundamentals' },
  courseReact: { ar: 'تطوير الويب بـ React', en: 'Web Development with React' },
  courseData: { ar: 'مقدمة في علم البيانات', en: 'Introduction to Data Science' },
  courseScratch: { ar: 'البرمجة للأطفال بـ Scratch', en: 'Coding for Kids with Scratch' },
  courseJs: { ar: 'جافاسكربت الحديثة', en: 'Modern JavaScript' },
  classPyA: { ar: 'بايثون - المجموعة أ', en: 'Python - Group A' },
  classPyB: { ar: 'بايثون - المجموعة ب', en: 'Python - Group B' },
  classReact: { ar: 'React - مجموعة المساء', en: 'React - Evening group' },
  classScratch: { ar: 'Scratch - الأطفال (صباحي)', en: 'Scratch - Kids (morning)' },
} satisfies Record<string, LocalizedText>

export const mockUsers: MockUser[] = [
  { id: 'u-001', name: { ar: 'سارة الحربي', en: 'Sara Alharbi' }, email: 'sara@demo.academy', role: 'admin', status: 'active', joinedAt: '2026-01-10' },
  { id: 'u-002', name: T.teacher1, email: 'm.alshehri@demo.academy', role: 'teacher', status: 'active', joinedAt: '2026-02-03' },
  { id: 'u-003', name: T.teacher2, email: 'noura@demo.academy', role: 'teacher', status: 'active', joinedAt: '2026-02-15' },
  { id: 'u-004', name: T.student1, email: 'ahmed.s@demo.academy', role: 'student', status: 'active', joinedAt: '2026-09-01' },
  { id: 'u-005', name: T.student2, email: 'layan@demo.academy', role: 'student', status: 'pending', joinedAt: '2026-10-20' },
  { id: 'u-006', name: T.student3, email: 'yousef@demo.academy', role: 'student', status: 'active', joinedAt: '2026-09-05' },
  { id: 'u-007', name: { ar: 'خالد السالم', en: 'Khaled Alsalem' }, email: 'khaled@demo.academy', role: 'guardian', status: 'active', joinedAt: '2026-09-01' },
  { id: 'u-008', name: { ar: 'هند الزهراني', en: 'Hind Alzahrani' }, email: 'hind@demo.academy', role: 'staff', status: 'inactive', joinedAt: '2026-03-12' },
]

export const mockCourses: MockCourse[] = [
  { id: 'c-001', code: 'PY-101', name: T.coursePython, level: { ar: 'مبتدئ', en: 'Beginner' }, teacher: T.teacher1, students: 40, status: 'published' },
  { id: 'c-002', code: 'WEB-201', name: T.courseReact, level: { ar: 'متوسط', en: 'Intermediate' }, teacher: T.teacher2, students: 18, status: 'published' },
  { id: 'c-003', code: 'DS-301', name: T.courseData, level: { ar: 'متقدم', en: 'Advanced' }, teacher: T.teacher1, students: 0, status: 'draft' },
  { id: 'c-004', code: 'SCR-100', name: T.courseScratch, level: { ar: 'مبتدئ', en: 'Beginner' }, teacher: T.teacher2, students: 15, status: 'published' },
  { id: 'c-005', code: 'JS-150', name: T.courseJs, level: { ar: 'مبتدئ', en: 'Beginner' }, teacher: T.teacher1, students: 0, status: 'archived' },
]

export const mockClasses: MockClass[] = [
  { id: 'cl-001', name: T.classPyA, course: T.coursePython, teacher: T.teacher1, capacity: 25, enrolled: 24, room: 'Lab 1' },
  { id: 'cl-002', name: T.classPyB, course: T.coursePython, teacher: T.teacher1, capacity: 25, enrolled: 16, room: 'Lab 2' },
  { id: 'cl-003', name: T.classReact, course: T.courseReact, teacher: T.teacher2, capacity: 20, enrolled: 18, room: 'Lab 3' },
  { id: 'cl-004', name: T.classScratch, course: T.courseScratch, teacher: T.teacher2, capacity: 15, enrolled: 15, room: 'Room A' },
]

export const mockSchedule: MockScheduleEntry[] = [
  { id: 's-001', day: 'sun', start: '16:00', end: '18:00', className: T.classPyA, teacher: T.teacher1, room: 'Lab 1' },
  { id: 's-002', day: 'sun', start: '18:30', end: '20:30', className: T.classReact, teacher: T.teacher2, room: 'Lab 3' },
  { id: 's-003', day: 'mon', start: '10:00', end: '11:30', className: T.classScratch, teacher: T.teacher2, room: 'Room A' },
  { id: 's-004', day: 'tue', start: '16:00', end: '18:00', className: T.classPyB, teacher: T.teacher1, room: 'Lab 2' },
  { id: 's-005', day: 'wed', start: '16:00', end: '18:00', className: T.classPyA, teacher: T.teacher1, room: 'Lab 1' },
  { id: 's-006', day: 'wed', start: '18:30', end: '20:30', className: T.classReact, teacher: T.teacher2, room: 'Lab 3' },
  { id: 's-007', day: 'thu', start: '10:00', end: '11:30', className: T.classScratch, teacher: T.teacher2, room: 'Room A' },
]

export const mockLessons: MockLesson[] = [
  { id: 'l-001', title: { ar: 'المتغيرات وأنواع البيانات', en: 'Variables and data types' }, course: T.coursePython, type: 'live', date: '2026-10-29 16:00', durationMin: 120, status: 'scheduled' },
  { id: 'l-002', title: { ar: 'المكوّنات والخصائص', en: 'Components and props' }, course: T.courseReact, type: 'live', date: '2026-10-29 18:30', durationMin: 120, status: 'scheduled' },
  { id: 'l-003', title: { ar: 'الحلقات التكرارية', en: 'Loops' }, course: T.coursePython, type: 'recorded', date: '2026-10-26 16:00', durationMin: 95, status: 'completed' },
  { id: 'l-004', title: { ar: 'الحركة والمشاهد في Scratch', en: 'Motion and scenes in Scratch' }, course: T.courseScratch, type: 'live', date: '2026-10-30 10:00', durationMin: 90, status: 'scheduled' },
  { id: 'l-005', title: { ar: 'إدارة الحالة', en: 'State management' }, course: T.courseReact, type: 'recorded', date: '2026-10-22 18:30', durationMin: 110, status: 'completed' },
  { id: 'l-006', title: { ar: 'الدوال', en: 'Functions' }, course: T.coursePython, type: 'live', date: '2026-10-21 16:00', durationMin: 120, status: 'cancelled' },
]

export const mockAssignments: MockAssignment[] = [
  { id: 'a-001', title: { ar: 'تمارين الحلقات', en: 'Loop exercises' }, course: T.coursePython, dueDate: '2026-11-02', submitted: 31, total: 40, status: 'open' },
  { id: 'a-002', title: { ar: 'بناء قائمة مهام', en: 'Build a to-do list' }, course: T.courseReact, dueDate: '2026-10-28', submitted: 18, total: 18, status: 'grading' },
  { id: 'a-003', title: { ar: 'لعبة بسيطة', en: 'A simple game' }, course: T.courseScratch, dueDate: '2026-10-20', submitted: 14, total: 15, status: 'closed' },
  { id: 'a-004', title: { ar: 'الدوال والوحدات', en: 'Functions and modules' }, course: T.coursePython, dueDate: '2026-11-09', submitted: 0, total: 40, status: 'open' },
]

export const mockExams: MockExam[] = [
  { id: 'e-001', title: { ar: 'اختبار منتصف الدورة', en: 'Midterm exam' }, course: T.coursePython, date: '2026-11-05', durationMin: 60, maxScore: 50, avgScore: null, status: 'scheduled' },
  { id: 'e-002', title: { ar: 'اختبار المكوّنات', en: 'Components quiz' }, course: T.courseReact, date: '2026-10-27', durationMin: 30, maxScore: 20, avgScore: 16.4, status: 'graded' },
  { id: 'e-003', title: { ar: 'الاختبار النهائي', en: 'Final exam' }, course: T.courseScratch, date: '2026-10-29', durationMin: 45, maxScore: 100, avgScore: null, status: 'in_progress' },
  { id: 'e-004', title: { ar: 'اختبار قصير 1', en: 'Quiz 1' }, course: T.coursePython, date: '2026-10-15', durationMin: 20, maxScore: 10, avgScore: 7.8, status: 'graded' },
]

export const mockCertificates: MockCertificate[] = [
  { id: 'cert-001', serial: 'ACA-2026-0001', student: T.student1, course: T.courseJs, issuedAt: '2026-06-30', grade: { ar: 'ممتاز', en: 'Excellent' } },
  { id: 'cert-002', serial: 'ACA-2026-0002', student: T.student3, course: T.courseJs, issuedAt: '2026-06-30', grade: { ar: 'جيد جداً', en: 'Very good' } },
  { id: 'cert-003', serial: 'ACA-2026-0003', student: T.student2, course: T.courseScratch, issuedAt: '2026-08-15', grade: { ar: 'ممتاز', en: 'Excellent' } },
]

export const mockPayments: MockPayment[] = [
  { id: 'p-001', invoice: 'INV-2026-0101', student: T.student1, amount: 1500, currency: 'SAR', dueDate: '2026-09-01', status: 'paid', method: { ar: 'تحويل بنكي', en: 'Bank transfer' } },
  { id: 'p-002', invoice: 'INV-2026-0102', student: T.student1, amount: 1500, currency: 'SAR', dueDate: '2026-11-01', status: 'pending', method: null },
  { id: 'p-003', invoice: 'INV-2026-0103', student: T.student2, amount: 900, currency: 'SAR', dueDate: '2026-10-20', status: 'overdue', method: null },
  { id: 'p-004', invoice: 'INV-2026-0104', student: T.student3, amount: 1500, currency: 'SAR', dueDate: '2026-09-05', status: 'paid', method: { ar: 'بطاقة', en: 'Card' } },
  { id: 'p-005', invoice: 'INV-2026-0105', student: T.student3, amount: 1500, currency: 'SAR', dueDate: '2026-11-05', status: 'pending', method: null },
]

export const mockNotifications: MockNotification[] = [
  { id: 'n-001', title: { ar: 'تذكير بدرس اليوم', en: 'Reminder: lesson today' }, body: { ar: 'درس "المتغيرات وأنواع البيانات" يبدأ 16:00 في Lab 1.', en: '"Variables and data types" starts at 16:00 in Lab 1.' }, channel: 'inApp', sentAt: '2026-10-29 08:00', read: false },
  { id: 'n-002', title: { ar: 'فاتورة متأخرة', en: 'Overdue invoice' }, body: { ar: 'الفاتورة INV-2026-0103 تجاوزت تاريخ الاستحقاق.', en: 'Invoice INV-2026-0103 is past its due date.' }, channel: 'email', sentAt: '2026-10-21 09:00', read: false },
  { id: 'n-003', title: { ar: 'نتائج اختبار المكوّنات', en: 'Components quiz results' }, body: { ar: 'تم نشر الدرجات لدورة React.', en: 'Grades for the React course are published.' }, channel: 'inApp', sentAt: '2026-10-28 17:30', read: true },
  { id: 'n-004', title: { ar: 'تغيير قاعة', en: 'Room change' }, body: { ar: 'انتقل درس Scratch يوم الخميس إلى Room A.', en: 'Thursday Scratch lesson moved to Room A.' }, channel: 'sms', sentAt: '2026-10-27 12:00', read: true },
  { id: 'n-005', title: { ar: 'واجب جديد', en: 'New assignment' }, body: { ar: 'أُضيف واجب "الدوال والوحدات" بموعد نهائي 2026-11-09.', en: '"Functions and modules" was added, due 2026-11-09.' }, channel: 'inApp', sentAt: '2026-10-26 10:15', read: true },
]

export const mockReports: MockReport[] = [
  { id: 'r-001', name: { ar: 'أداء الطلاب حسب الدورة', en: 'Student performance by course' }, description: { ar: 'متوسط الدرجات ونسب النجاح لكل دورة.', en: 'Average grades and pass rates per course.' }, category: 'academic' },
  { id: 'r-002', name: { ar: 'الحضور الأسبوعي', en: 'Weekly attendance' }, description: { ar: 'نسب الحضور لكل فصل خلال الأسبوع.', en: 'Attendance rates per class for the week.' }, category: 'attendance' },
  { id: 'r-003', name: { ar: 'التحصيل والمتأخرات', en: 'Collections and arrears' }, description: { ar: 'المبالغ المحصّلة والمتأخرة حسب الطالب.', en: 'Collected and overdue amounts by student.' }, category: 'financial' },
  { id: 'r-004', name: { ar: 'الإيرادات الشهرية', en: 'Monthly revenue' }, description: { ar: 'الإيرادات حسب الشهر والدورة.', en: 'Revenue by month and course.' }, category: 'financial' },
  { id: 'r-005', name: { ar: 'تسليم الواجبات', en: 'Assignment submissions' }, description: { ar: 'نسب التسليم في الموعد لكل واجب.', en: 'On-time submission rates per assignment.' }, category: 'academic' },
  { id: 'r-006', name: { ar: 'غياب الطلاب المتكرر', en: 'Repeated absences' }, description: { ar: 'الطلاب الذين تجاوزوا حد الغياب.', en: 'Students over the absence threshold.' }, category: 'attendance' },
]

export const mockAcademySettings: MockAcademySettings = {
  nameAr: 'أكاديمية تجريبية',
  nameEn: 'Demo Academy',
  defaultLanguage: 'ar',
  timezone: 'Asia/Riyadh',
  currency: 'SAR',
}
