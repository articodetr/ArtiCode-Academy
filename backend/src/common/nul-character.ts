// KI-078 — no NUL character (U+0000) reaches the application. PostgreSQL
// stores none: a text parameter that holds one fails with SQLSTATE 22021 and a
// jsonb value with 22P05, so a request carrying one used to end in a 500 once
// it reached a query. configureApp() registers rejectNulCharacters() after the
// JSON body parsers, so every route of the academy API and of the platform API
// answers `400 nul_character` before any guard, pipe or controller runs.
//
// Where a NUL can come from: the JSON body (written `\u0000` in a string or a
// key — JSON.parse refuses a raw control character) and the query string
// (`%00`). Node's HTTP parser already answers 400 to a raw NUL byte in the
// request line or a header, and every path parameter is validated (a uuid, a
// token or a code pattern) before it is used.
import { HttpException, HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';

export const NUL_CHARACTER = '\u0000';

/** The stable `code` of the answer. */
export const NUL_CHARACTER_CODE = 'nul_character';

/** Where the NUL was found: the JSON body or the query string — never the value itself. */
export type NulCharacterLocation = 'body' | 'query';

export interface NulCharacterErrorBody {
  statusCode: number;
  error: string;
  code: typeof NUL_CHARACTER_CODE;
  message: string;
  location: NulCharacterLocation;
}

/**
 * True when a string anywhere in `value` — a string value or an object key, at
 * any depth — holds a NUL. Iterative (an explicit stack, no recursion), so a
 * body nested tens of thousands of levels deep cannot overflow the call stack,
 * and linear in the size of the input: each string is read once by the native
 * `includes`. Binary views (a Buffer) are not text and are skipped; JSON.parse
 * and the query parser build no cycles.
 */
export function containsNulCharacter(value: unknown): boolean {
  if (typeof value === 'string') return value.includes(NUL_CHARACTER);
  if (typeof value !== 'object' || value === null) return false;
  const pending: object[] = [value];
  /** A string answers at once; an object waits on the stack; anything else is no text. */
  const holdsNul = (item: unknown): boolean => {
    if (typeof item === 'string') return item.includes(NUL_CHARACTER);
    if (typeof item === 'object' && item !== null) pending.push(item);
    return false;
  };
  while (pending.length > 0) {
    const container = pending.pop()!;
    if (Array.isArray(container)) {
      for (const item of container) if (holdsNul(item)) return true;
    } else if (!ArrayBuffer.isView(container)) {
      const record = container as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (key.includes(NUL_CHARACTER) || holdsNul(record[key])) return true;
      }
    }
  }
  return false;
}

/** Where a request carries a NUL — its parsed query, then its parsed JSON body — or null. */
export function nulCharacterLocation(request: { query?: unknown; body?: unknown }): NulCharacterLocation | null {
  if (containsNulCharacter(request.query)) return 'query';
  if (containsNulCharacter(request.body)) return 'body';
  return null;
}

/** The 400 in the shape of the module dictionaries: `{ statusCode, error, code, message, location }`. */
export function nulCharacterError(location: NulCharacterLocation): HttpException {
  const body: NulCharacterErrorBody = {
    statusCode: HttpStatus.BAD_REQUEST,
    error: STATUS_CODES[HttpStatus.BAD_REQUEST] ?? 'Bad Request',
    code: NUL_CHARACTER_CODE,
    message: `The request ${location === 'body' ? 'body' : 'query string'} contains a NUL character (U+0000), which is not accepted`,
    location,
  };
  return new HttpException(body, HttpStatus.BAD_REQUEST);
}

/**
 * Express middleware (configureApp(), after the JSON body parsers and CORS):
 * a request with a NUL goes on as the 400 above, through Nest's exception
 * layer like a body parser's 413, so no guard, pipe or controller sees it.
 * `req.query` is Express 5's getter (the `simple` parser — node:querystring),
 * the same object Nest's @Query() reads.
 */
export function rejectNulCharacters(request: Request, _response: Response, next: NextFunction): void {
  const location = nulCharacterLocation(request);
  if (location !== null) {
    next(nulCharacterError(location));
    return;
  }
  next();
}
