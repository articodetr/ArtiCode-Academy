// A random code for a new subject or level (CH-0372): `PREFIX-XXXX`, never one already in the list. The user may still
// type their own; the server stays the judge of uniqueness (`subject_code_taken` / `level_code_taken` on the field).
// Letters and digits only, without the look-alikes 0/O and 1/I/L, so a code read aloud or copied by hand stays clear.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const BODY_LENGTH = 4
const MAX_TRIES = 200

/** A random index in [0, n), from the browser's crypto when it has one. */
function randomIndex(n: number, random?: () => number): number {
  if (random) return Math.floor(random() * n)
  const cryptoApi = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoApi?.getRandomValues) {
    const buffer = new Uint32Array(1)
    cryptoApi.getRandomValues(buffer)
    return buffer[0]! % n
  }
  return Math.floor(Math.random() * n)
}

/**
 * `PREFIX-XXXX` that is not in `taken` (compared upper-case). With 31⁴ ≈ 923,000 bodies a repeat is rare; after
 * MAX_TRIES clashes the body grows by one character, so the loop always ends.
 */
export function generateUniqueCode(prefix: string, taken: Iterable<string>, random?: () => number): string {
  const used = new Set([...taken].map((code) => code.trim().toUpperCase()))
  let length = BODY_LENGTH
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0 && attempt % MAX_TRIES === 0) length += 1
    let body = ''
    for (let i = 0; i < length; i++) body += ALPHABET[randomIndex(ALPHABET.length, random)]
    const code = `${prefix}-${body}`
    if (!used.has(code)) return code
  }
}

export const SUBJECT_CODE_PREFIX = 'SUB'
export const LEVEL_CODE_PREFIX = 'LVL'
