// Fixtures for the curriculum editor of the course drawer (MOD-20): the shapes of
// API-226..228 as the backend returns them.
import type { Curriculum, CurriculumItem, CurriculumSection } from '../api/curriculum'
import { COURSE_ID } from './courses'

export const SECTION_IDS = ['0194a000-0000-7000-8000-00000000a001', '0194a000-0000-7000-8000-00000000a002', '0194a000-0000-7000-8000-00000000a003'] as const
export const ITEM_IDS = [
  '0194a000-0000-7000-8000-00000000b001',
  '0194a000-0000-7000-8000-00000000b002',
  '0194a000-0000-7000-8000-00000000b003',
  '0194a000-0000-7000-8000-00000000b004',
] as const

export function makeCurriculumItem(overrides: Partial<CurriculumItem> = {}): CurriculumItem {
  return {
    id: ITEM_IDS[0],
    sortOrder: 0,
    title: { ar: 'المتغيرات', en: 'Variables' },
    description: null,
    estimatedMinutes: 45,
    kind: 'text',
    content: null,
    resources: [],
    isRequired: true,
    isPublished: true,
    completionMode: 'manual',
    durationSeconds: 2700,
    progressCount: 0,
    updatedAt: '2026-11-19T10:00:00.000Z',
    ...overrides,
  }
}

export function makeCurriculumSection(overrides: Partial<CurriculumSection> = {}): CurriculumSection {
  return {
    id: SECTION_IDS[0],
    number: 1,
    sortOrder: 0,
    title: null,
    description: null,
    items: [],
    ...overrides,
  }
}

/**
 * Two levels and one loose lesson: «المستوى الأول — البداية» with «المتغيرات» (45 min) and «الشروط» (a description,
 * 3 learners with progress), «المستوى الثاني» (no title) with «الحلقات» (a YouTube video), and «مراجعة» outside every level.
 */
export function makeCurriculum(overrides: Partial<Curriculum> = {}): Curriculum {
  return {
    courseId: COURSE_ID,
    courseCode: 'PY-101',
    canManage: true,
    sections: [
      makeCurriculumSection({
        title: { ar: 'البداية', en: 'Start' },
        items: [
          makeCurriculumItem(),
          makeCurriculumItem({
            id: ITEM_IDS[1],
            sortOrder: 1,
            title: { ar: 'الشروط' },
            description: { ar: 'if و else' },
            estimatedMinutes: 60,
            durationSeconds: 3600,
            progressCount: 3,
          }),
        ],
      }),
      makeCurriculumSection({
        id: SECTION_IDS[1],
        number: 2,
        sortOrder: 1,
        items: [
          makeCurriculumItem({
            id: ITEM_IDS[2],
            sortOrder: 2,
            title: { ar: 'الحلقات', en: 'Loops', tr: 'Döngüler' },
            estimatedMinutes: null,
            kind: 'video',
            content: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: 212 },
            durationSeconds: 212,
          }),
        ],
      }),
    ],
    looseItems: [makeCurriculumItem({ id: ITEM_IDS[3], sortOrder: 3, title: { ar: 'مراجعة' }, estimatedMinutes: null, isRequired: false, isPublished: false, durationSeconds: null })],
    ...overrides,
  }
}
