-- AlterEnum
ALTER TYPE "token_purpose" ADD VALUE 'mfa_challenge';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled_at" TIMESTAMPTZ(6),
ADD COLUMN     "mfa_last_step" BIGINT,
ADD COLUMN     "mfa_pending_at" TIMESTAMPTZ(6),
ADD COLUMN     "mfa_pending_secret" TEXT,
ADD COLUMN     "mfa_secret" TEXT;

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_code_hash_key" ON "mfa_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-01-H06 / MFA-T01 — roadmap §4n; decisions
-- D-R105..D-R112 by the owner's delegation, CH-0279; master doc section 06).
-- CHECKs Prisma cannot express; Prisma Migrate keeps this SQL verbatim. No role
-- names, no data, no extension. TOTP itself, the sealing of the secret
-- (AES-256-GCM, AUTH_MFA_ENCRYPTION_KEY — D-R107), the 10-minute life of a
-- pending setup and the login challenge (`verification_tokens`, purpose
-- `mfa_challenge`) stay service rules (MFA-T02..T04). Every CHECK below is
-- written so that it can never evaluate to NULL (a NULL result would let the
-- row through). The new enum value is not used here: PostgreSQL forbids using
-- a value added by ALTER TYPE ... ADD VALUE inside the same transaction.
-- ---------------------------------------------------------------------------

-- users
-- MFA is on exactly when a sealed secret and its enabling instant are both set (D-R108).
ALTER TABLE "users" ADD CONSTRAINT "ck_users_mfa_enabled"
    CHECK (("mfa_secret" IS NULL) = ("mfa_enabled_at" IS NULL));
-- A setup not confirmed yet carries its sealed secret and its start together (10 minutes — a service rule).
ALTER TABLE "users" ADD CONSTRAINT "ck_users_mfa_pending"
    CHECK (("mfa_pending_secret" IS NULL) = ("mfa_pending_at" IS NULL));
-- The replay guard (the last accepted TOTP step) exists only while MFA is on, and a step is never negative.
ALTER TABLE "users" ADD CONSTRAINT "ck_users_mfa_last_step"
    CHECK ("mfa_last_step" IS NULL OR ("mfa_secret" IS NOT NULL AND "mfa_last_step" >= 0));
-- Both secrets are stored sealed only, `v<version>.<iv>.<ciphertext>.<tag>` in base64url (D-R107): never a bare Base32 secret.
ALTER TABLE "users" ADD CONSTRAINT "ck_users_mfa_secret_format"
    CHECK ("mfa_secret" IS NULL OR "mfa_secret" ~ '^v[0-9]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$');
ALTER TABLE "users" ADD CONSTRAINT "ck_users_mfa_pending_secret_format"
    CHECK ("mfa_pending_secret" IS NULL OR "mfa_pending_secret" ~ '^v[0-9]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$');

-- mfa_recovery_codes
-- Only the SHA-256 of a code is stored, as 64 lower-case hex characters — never the code itself.
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "ck_mfa_recovery_codes_hash_format"
    CHECK ("code_hash" ~ '^[0-9a-f]{64}$');
-- A code is spent at most once, and never before it was issued.
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "ck_mfa_recovery_codes_used_after_created"
    CHECK ("used_at" IS NULL OR "used_at" >= "created_at");