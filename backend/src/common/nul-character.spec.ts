import { HttpException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { parse as parseQuery } from 'node:querystring';
import { describe, expect, it, vi } from 'vitest';
import { NUL_CHARACTER, NUL_CHARACTER_CODE, containsNulCharacter, nulCharacterError, nulCharacterLocation, rejectNulCharacters } from './nul-character.js';

const NUL = NUL_CHARACTER;

describe('containsNulCharacter (KI-078, TEST-216)', () => {
  it('finds a NUL in a string value or a key at any depth, in objects and arrays', () => {
    expect(containsNulCharacter(`a${NUL}b`)).toBe(true);
    expect(containsNulCharacter({ a: { b: [1, true, null, { c: `x${NUL}` }] } })).toBe(true);
    expect(containsNulCharacter([['fine'], [[NUL]]])).toBe(true);
    expect(containsNulCharacter({ [`k${NUL}`]: 1 })).toBe(true);
    expect(containsNulCharacter({ a: [{ ok: 1 }, { [NUL]: null }] })).toBe(true);
    // JSON.parse makes `__proto__` an own key: it is read like any other.
    expect(containsNulCharacter(JSON.parse('{"__proto__":{"x":"\\u0000"}}'))).toBe(true);
  });

  it('passes everything else: other control characters, the escaped text, numbers, booleans, null, empty containers', () => {
    for (const value of [undefined, null, 0, 1.5, true, '', 'fine', '\\u0000', '\u0001\t\n', '\u{1F600}', [], {}, { a: [1, 2, { b: 'ok' }] }, JSON.parse('{"\\\\u0000":"\\\\u0000"}')]) {
      expect(containsNulCharacter(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('skips binary views: a Buffer is not text', () => {
    expect(containsNulCharacter({ file: Buffer.from([0, 0, 0]) })).toBe(false);
  });

  it('reads the query objects of node:querystring (null prototype, repeated keys as arrays)', () => {
    expect(containsNulCharacter(parseQuery('q=%00'))).toBe(true);
    expect(containsNulCharacter(parseQuery('a%00b=1'))).toBe(true);
    expect(containsNulCharacter(parseQuery('q=ok&q=%00'))).toBe(true);
    expect(containsNulCharacter(parseQuery('q=%2500&x=%01'))).toBe(false);
  });

  it('is iterative: a value nested 200,000 levels deep is scanned without overflowing the stack', () => {
    const depth = 200_000;
    const leafWith = JSON.parse(`${'['.repeat(depth)}"\\u0000"${']'.repeat(depth)}`);
    const leafWithout = JSON.parse(`${'{"a":'.repeat(depth)}"fine"${'}'.repeat(depth)}`);
    expect(containsNulCharacter(leafWith)).toBe(true);
    expect(containsNulCharacter(leafWithout)).toBe(false);
  });
});

describe('nulCharacterLocation / nulCharacterError / rejectNulCharacters (KI-078, TEST-216)', () => {
  it('names the query first, then the body, else null', () => {
    expect(nulCharacterLocation({ query: { q: NUL }, body: { a: NUL } })).toBe('query');
    expect(nulCharacterLocation({ query: {}, body: { a: NUL } })).toBe('body');
    expect(nulCharacterLocation({ query: { q: 'fine' }, body: undefined })).toBeNull();
    expect(nulCharacterLocation({})).toBeNull();
  });

  it('answers 400 in the app shape, with the location and never the value', () => {
    const error = nulCharacterError('body');
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({ statusCode: 400, error: 'Bad Request', code: NUL_CHARACTER_CODE, message: expect.any(String), location: 'body' });
    expect((nulCharacterError('query').getResponse() as { location: string }).location).toBe('query');
  });

  it('the middleware passes a clean request on and hands a NUL to the exception layer', () => {
    const response = {} as Response;
    const clean = vi.fn<(error?: unknown) => void>();
    rejectNulCharacters({ query: { q: 'fine' }, body: { a: 'fine' } } as unknown as Request, response, clean as unknown as NextFunction);
    expect(clean).toHaveBeenCalledExactlyOnceWith();

    const refused = vi.fn<(error?: unknown) => void>();
    rejectNulCharacters({ query: {}, body: { a: NUL } } as unknown as Request, response, refused as unknown as NextFunction);
    expect(refused).toHaveBeenCalledOnce();
    const [error] = refused.mock.calls[0]!;
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({ code: NUL_CHARACTER_CODE, location: 'body' });
  });
});
