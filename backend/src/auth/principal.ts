import type { Request } from 'express';
import type { Locale, UserStatus } from '../generated/prisma/client.js';

/** The authenticated caller, resolved from the database on every request. */
export interface AuthPrincipal {
  id: string;
  email: string | null;
  username: string | null;
  fullName: string;
  displayName: string | null;
  locale: Locale | null;
  status: UserStatus;
  mustChangePassword: boolean;
  /** Role keys (e.g. `academy_admin`, `teacher`). */
  roles: string[];
  /** Active permission keys derived from the roles (deprecated keys excluded). */
  permissions: string[];
  /** Id (`jti`) of the access token used for this request. */
  tokenId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthPrincipal;
}

/** Client context recorded in audit_logs (never the token or the password). */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}
