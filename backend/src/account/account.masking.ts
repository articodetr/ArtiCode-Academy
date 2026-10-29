// Identifiers shown on the public invitation preview are masked: the link
// holder learns which account the link activates without the page becoming an
// oracle for full addresses. Pure functions, unit-tested in account.masking.spec.ts.

/** `sara@example.test` → `s***@example.test`; a malformed value becomes `***`. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) return '***';
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

/** `sara.ahmed` → `sa***`; shorter than 3 characters → `***`. */
export function maskUsername(username: string): string {
  if (username.length < 3) return '***';
  return `${username.slice(0, 2)}***`;
}
