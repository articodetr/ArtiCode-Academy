// PORTAL-03/04 (#207, contract v3 — the password is chosen on /register): the pure rules of a visitor creating their
// own student account — the body checks of the public routes in the problem codes of `400 registration_invalid`, with
// every problem under its own field and every unexpected field named in `unknown` (the global ValidationPipe never
// sees these bodies, so the refusal always has the contract's shape), and THE rule of a self-registered account still
// waiting for its address. A name or an address is counted in characters as a person sees them (code points), as the
// frontend's mirror does (`frontend/src/studentRegistration/registration.rules.ts` — keep them in step); a password is
// counted as the MOD-01 policy counts it (`passwordProblems()` of password.service.ts).
// No Prisma, no database: unit-tested in registration.rules.spec.ts.
import { isEmail } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../auth/password.service.js';
import { EMAIL_MAX_LENGTH } from '../users/users.validation.js';

export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 200;
export { EMAIL_MAX_LENGTH };

/** The locales a visitor may ask for: every template locale (the `locale` enum). */
export const REGISTRATION_LOCALES = ['ar', 'en', 'tr'] as const;
export type RegistrationLocale = (typeof REGISTRATION_LOCALES)[number];

/** The problem codes of `400 registration_invalid`, under each field's name. */
export const REGISTRATION_PROBLEMS = ['required', 'too_short', 'too_long', 'invalid_format', 'blank'] as const;
export type RegistrationProblem = (typeof REGISTRATION_PROBLEMS)[number];

/** The fields each route accepts; anything else is reported in `unknown`. */
export const REGISTER_FIELDS = ['fullName', 'email', 'password', 'locale'] as const;
export const COMPLETE_FIELDS = ['password'] as const;

/** The details of `400 registration_invalid`: `fields` holds only the fields with a problem; both keys are always present. */
export interface RegistrationViolations {
  fields: Record<string, RegistrationProblem[]>;
  unknown: string[];
}

export type Checked<T> = { ok: true; value: T } | { ok: false; violations: RegistrationViolations };

/**
 * A `POST /api/account/register` body whose shape is valid, normalised: the name trimmed, the address trimmed and
 * lower-cased, the password as typed (the rest of its policy — `password_weak` — is the service's next check).
 */
export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  locale: RegistrationLocale | null;
}

/** A `POST /api/account/register/:token/complete` body whose shape is valid: the password chosen at registration. */
export interface CompleteInput {
  password: string;
}

/** A C0 control or DEL: a name or an address with a line break or a tab is never what a person typed on purpose. */
function hasControlCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function characterCount(text: string): number {
  return [...text].length;
}

function bodyObject(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** What is wrong with a full name that is present (`undefined` = missing); null when it is fine. */
export function fullNameProblem(value: unknown): RegistrationProblem | null {
  if (value === undefined || value === '') return 'required';
  if (typeof value !== 'string') return 'invalid_format';
  const name = value.trim();
  if (name.length === 0) return 'blank';
  if (hasControlCharacter(name)) return 'invalid_format';
  const length = characterCount(name);
  if (length < FULL_NAME_MIN_LENGTH) return 'too_short';
  if (length > FULL_NAME_MAX_LENGTH) return 'too_long';
  return null;
}

/** What is wrong with an e-mail address (`undefined` = missing); null when it is fine. */
export function emailProblem(value: unknown): RegistrationProblem | null {
  if (value === undefined || value === '') return 'required';
  if (typeof value !== 'string') return 'invalid_format';
  const email = value.trim();
  if (email.length === 0) return 'blank';
  if (characterCount(email) > EMAIL_MAX_LENGTH) return 'too_long';
  if (hasControlCharacter(email) || !isEmail(email)) return 'invalid_format';
  return null;
}

/** An optional locale: absent is fine, anything but `ar`/`en`/`tr` (`null` included) is a wrong format. */
export function localeProblem(value: unknown): RegistrationProblem | null {
  if (value === undefined) return null;
  return typeof value === 'string' && (REGISTRATION_LOCALES as readonly string[]).includes(value) ? null : 'invalid_format';
}

/**
 * The password must be a non-empty string of at most the MOD-01 maximum (`PASSWORD_MAX_LENGTH`, counted like
 * `passwordProblems()` counts it — a longer one can never have been stored). The rest of its policy (`password_weak`)
 * is the service's next check on registration; on completion the stored hash decides.
 */
export function passwordShapeProblem(value: unknown): RegistrationProblem | null {
  if (value === undefined || value === '') return 'required';
  if (typeof value !== 'string') return 'invalid_format';
  return value.length > PASSWORD_MAX_LENGTH ? 'too_long' : null;
}

/**
 * THE rule of a self-registered account whose holder has not confirmed the address yet (contract v3): `pending` and
 * marked `self_registered_at` — the marker e-mail registration and Google sign-up set when they create an account
 * (POST /api/users creates `invited` accounts without it). Since v3 the visitor chooses the password at registration,
 * so the v2 rule (`pending` without a password) no longer holds. Every path that treats such an account specially
 * uses it: the registration routes (a fresh link, the completion), the sign-in (`403 email_not_verified` once the
 * password matched), the admin `activate` (409 — only `delete` applies), the hard delete, the user detail
 * (`awaitingRegistration`) and the Google sign-in (links and activates it). A soft-deleted row is each caller's own
 * check.
 */
export function isPendingSelfRegistration(user: { status: string; selfRegisteredAt: Date | null }): boolean {
  return user.status === 'pending' && user.selfRegisteredAt !== null;
}

/**
 * The same rule as a query filter (`Prisma.UserWhereInput`) — the user detail (`awaitingRegistration`), the hard
 * delete of such an account and the conditional writes of the completion. Keep it in step with the function above
 * (registration.rules.spec.ts checks both say the same).
 */
export const PENDING_SELF_REGISTRATION_WHERE = { status: 'pending', selfRegisteredAt: { not: null } } as const;

/** The trimmed, lower-cased address (the form every stored e-mail has — users.validation.ts). */
export function normalizeRegistrationEmail(email: string): string {
  return email.trim().toLowerCase();
}

function unknownFields(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body).filter((key) => !allowed.includes(key)).sort();
}

function violationsOf(problems: Record<string, RegistrationProblem | null>, unknown: string[]): RegistrationViolations | null {
  const fields: Record<string, RegistrationProblem[]> = {};
  for (const [name, problem] of Object.entries(problems)) if (problem) fields[name] = [problem];
  return Object.keys(fields).length > 0 || unknown.length > 0 ? { fields, unknown } : null;
}

/** `POST /api/account/register`: a body that is not a JSON object reads as an empty one (the three fields required). */
export function checkRegisterBody(raw: unknown): Checked<RegisterInput> {
  const body = bodyObject(raw);
  const violations = violationsOf(
    {
      fullName: fullNameProblem(body['fullName']),
      email: emailProblem(body['email']),
      password: passwordShapeProblem(body['password']),
      locale: localeProblem(body['locale']),
    },
    unknownFields(body, REGISTER_FIELDS),
  );
  if (violations) return { ok: false, violations };
  return {
    ok: true,
    value: {
      fullName: (body['fullName'] as string).trim(),
      email: normalizeRegistrationEmail(body['email'] as string),
      password: body['password'] as string,
      locale: (body['locale'] as RegistrationLocale | undefined) ?? null,
    },
  };
}

/** `POST /api/account/register/:token/complete`: the password only (the name was fixed at registration). */
export function checkCompleteBody(raw: unknown): Checked<CompleteInput> {
  const body = bodyObject(raw);
  const violations = violationsOf({ password: passwordShapeProblem(body['password']) }, unknownFields(body, COMPLETE_FIELDS));
  if (violations) return { ok: false, violations };
  return { ok: true, value: { password: body['password'] as string } };
}
