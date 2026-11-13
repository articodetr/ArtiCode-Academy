// The credential check of audit metadata (P11), shared by the academy
// AuditService and the platform's PlatformAuditService (MOD-18-T02). No
// framework or database imports, so the platform application can use it
// without loading the academy Prisma client.

const FORBIDDEN_METADATA_KEY = /(password|passwd|secret|token|hash|authorization|cookie)/i;

/** Rejects metadata that looks like it carries a credential (defense in depth). */
export function assertNoSecrets(metadata: Record<string, unknown> | null | undefined, path = 'metadata'): void {
  if (!metadata) return;
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEY.test(key)) {
      throw new Error(`audit metadata must not contain credentials (${path}.${key})`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      assertNoSecrets(value as Record<string, unknown>, `${path}.${key}`);
    }
  }
}
