// Fixtures of the public catalog (MOD-20, D-R138): API-236/237 as
// backend/src/catalog/public-catalog.dto.ts answers them.
import type { PublicCourseCard, PublicCourseDetail, PublicCourseList } from '../api/publicCatalog'

export const PUBLIC_COURSE_IDS = ['0194a000-0000-7000-8000-00000000c101', '0194a000-0000-7000-8000-00000000c102', '0194a000-0000-7000-8000-00000000c103'] as const

export function makePublicCard(overrides: Partial<PublicCourseCard> = {}): PublicCourseCard {
  return {
    id: PUBLIC_COURSE_IDS[0],
    code: 'PY-101',
    name: { ar: 'أساسيات بايثون', en: 'Python Basics' },
    summary: { ar: 'مدخل عملي إلى البرمجة', en: 'A hands-on start in programming' },
    coverImageUrl: 'https://cdn.example.org/py.jpg',
    level: { id: '0194a000-0000-7000-8000-00000000b101', name: { ar: 'مبتدئ', en: 'Beginner' } },
    subject: { id: '0194a000-0000-7000-8000-00000000a101', name: { ar: 'البرمجة', en: 'Programming' } },
    durationHours: 24,
    sessionsCount: 12,
    pricing: 'free',
    price: null,
    openClasses: 1,
    hasFreeSeat: true,
    lessonCount: 5,
    levelCount: 2,
    ...overrides,
  }
}

export function makePublicList(items: PublicCourseCard[] = [makePublicCard()], nextCursor: string | null = null): PublicCourseList {
  return { items, nextCursor }
}

export function makePublicDetail(overrides: Partial<PublicCourseDetail> = {}): PublicCourseDetail {
  return {
    ...makePublicCard(),
    description: { ar: 'تتعلم في هذه الدورة المتغيرات والدوال والحلقات.', en: 'Variables, functions and loops.' },
    minAge: 12,
    maxAge: 18,
    outline: [
      {
        number: 1,
        title: { ar: 'البداية', en: 'Getting started' },
        lessons: [
          { title: { ar: 'ما هي البرمجة؟', en: 'What is programming?' }, kind: 'text', durationSeconds: null },
          { title: { ar: 'تثبيت بايثون', en: 'Installing Python' }, kind: 'video', durationSeconds: 600 },
        ],
      },
      {
        number: 2,
        title: null,
        lessons: [
          { title: { ar: 'المتغيرات', en: 'Variables' }, kind: 'pdf', durationSeconds: null },
          { title: { ar: 'حصة أسئلة مباشرة', en: 'Live Q&A' }, kind: 'live', durationSeconds: 3600 },
        ],
      },
    ],
    ...overrides,
  }
}

/** The body of a `404 catalog_not_public` (D-R138). */
export const CATALOG_NOT_PUBLIC = { statusCode: 404, error: 'Not Found', code: 'catalog_not_public', message: 'The catalog is not public' }
