// Test fixtures of the course player (MOD-20): API-230/231 bodies as
// backend/src/learning/my-learning.dto.ts answers them. A course `c1` with two
// levels — «المستوى الأول — أساسيات» (i1 text, completed; i2 YouTube video)
// and «المستوى الثاني» (i3 PDF; i4 optional reading) — and every lesson's
// neighbours in learning order; every level open and no class session unless a
// test says otherwise (makeSession for D-R143). Test-only.
import type { ItemProgress, LearningItem, LearningWorkspace, ProgressCounts, WorkspaceItem, WorkspaceSession } from '../api/learning'

export function makeCounts(overrides: Partial<ProgressCounts> = {}): ProgressCounts {
  return { total: 0, required: 0, completed: 0, completedRequired: 0, percent: null, isComplete: false, completedAt: null, ...overrides }
}

export function makeProgress(overrides: Partial<ItemProgress> = {}): ItemProgress {
  return { state: 'not_started', completedAt: null, completionSource: null, positionSeconds: null, watchedSeconds: 0, watchedPercent: null, ...overrides }
}

export const TITLES = {
  i1: 'مقدمة الدورة',
  i2: 'فيديو الترحيب',
  i3: 'دليل الدورة',
  i4: 'قراءة إضافية',
} as const

export type FixtureItemId = keyof typeof TITLES

const ORDER: FixtureItemId[] = ['i1', 'i2', 'i3', 'i4']

function workspaceItem(id: FixtureItemId, overrides: Partial<WorkspaceItem> = {}): WorkspaceItem {
  return {
    id,
    title: { ar: TITLES[id] },
    kind: 'text',
    isRequired: true,
    estimatedMinutes: null,
    durationSeconds: null,
    completionMode: 'manual',
    state: 'not_started',
    completedAt: null,
    available: true,
    ...overrides,
  }
}

/** A class session of the workspace (D-R143): scheduled, online, in UTC, linked to no lesson. */
export function makeSession(overrides: Partial<WorkspaceSession> = {}): WorkspaceSession {
  return {
    id: 'ses-1',
    title: { ar: 'حصة المراجعة' },
    startsAt: '2030-01-20T10:00:00.000Z',
    endsAt: '2030-01-20T11:00:00.000Z',
    status: 'scheduled',
    deliveryMode: 'online',
    meetingUrl: 'https://meet.example.org/review',
    timeZone: 'UTC',
    syllabusItemId: null,
    attendance: null,
    ...overrides,
  }
}

export function makeWorkspace(overrides: Partial<LearningWorkspace> = {}): LearningWorkspace {
  return {
    course: { id: 'c1', code: 'PY-101', name: { ar: 'أساسيات البرمجة', en: 'Programming basics' }, coverImageUrl: null },
    enrollment: { id: 'e1', status: 'active', class: { id: 'k1', code: 'PY-101-A', name: { ar: 'الفصل أ' } } },
    completionPercent: 90,
    sections: [
      {
        id: 's1',
        number: 1,
        title: { ar: 'أساسيات', en: 'Basics' },
        description: null,
        items: [
          workspaceItem('i1', { state: 'completed', completedAt: '2026-11-18T10:00:00.000Z', estimatedMinutes: 45 }),
          workspaceItem('i2', { kind: 'video', durationSeconds: 245 }),
        ],
        progress: makeCounts({ total: 2, required: 2, completed: 1, completedRequired: 1, percent: 50 }),
        isOpen: true,
        opensOn: null,
      },
      {
        id: 's2',
        number: 2,
        title: null,
        description: null,
        items: [workspaceItem('i3', { kind: 'pdf' }), workspaceItem('i4', { isRequired: false })],
        progress: makeCounts({ total: 2, required: 1, completed: 0, completedRequired: 0, percent: 0 }),
        isOpen: true,
        opensOn: null,
      },
    ],
    progress: makeCounts({ total: 4, required: 3, completed: 1, completedRequired: 1, percent: 33 }),
    resume: { itemId: 'i2', reason: 'last', positionSeconds: null },
    sessions: [],
    ...overrides,
  }
}

const SECTIONS: Record<FixtureItemId, { id: string; number: number; title: { ar: string; en?: string } | null }> = {
  i1: { id: 's1', number: 1, title: { ar: 'أساسيات', en: 'Basics' } },
  i2: { id: 's1', number: 1, title: { ar: 'أساسيات', en: 'Basics' } },
  i3: { id: 's2', number: 2, title: null },
  i4: { id: 's2', number: 2, title: null },
}

function neighbor(id: FixtureItemId | undefined) {
  return id ? { id, title: { ar: TITLES[id] }, available: true } : null
}

export function makeItem(id: FixtureItemId, overrides: Partial<LearningItem> = {}): LearningItem {
  const index = ORDER.indexOf(id)
  const base: LearningItem = {
    id,
    courseId: 'c1',
    title: { ar: TITLES[id] },
    description: null,
    kind: 'text',
    content: { body: { ar: `نص ${TITLES[id]}` } },
    resources: [],
    isRequired: true,
    estimatedMinutes: null,
    durationSeconds: null,
    section: SECTIONS[id],
    completionMode: 'manual',
    completionPercent: 90,
    progress: makeProgress(),
    neighbors: { previous: neighbor(ORDER[index - 1]), next: neighbor(ORDER[index + 1]) },
    sessions: [],
    assignments: [],
    exams: [],
  }
  if (id === 'i1') {
    base.progress = makeProgress({ state: 'completed', completedAt: '2026-11-18T10:00:00.000Z', completionSource: 'manual' })
    base.estimatedMinutes = 45
  }
  if (id === 'i2') {
    base.kind = 'video'
    base.content = { provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: 245 }
    base.durationSeconds = 245
  }
  if (id === 'i3') {
    base.kind = 'pdf'
    base.content = { url: 'https://files.example.org/guide.pdf' }
  }
  if (id === 'i4') base.isRequired = false
  return { ...base, ...overrides }
}

/**
 * The fixture workspace with its second level («المستوى الثاني» — i3, i4)
 * closed until `opensOn` (D-R145): listed, not available.
 */
export function withSecondLevelClosed(workspace: LearningWorkspace, opensOn: string | null = '2030-02-01'): LearningWorkspace {
  return {
    ...workspace,
    sections: workspace.sections.map((section) =>
      section.id === 's2' ? { ...section, isOpen: false, opensOn, items: section.items.map((item) => ({ ...item, available: false })) } : section,
    ),
  }
}
