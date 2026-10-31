// Fixtures for the academy settings screen (MOD-02/MOD-14): the shape of
// API-035 as the backend returns it, plus the permission sets the tests use.
import type { Academy } from '../api/academy'

export const ACADEMY_ID = '0192f0b0-0000-7000-8000-00000000a001'

export function makeAcademy(overrides: Partial<Academy> = {}): Academy {
  return {
    id: ACADEMY_ID,
    slug: 'articode',
    name: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode Academy' },
    logoUrl: null,
    defaultLocale: 'ar',
    timezone: 'Asia/Riyadh',
    currency: 'SAR',
    contactEmail: 'info@articode.test',
    contactPhone: null,
    createdAt: '2026-10-29T12:00:00.000Z',
    updatedAt: '2026-10-30T09:30:00.000Z',
    ...overrides,
  }
}

/** An academy admin as far as the settings screen is concerned. */
export const SETTINGS_MANAGER_PERMISSIONS = ['academy.settings.read', 'academy.settings.manage']

/** A viewer who reaches the screen but cannot save. */
export const SETTINGS_READER_PERMISSIONS = ['academy.settings.read']
