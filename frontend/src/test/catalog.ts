// Fixtures of the learner's catalog screens (MOD-19): API-219..223 shapes as
// backend/src/catalog/catalog.dto.ts and enrollment-requests.dto.ts answer them.
import type {
  CatalogClass,
  CatalogCourseCard,
  CatalogCourseDetail,
  CatalogEnrollResult,
  CatalogList,
  MyEnrollmentRequest,
  MyEnrollmentRequestList,
  RequestInvoice,
} from '../api/catalog'

export const CATALOG_COURSE_IDS = ['0193f000-0000-7000-8000-00000000c001', '0193f000-0000-7000-8000-00000000c002'] as const
export const CATALOG_CLASS_IDS = ['0193f000-0000-7000-8000-00000000d001', '0193f000-0000-7000-8000-00000000d002'] as const
export const REQUEST_IDS = ['0193f000-0000-7000-8000-00000000e001', '0193f000-0000-7000-8000-00000000e002', '0193f000-0000-7000-8000-00000000e003'] as const
export const INVOICE_IDS = ['0193f000-0000-7000-8000-00000000f001', '0193f000-0000-7000-8000-00000000f002'] as const

export function makeCatalogCard(overrides: Partial<CatalogCourseCard> = {}): CatalogCourseCard {
  return {
    id: CATALOG_COURSE_IDS[0],
    code: 'PY-101',
    name: { ar: 'أساسيات بايثون', en: 'Python Basics' },
    summary: { ar: 'مدخل عملي إلى البرمجة', en: 'A hands-on start in programming' },
    coverImageUrl: 'https://cdn.example.org/py.jpg',
    level: { id: '0193a000-0000-7000-8000-00000000b001', code: 'BEG', name: { ar: 'مبتدئ', en: 'Beginner' } },
    durationHours: 24,
    sessionsCount: 12,
    syllabusCount: 3,
    pricing: 'free',
    price: null,
    openClasses: 1,
    availableClasses: 1,
    teachers: [{ fullName: 'خالد المعلم', displayName: null }],
    mine: { enrolled: false, pending: false },
    ...overrides,
  }
}

export function makeCatalogList(items: CatalogCourseCard[] = [makeCatalogCard()], nextCursor: string | null = null): CatalogList {
  return { items, nextCursor }
}

export function makeCatalogClass(overrides: Partial<CatalogClass> = {}): CatalogClass {
  return {
    id: CATALOG_CLASS_IDS[0],
    code: 'PY-101-A',
    name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' },
    status: 'open',
    startsOn: '2026-12-01',
    endsOn: '2027-02-28',
    capacity: 20,
    enrolledCount: 5,
    seatsLeft: 15,
    leadTeacher: { fullName: 'خالد المعلم', displayName: null },
    schedule: [{ weekday: 1, startTime: '17:00', endTime: '18:30', timeZone: 'UTC', effectiveFrom: '2026-11-01', effectiveTo: null }],
    selfEnrollment: true,
    enrollable: true,
    blocker: null,
    myEnrollment: null,
    ...overrides,
  }
}

export function makeCatalogDetail(overrides: Partial<CatalogCourseDetail> = {}): CatalogCourseDetail {
  return {
    ...makeCatalogCard(),
    description: { ar: 'تتعلم في هذه الدورة المتغيرات والدوال والحلقات.', en: 'Variables, functions and loops.' },
    minAge: 12,
    maxAge: 18,
    syllabus: [
      { title: { ar: 'المتغيرات', en: 'Variables' }, description: null, estimatedMinutes: 60 },
      { title: { ar: 'الدوال', en: 'Functions' }, description: { ar: 'تعريف الدوال واستدعاؤها' }, estimatedMinutes: null },
    ],
    classes: [makeCatalogClass()],
    selfService: { allowed: true, reason: null },
    ...overrides,
  }
}

export function makeRequestInvoice(overrides: Partial<RequestInvoice> = {}): RequestInvoice {
  return {
    id: INVOICE_IDS[0],
    number: 'INV-2026-00082',
    status: 'issued',
    total: 1200,
    paid: 0,
    balance: 1200,
    currency: 'SAR',
    issuedAt: '2026-11-19T09:00:00.000Z',
    payments: null,
    ...overrides,
  }
}

export function makeMyRequest(overrides: Partial<MyEnrollmentRequest> = {}): MyEnrollmentRequest {
  return {
    id: REQUEST_IDS[0],
    status: 'pending',
    state: 'pending_payment',
    source: 'self',
    requestedAt: '2026-11-19T09:00:00.000Z',
    decidedAt: null,
    rejectionReason: null,
    class: {
      id: CATALOG_CLASS_IDS[1],
      code: 'WEB-201-A',
      name: { ar: 'تطوير الويب — أ', en: 'Web — A' },
      status: 'open',
      startsOn: '2026-12-01',
      endsOn: null,
      capacity: 15,
      enrolledCount: 3,
      leadTeacher: null,
    },
    course: { id: CATALOG_COURSE_IDS[1], code: 'WEB-201', name: { ar: 'تطوير الويب', en: 'Web development' }, coverImageUrl: null, pricing: 'paid' },
    payment: { state: 'unpaid', required: true, total: 1200, paid: 0, balance: 1200, currency: 'SAR', invoices: [makeRequestInvoice()] },
    ...overrides,
  }
}

export function makeMyRequestList(items: MyEnrollmentRequest[]): MyEnrollmentRequestList {
  return { items }
}

export function makeEnrollResult(overrides: Partial<CatalogEnrollResult> = {}): CatalogEnrollResult {
  return {
    outcome: 'enrolled',
    enrollment: makeMyRequest({
      id: REQUEST_IDS[2],
      status: 'active',
      state: 'enrolled',
      requestedAt: null,
      decidedAt: '2026-11-19T09:00:00.000Z',
      payment: { state: 'not_required', required: false, total: 0, paid: 0, balance: 0, currency: null, invoices: [] },
    }),
    ...overrides,
  }
}
