// Fixtures for the branches tab of the settings page (MOD-02-T06 screen):
// the shape of API-080 as the backend returns it (main branch first, then by
// code), plus the permission sets the tests use.
import type { Branch } from '../api/branches'

export const BRANCH_IDS = [
  '0193b000-0000-7000-8000-00000000e001',
  '0193b000-0000-7000-8000-00000000e002',
  '0193b000-0000-7000-8000-00000000e003',
] as const

export const BRANCH_ID = BRANCH_IDS[0]

/** An academy admin as far as the branches tab is concerned (the settings keys open the page). */
export const BRANCH_MANAGER_PERMISSIONS = ['academy.settings.read', 'academy.settings.manage', 'branches.manage']

export function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: BRANCH_ID,
    code: 'MAIN',
    name: { ar: 'الفرع الرئيسي', en: 'Main branch' },
    address: { ar: 'شارع الملك فهد، الرياض', en: 'King Fahd Road, Riyadh' },
    phone: '+966500000000',
    timezone: null,
    isMain: true,
    isActive: true,
    createdAt: '2026-11-04T10:00:00.000Z',
    updatedAt: '2026-11-04T10:00:00.000Z',
    ...overrides,
  }
}

/** The main branch, an active one with its own time zone, and an inactive one — in the server's order. */
export function THREE_BRANCHES(): Branch[] {
  return [
    makeBranch(),
    makeBranch({ id: BRANCH_IDS[1], code: 'NORTH', name: { ar: 'الفرع الشمالي', en: 'North branch' }, address: null, phone: null, timezone: 'Europe/Istanbul', isMain: false }),
    makeBranch({ id: BRANCH_IDS[2], code: 'OLD', name: { ar: 'الفرع القديم' }, address: null, phone: null, isMain: false, isActive: false }),
  ]
}
