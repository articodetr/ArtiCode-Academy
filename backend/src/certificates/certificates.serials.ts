import type { Prisma } from '../generated/prisma/client.js';
import { CERTIFICATE_SEQUENCE_KEY } from './certificates.policy.js';

/** Reserves `count` consecutive numbers of the year (D-R53); returns the first. The row stays locked until commit. */
export async function reserveCertificateSerials(tx: Prisma.TransactionClient, year: string, count: number): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: bigint }[]>`
    INSERT INTO number_sequences (key, period, last_value, updated_at)
    VALUES (${CERTIFICATE_SEQUENCE_KEY}, ${year}, ${count}::bigint, now())
    ON CONFLICT (key, period) DO UPDATE SET last_value = number_sequences.last_value + EXCLUDED.last_value, updated_at = now()
    RETURNING last_value`;
  return Number(rows[0]!.last_value) - count + 1;
}
