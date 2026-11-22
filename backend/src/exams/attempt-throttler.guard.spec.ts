// TEST-283 (unit part) — the rate limit of a learner's attempt routes is keyed by (IP, user), whatever the body says.
import { describe, expect, it } from 'vitest';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard.js';
import { AttemptThrottlerGuard } from './attempt-throttler.guard.js';

interface Tracker {
  getTracker(req: Record<string, unknown>): Promise<string>;
}
/** The guards are built by Nest; the key function needs none of their dependencies. */
const trackerOf = (guard: { prototype: object }) => Object.create(guard.prototype) as Tracker;

describe('AttemptThrottlerGuard', () => {
  const request = { ip: '203.0.113.7', user: { id: 'user-1' }, body: { identifier: 'pick-a-bucket', challenge: 'or-this-one' } };

  it('keys by the signed-in user and never by a field of the body', async () => {
    const guard = trackerOf(AttemptThrottlerGuard);
    expect(await guard.getTracker(request)).toBe('203.0.113.7|user:user-1');
    expect(await guard.getTracker({ ...request, body: { identifier: 'another-bucket' } })).toBe('203.0.113.7|user:user-1');
    expect(await guard.getTracker({ ...request, body: undefined })).toBe('203.0.113.7|user:user-1');
    // Without a user (the global guard would have refused) only the address is left.
    expect(await guard.getTracker({ ip: '203.0.113.7', body: { identifier: 'x' } })).toBe('203.0.113.7');
  });

  it('differs there from the sign-in guard, which keys by the identifier it is given', async () => {
    expect(await trackerOf(AuthThrottlerGuard).getTracker(request)).toBe('203.0.113.7|pick-a-bucket');
  });
});
