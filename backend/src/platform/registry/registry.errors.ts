// Error vocabulary of the platform's academies registry (MOD-18-T04,
// API-183..195). Same body shape as every platform error
// (PlatformHttpException of ../platform.errors.ts):
// `{ statusCode, error, code, message, ...details }`.
//
//   academy_not_found            404 — no academy with this id ({ academyId })
//   academy_slug_taken           409 — another academy already uses the slug ({ slug })
//   academy_archived             409 — the academy is archived and read-only ({ academyId });
//                                      restore it first (POST /api/academies/:id/status `restore`)
//   origin_required              422 — an active academy needs an origin: `activate` without one,
//                                      or `origin: null` on an active academy ({ academyId, action })
//   invalid_transition           409 — status move not allowed from the current state:
//                                      an academy ({ entity: 'academy', from, action, allowed: actions })
//                                      or a subscription ({ entity: 'subscription', from, to, allowed: statuses })
//   domain_not_found             404 — no domain with this id on this academy ({ domainId })
//   domain_taken                 409 — the hostname is registered already, on any academy ({ hostname })
//   domain_demote_forbidden      400 — `isPrimary: false`: make another domain primary instead ({ domainId })
//   plan_not_found               404 — no plan with this id ({ planId })
//   plan_key_taken               409 — another plan already uses the key ({ key })
//   plan_inactive                422 — a new subscription needs an active plan ({ planId, key })
//   plan_limits_invalid          400 — `limits` is not a flat object of at most 20 keys
//                                      `^[a-z][a-zA-Z0-9]{0,39}$` with non-negative integer or null
//                                      values ({ problems, keys })
//   subscription_not_found       404 — no subscription with this id ({ subscriptionId })
//   subscription_current_exists  409 — the academy already has a current (trial | active | past_due)
//                                      subscription; end it first ({ subscriptionId })
//   subscription_invalid         400 — the dates do not fit, after merging a PATCH ({ problems })
//   nothing_to_update            400 — a PATCH body without any field
//   cursor_invalid               400 — the list cursor is malformed or belongs to another order
//
// The guards answer before these: 401 `unauthenticated|token_*|session_invalid`,
// 403 `role_forbidden { required }` (a `support` user on a write), 403
// `origin_forbidden`, 403 `account_suspended`, 423 `account_locked`.
import { HttpStatus } from '@nestjs/common';
import { PlatformHttpException } from '../platform.errors.js';

export const REGISTRY_ERROR_CODES = [
  'academy_not_found',
  'academy_slug_taken',
  'academy_archived',
  'origin_required',
  'invalid_transition',
  'domain_not_found',
  'domain_taken',
  'domain_demote_forbidden',
  'plan_not_found',
  'plan_key_taken',
  'plan_inactive',
  'plan_limits_invalid',
  'subscription_not_found',
  'subscription_current_exists',
  'subscription_invalid',
  'nothing_to_update',
  'cursor_invalid',
] as const;

export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number];

/** Problems of `subscription_invalid` (pure checks in registry.changes.ts). */
export const SUBSCRIPTION_PROBLEMS = ['ends_before_start', 'trial_ends_before_start', 'trial_end_without_trial'] as const;
export type SubscriptionProblem = (typeof SUBSCRIPTION_PROBLEMS)[number];

/** Problems of `plan_limits_invalid` (pure check in registry.validation.ts). */
export const PLAN_LIMITS_PROBLEMS = ['not_an_object', 'too_many_keys', 'key_format', 'value_type'] as const;
export type PlanLimitsProblem = (typeof PLAN_LIMITS_PROBLEMS)[number];

const UNPROCESSABLE = HttpStatus.UNPROCESSABLE_ENTITY;

function registryException(status: HttpStatus, code: RegistryErrorCode, message: string, details?: Record<string, unknown>) {
  return new PlatformHttpException<RegistryErrorCode>(status, code, message, details);
}

export const registryError = {
  academyNotFound: (academyId: string) =>
    registryException(HttpStatus.NOT_FOUND, 'academy_not_found', 'Academy not found', { academyId }),
  academySlugTaken: (slug: string) =>
    registryException(HttpStatus.CONFLICT, 'academy_slug_taken', 'Another academy already uses this slug', { slug }),
  academyArchived: (academyId: string) =>
    registryException(HttpStatus.CONFLICT, 'academy_archived', 'The academy is archived and read-only; restore it first', { academyId }),
  originRequired: (academyId: string, action: 'activate' | 'clear_origin') =>
    registryException(UNPROCESSABLE, 'origin_required', 'An active academy needs an origin', { academyId, action }),
  academyTransition: (from: string, action: string, allowed: readonly string[]) =>
    registryException(HttpStatus.CONFLICT, 'invalid_transition', `Action ${action} is not allowed from status ${from}`, {
      entity: 'academy',
      from,
      action,
      allowed: [...allowed],
    }),
  subscriptionTransition: (from: string, to: string, allowed: readonly string[]) =>
    registryException(HttpStatus.CONFLICT, 'invalid_transition', `A subscription cannot move from ${from} to ${to}`, {
      entity: 'subscription',
      from,
      to,
      allowed: [...allowed],
    }),
  domainNotFound: (domainId: string) =>
    registryException(HttpStatus.NOT_FOUND, 'domain_not_found', 'Domain not found on this academy', { domainId }),
  domainTaken: (hostname: string) =>
    registryException(HttpStatus.CONFLICT, 'domain_taken', 'This hostname is already registered', { hostname }),
  domainDemoteForbidden: (domainId: string) =>
    registryException(HttpStatus.BAD_REQUEST, 'domain_demote_forbidden', 'A primary domain steps down only when another domain is made primary', {
      domainId,
    }),
  planNotFound: (planId: string) => registryException(HttpStatus.NOT_FOUND, 'plan_not_found', 'Plan not found', { planId }),
  planKeyTaken: (key: string) =>
    registryException(HttpStatus.CONFLICT, 'plan_key_taken', 'Another plan already uses this key', { key }),
  planInactive: (planId: string, key: string) =>
    registryException(UNPROCESSABLE, 'plan_inactive', 'A new subscription needs an active plan', { planId, key }),
  planLimitsInvalid: (problems: readonly PlanLimitsProblem[], keys: readonly string[]) =>
    registryException(HttpStatus.BAD_REQUEST, 'plan_limits_invalid', 'limits must be a flat object of non-negative integers or null', {
      problems: [...problems],
      keys: [...keys],
    }),
  subscriptionNotFound: (subscriptionId: string) =>
    registryException(HttpStatus.NOT_FOUND, 'subscription_not_found', 'Subscription not found', { subscriptionId }),
  subscriptionCurrentExists: (subscriptionId: string) =>
    registryException(HttpStatus.CONFLICT, 'subscription_current_exists', 'The academy already has a current subscription; end it first', {
      subscriptionId,
    }),
  subscriptionInvalid: (problems: readonly SubscriptionProblem[]) =>
    registryException(HttpStatus.BAD_REQUEST, 'subscription_invalid', 'The subscription dates are not consistent', {
      problems: [...problems],
    }),
  nothingToUpdate: () => registryException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request names no field to update'),
  cursorInvalid: () => registryException(HttpStatus.BAD_REQUEST, 'cursor_invalid', 'The cursor is not valid for this list'),
};
