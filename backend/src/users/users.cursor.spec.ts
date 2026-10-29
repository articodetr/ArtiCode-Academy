import { UsersHttpException } from './users.errors.js';
import { decodeUserCursor, encodeUserCursor } from './users.cursor.js';

const ID = '019a3b2c-7d4e-7f80-9123-456789abcdef';

describe('users cursor', () => {
  it('round-trips the sort, order, key and id', () => {
    const byCreation = encodeUserCursor({ sort: 'createdAt', order: 'desc', key: null, id: ID });
    expect(byCreation).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeUserCursor(byCreation, 'createdAt', 'desc')).toEqual({ sort: 'createdAt', order: 'desc', key: null, id: ID });

    const byName = encodeUserCursor({ sort: 'fullName', order: 'asc', key: 'سارة أحمد', id: ID });
    expect(decodeUserCursor(byName, 'fullName', 'asc')).toEqual({ sort: 'fullName', order: 'asc', key: 'سارة أحمد', id: ID });
  });

  it('rejects a cursor used with another sort or order', () => {
    const cursor = encodeUserCursor({ sort: 'createdAt', order: 'desc', key: null, id: ID });
    for (const [sort, order] of [['createdAt', 'asc'], ['fullName', 'desc'], ['fullName', 'asc']] as const) {
      expect(() => decodeUserCursor(cursor, sort, order)).toThrow(UsersHttpException);
    }
  });

  it('rejects malformed, tampered and foreign cursors with cursor_invalid', () => {
    const cases = [
      'not-base64!!',
      '',
      Buffer.from('"a string"').toString('base64url'),
      Buffer.from('[1,"createdAt","desc",null]').toString('base64url'),
      Buffer.from('[2,"createdAt","desc",null,"' + ID + '"]').toString('base64url'),
      Buffer.from('[1,"createdAt","desc",null,"not-a-uuid"]').toString('base64url'),
      Buffer.from('[1,"createdAt","desc","unexpected-key","' + ID + '"]').toString('base64url'),
      Buffer.from('[1,"fullName","asc",null,"' + ID + '"]').toString('base64url'),
    ];
    for (const raw of cases) {
      let caught: unknown;
      try {
        decodeUserCursor(raw, raw.includes('fullName') ? 'fullName' : 'createdAt', raw.includes('"asc"') ? 'asc' : 'desc');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UsersHttpException);
      expect((caught as UsersHttpException).code).toBe('cursor_invalid');
      expect((caught as UsersHttpException).getStatus()).toBe(400);
    }
  });
});
