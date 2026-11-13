// TEST-209 (unit) — MOD-18-T04 the lifecycle of an academy in the registry.
import { describe, expect, it } from 'vitest';
import type { AcademyStatus } from '../../generated/platform/client.js';
import {
  ACADEMY_STATUS_ACTIONS,
  actionNeedsOrigin,
  allowedAcademyActions,
  archivedAtAfter,
  isReadOnly,
  nextAcademyStatus,
} from './academy-status.js';

const STATUSES: AcademyStatus[] = ['provisioning', 'active', 'suspended', 'archived'];

describe('academy status machine (TEST-209)', () => {
  it('allows exactly the moves of the plan', () => {
    const table: Record<string, AcademyStatus | null> = {};
    for (const action of ACADEMY_STATUS_ACTIONS) {
      for (const from of STATUSES) table[`${action}:${from}`] = nextAcademyStatus(action, from);
    }
    expect(table).toEqual({
      'activate:provisioning': 'active',
      'activate:active': null,
      'activate:suspended': 'active',
      'activate:archived': null,
      'suspend:provisioning': null,
      'suspend:active': 'suspended',
      'suspend:suspended': null,
      'suspend:archived': null,
      'archive:provisioning': 'archived',
      'archive:active': 'archived',
      'archive:suspended': 'archived',
      'archive:archived': null,
      'restore:provisioning': null,
      'restore:active': null,
      'restore:suspended': null,
      'restore:archived': 'suspended',
    });
  });

  it('lists the allowed actions in catalogue order (the invalid_transition detail)', () => {
    expect(allowedAcademyActions('provisioning')).toEqual(['activate', 'archive']);
    expect(allowedAcademyActions('active')).toEqual(['suspend', 'archive']);
    expect(allowedAcademyActions('suspended')).toEqual(['activate', 'archive']);
    expect(allowedAcademyActions('archived')).toEqual(['restore']);
  });

  it('needs an origin to activate; only an archived academy is read-only', () => {
    expect(ACADEMY_STATUS_ACTIONS.filter(actionNeedsOrigin)).toEqual(['activate']);
    expect(STATUSES.filter(isReadOnly)).toEqual(['archived']);
  });

  it('sets archived_at when archiving and clears it on leaving the archive', () => {
    const now = new Date('2026-11-13T10:00:00Z');
    const earlier = new Date('2026-11-01T10:00:00Z');
    expect(archivedAtAfter('archived', null, now)).toBe(now);
    expect(archivedAtAfter('archived', earlier, now)).toBe(earlier);
    expect(archivedAtAfter('suspended', earlier, now)).toBeNull();
    expect(archivedAtAfter('active', null, now)).toBeNull();
  });
});
