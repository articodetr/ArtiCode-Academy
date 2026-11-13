import type { Request } from 'express';
import type { PlatformRole } from '../../generated/platform/client.js';

/** The authenticated platform user, read from `platform_users` on every request. */
export interface PlatformPrincipal {
  id: string;
  email: string;
  fullName: string;
  role: PlatformRole;
  /** Id (`jti`) of the access token used for this request. */
  tokenId: string;
}

/**
 * A request after PlatformAuthGuard. The principal is NOT on `request.user`
 * (the academy AuthPrincipal's place), so the academy @CurrentUser() never
 * reads a platform user.
 */
export interface PlatformAuthenticatedRequest extends Request {
  platformUser?: PlatformPrincipal;
}

// The client context of an audit row is the academy's RequestContext
// (src/auth/principal.ts) — `{ ip, userAgent }`, built by requestContext() of
// src/auth/cookies.ts; re-exported here for the platform modules.
export type { RequestContext } from '../../auth/principal.js';
