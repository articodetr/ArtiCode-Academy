// PORTAL-03 (#207, the agreed contract v2): the pure rules of a visitor creating their own student account — the
// body checks of the three public routes in the problem codes of `400 registration_invalid`, with every problem under
// its own field and every unexpected field named in `unknown` (the global ValidationPipe never sees these bodies, so
// the refusal always has the contract's shape). A length is counted in characters as a person sees them (code points),
// as the frontend's mirror does (`frontend/src/studentRegistration/registration.rules.ts` — keep them in step).
// No Nest, no Prisma: unit-tested in registration.rules.spec.ts.
import { isEmail } from 'class-validator';
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
export const REGISTER_FIELDS = ['fullName', 'email', 'locale'] as const;
export const COMPLETE_FIELDS = ['password', 'fullName'] as const;

/** The details of `400 registration_invalid`: `fields` holds only the fields with a problem; both keys are always present. */
export interface RegistrationViolations {
  fields: Record<string, RegistrationProblem[]>;
  unknown: string[];
}

export type Checked<T> = { ok: true; value: T } | { ok: false; violations: RegistrationViolations };

/** A valid `POST /api/account/register` body, normalised: the name trimmed, the address trimmed and lower-cased. */
export interface RegisterInput {
  fullName: string;
  email: string;
  locale: RegistrationLocale | null;
}

/** A `POST /api/account/register/:token/complete` body whose shape is valid (the password policy comes after). */
export interface CompleteInput {
  password: string;
  /** The trimmed new name, or null when the visitor kept the stored one. */
  fullName: string | null;
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

/** The password must be a non-empty string here; its policy (`password_weak`) is checked by the service. */
export function passwordShapeProblem(value: unknown): RegistrationProblem | null {
  if (value === undefined || value === '') return 'required';
  return typeof value === 'string' ? null : 'invalid_format';
}

/**
 * THE rule of a self-registered account whose holder has not opened the e-mailed link yet: `pending` and without a
 * password. Nothing else creates such a row (POST /api/users creates `invited`, Google sign-up `active`), and it reads
 * the row alone — no token history (old tokens are pruned by the maintenance command), no migration. Every path that
 * treats such an account specially uses it: the registration routes (a fresh link, completion), the sign-in (401
 * `invalid_credentials`, like an unknown address), the admin `activate` (409 — only `delete` applies) and the Google
 * sign-in (links and activates it). A soft-deleted row is each caller's own check.
 */
export function isPendingSelfRegistration(user: { status: string; passwordHash: string | null }): boolean {
  return user.status === 'pending' && user.passwordHash === null;
}

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

/** `POST /api/account/register`: a body that is not a JSON object reads as an empty one (both fields required). */
export function checkRegisterBody(raw: unknown): Checked<RegisterInput> {
  const body = bodyObject(raw);
  const violations = violationsOf(
    { fullName: fullNameProblem(body['fullName']), email: emailProblem(body['email']), locale: localeProblem(body['locale']) },
    unknownFields(body, REGISTER_FIELDS),
  );
  if (violations) return { ok: false, violations };
  return {
    ok: true,
    value: {
      fullName: (body['fullName'] as string).trim(),
      email: normalizeRegistrationEmail(body['email'] as string),
      locale: (body['locale'] as RegistrationLocale | undefined) ?? null,
    },
  };
}

/** `POST /api/account/register/:token/complete`: `fullName` is optional, `password` required. */
export function checkCompleteBody(raw: unknown): Checked<CompleteInput> {
  const body = bodyObject(raw);
  const violations = violationsOf(
    {
      password: passwordShapeProblem(body['password']),
      fullName: Object.hasOwn(body, 'fullName') ? fullNameProblem(body['fullName']) : null,
    },
    unknownFields(body, COMPLETE_FIELDS),
  );
  if (violations) return { ok: false, violations };
  const fullName = body['fullName'];
  return {
    ok: true,
    value: { password: body['password'] as string, fullName: typeof fullName === 'string' ? fullName.trim() : null },
  };
}
