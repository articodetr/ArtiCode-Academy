// Local demo data for the UI prototype. Nothing here comes from the server.
// Every list is replaced by API calls as the corresponding backend module lands.

import type { Language, LocalizedText } from '../i18n/language'

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export const DAY_ORDER: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export interface MockScheduleEntry {
  id: string
  day: DayKey
  start: string
  end: string
  className: LocalizedText
  teacher: LocalizedText
  room: string
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

export const mockSchedule: MockScheduleEntry[] = [
  { id: 's-001', day: 'sun', start: '16:00', end: '18:00', className: T.classPyA, teacher: T.teacher1, room: 'Lab 1' },
  { id: 's-002', day: 'sun', start: '18:30', end: '20:30', className: T.classReact, teacher: T.teacher2, room: 'Lab 3' },
  { id: 's-003', day: 'mon', start: '10:00', end: '11:30', className: T.classScratch, teacher: T.teacher2, room: 'Room A' },
  { id: 's-004', day: 'tue', start: '16:00', end: '18:00', className: T.classPyB, teacher: T.teacher1, room: 'Lab 2' },
  { id: 's-005', day: 'wed', start: '16:00', end: '18:00', className: T.classPyA, teacher: T.teacher1, room: 'Lab 1' },
  { id: 's-006', day: 'wed', start: '18:30', end: '20:30', className: T.classReact, teacher: T.teacher2, room: 'Lab 3' },
  { id: 's-007', day: 'thu', start: '10:00', end: '11:30', className: T.classScratch, teacher: T.teacher2, room: 'Room A' },
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

export const mockAcademySettings: MockAcademySettings = {
  nameAr: 'أكاديمية تجريبية',
  nameEn: 'Demo Academy',
  defaultLanguage: 'ar',
  timezone: 'Asia/Riyadh',
  currency: 'SAR',
}
