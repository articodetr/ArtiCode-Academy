// Readable running numbers of MOD-11 (D-R61/D-R63) on the shared
// `number_sequences` table (6.7.4-F, created with MOD-10 — ADR-067): one row
// per key and year, reserved by one upsert inside the caller's transaction, so
// the row stays locked until the commit and no number is handed out twice.
import type { Prisma } from '../generated/prisma/client.js';

export const INVOICE_SEQUENCE_KEY = 'invoice';
export const RECEIPT_SEQUENCE_KEY = 'receipt';
export const INVOICE_NUMBER_PREFIX = 'INV';
export const RECEIPT_NUMBER_PREFIX = 'RCPT';

/** Reserves `count` consecutive numbers of `key` for `period`; returns the first. */
export async function reserveNumbers(tx: Prisma.TransactionClient, key: string, period: string, count: number): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: bigint }[]>`
    INSERT INTO number_sequences (key, period, last_value, updated_at)
    VALUES (${key}, ${period}, ${count}::bigint, now())
    ON CONFLICT (key, period) DO UPDATE SET last_value = number_sequences.last_value + EXCLUDED.last_value, updated_at = now()
    RETURNING last_value`;
  return Number(rows[0]!.last_value) - count + 1;
}
