import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** Password policy (NIST-style: length over composition rules). */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
/** The first academy admin is created out of band, so it gets a stricter minimum. */
export const BOOTSTRAP_PASSWORD_MIN_LENGTH = 12;

/** Returns the policy violations of a candidate password (empty when acceptable). */
export function passwordProblems(plain: string, minLength = PASSWORD_MIN_LENGTH): string[] {
  const problems: string[] = [];
  if (plain.length < minLength) problems.push(`at least ${minLength} characters`);
  if (plain.length > PASSWORD_MAX_LENGTH) problems.push(`at most ${PASSWORD_MAX_LENGTH} characters`);
  if (plain.trim().length === 0) problems.push('not only whitespace');
  return problems;
}

/**
 * Argon2id hashing (P9). Parameters follow the OWASP minimum recommendation
 * (19 MiB memory, 2 iterations, parallelism 1); raise them when the servers allow.
 */
@Injectable()
export class PasswordService {
  private static readonly OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  /** Hash of a random secret, used to keep "unknown user" and "wrong password" timings alike. */
  private dummyHash: Promise<string> | undefined;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, PasswordService.OPTIONS);
  }

  /** False for a wrong password or a malformed hash; never throws. */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** Burns the same CPU time as a real verification without revealing anything. */
  async verifyDummy(plain: string): Promise<void> {
    this.dummyHash ??= this.hash(`dummy-${Math.random().toString(36)}`);
    await this.verify(await this.dummyHash, plain);
  }
}
