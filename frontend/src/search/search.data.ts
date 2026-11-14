// The rules of the global search (redesign, 2026-11-14): how text is compared (Arabic spelling variants and
// diacritics ignored, both languages matched), what a query looks like (an invoice or receipt number, a
// certificate serial, an e-mail), which pages and actions match, the suggestions shown before typing, and the
// recent searches kept on this device. Pure functions; the component (GlobalSearch.tsx) does the reads.

/** Lower-case, no Arabic diacritics or tatweel, alef/teh-marbuta/yeh variants folded, Latin accents stripped. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * How well `query` matches `text` (0 = not at all): the whole text starting with it scores best, then a word
 * starting with it, then containing it, then every query word found somewhere.
 */
export function matchScore(query: string, text: string): number {
  const q = normalize(query)
  const t = normalize(text)
  if (!q || !t) return 0
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (t.split(' ').some((word) => word.startsWith(q))) return 60
  if (t.includes(q)) return 40
  const words = q.split(' ').filter(Boolean)
  if (words.length > 1 && words.every((word) => t.includes(word))) return 30
  return 0
}

export type QueryKind = 'invoice' | 'receipt' | 'serial' | 'email' | 'text'

/** What the query looks like, so the matching records come first (and needless reads are skipped). */
export function queryKind(query: string): QueryKind {
  const q = query.trim().toUpperCase()
  if (/^INV\b|^INV-/.test(q)) return 'invoice'
  if (/^RCPT\b|^RCPT-/.test(q)) return 'receipt'
  if (q.includes('@')) return 'email'
  if (/^[A-Z]{2,8}-\d{4}(-\d*)?$/.test(q)) return 'serial'
  return 'text'
}

/** The part of a number query the server matches (it searches by part of the number). */
export function numberPart(query: string): string {
  return query.trim().toUpperCase()
}

export const SEARCH_MIN_LENGTH = 2

/** Words a page is also found by, in both languages, beside its menu label. */
export const PAGE_KEYWORDS: Readonly<Record<string, string>> = {
  dashboard: 'home today لوحه الرئيسيه اليوم',
  notifications: 'messages announcements bell اشعارات رسائل اعلانات',
  users: 'people students teachers parents staff accounts invite مستخدمين طلاب معلمين اولياء موظفين حسابات دعوه',
  courses: 'catalog syllabus levels دورات مناهج مستويات',
  classes: 'groups sections enrol roster فصول مجموعات تسجيل طلاب الفصل',
  myClasses: 'my classes فصولي',
  schedule: 'timetable calendar week جدول تقويم اسبوع مواعيد',
  lessons: 'attendance sessions دروس حضور حصص',
  myLessons: 'my lessons attendance دروسي حضوري',
  assignments: 'homework submissions grading واجبات تسليمات تصحيح',
  myAssignments: 'my homework hand in submit واجباتي تسليم',
  exams: 'tests results grades gradebook اختبارات نتائج درجات',
  myExams: 'my exams tests اختباراتي',
  myGrades: 'my grades results marks درجاتي نتائجي',
  myCertificates: 'my certificates شهاداتي',
  certificates: 'diplomas issue verify شهادات اصدار تحقق',
  payments: 'invoice invoices receipt receipts fees money finance billing فاتورة فواتير إيصال ايصالات رسوم مدفوعات مالية دفعة دفع',
  reports: 'statistics attendance report finance تقارير احصاءات',
  settings: 'academy branches rooms grade schemes roles permissions اعدادات فروع قاعات سلالم تقدير ادوار صلاحيات',
  audit: 'log history events سجل تدقيق احداث',
}

export interface SearchAction {
  key: string
  /** The nav entry the action opens; the action shows only to a viewer who can open it. */
  navKey: string
  path: string
  /** A key the server checks for the action itself (beyond opening the page). */
  permission?: string
  keywords: string
}

/** Things people come to do — matched like pages, and the source of the suggestions. */
export const SEARCH_ACTIONS: readonly SearchAction[] = [
  { key: 'takeAttendance', navKey: 'lessons', path: '/lessons', permission: 'attendance.record', keywords: 'take attendance mark present تسجيل الحضور حاضر غائب' },
  { key: 'reviewSubmissions', navKey: 'assignments', path: '/assignments', permission: 'assignments.grade', keywords: 'review grade submissions mark homework تصحيح التسليمات' },
  { key: 'recordPayment', navKey: 'payments', path: '/payments', permission: 'payments.record', keywords: 'record payment receipt pay cash تسجيل دفعه ايصال' },
  { key: 'newInvoice', navKey: 'payments', path: '/payments', permission: 'invoices.manage', keywords: 'new invoice bill fee فاتوره جديده' },
  { key: 'addUser', navKey: 'users', path: '/users', permission: 'users.create', keywords: 'add user new student invite teacher اضافه مستخدم طالب جديد دعوه' },
  { key: 'newClass', navKey: 'classes', path: '/classes', permission: 'classes.manage', keywords: 'new class group create فصل جديد' },
  { key: 'enterResults', navKey: 'exams', path: '/exams', permission: 'exams.grade', keywords: 'exam results scores enter ادخال نتائج الاختبار' },
  { key: 'openReports', navKey: 'reports', path: '/reports', keywords: 'reports attendance rate revenue تقارير نسبه الحضور الايرادات' },
  { key: 'handIn', navKey: 'myAssignments', path: '/my-assignments', keywords: 'hand in submit homework تسليم الواجب' },
  { key: 'nextLessons', navKey: 'myLessons', path: '/my-lessons', keywords: 'next lesson today دروسي القادمه' },
  { key: 'myResults', navKey: 'myGrades', path: '/my-grades', keywords: 'grades results درجاتي نتائجي' },
  { key: 'payFees', navKey: 'payments', path: '/payments', permission: 'invoices.read_own', keywords: 'my invoices fees pay فواتيري رسوم' },
]

/** The actions a viewer may use: the page opens for them and they hold the action's own key. */
export function actionsFor(canOpen: (navKey: string) => boolean, has: (key: string) => boolean): SearchAction[] {
  return SEARCH_ACTIONS.filter((action) => canOpen(action.navKey) && (!action.permission || has(action.permission)))
}

export interface RecentEntry {
  title: string
  subtitle?: string
  path: string
  group: string
}

export const RECENT_MAX = 6

const recentKey = (userId: string) => `articode.search.recent.${userId}`

/** The recent searches of this user on this device (a convenience; empty when storage is unavailable). */
export function readRecent(userId: string): RecentEntry[] {
  try {
    const raw = localStorage.getItem(recentKey(userId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as RecentEntry[]).filter((entry) => entry && typeof entry.path === 'string' && typeof entry.title === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** Puts `entry` first (once), keeping at most RECENT_MAX. */
export function rememberRecent(userId: string, entry: RecentEntry): RecentEntry[] {
  const next = [entry, ...readRecent(userId).filter((item) => item.path !== entry.path)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(recentKey(userId), JSON.stringify(next))
  } catch {
    // Storage unavailable (private window, blocked): the search still works, without recents.
  }
  return next
}

export function forgetRecent(userId: string): void {
  try {
    localStorage.removeItem(recentKey(userId))
  } catch {
    // Nothing to forget.
  }
}
