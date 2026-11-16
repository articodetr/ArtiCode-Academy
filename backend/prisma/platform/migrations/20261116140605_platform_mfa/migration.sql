-- AlterTable
ALTER TABLE "platform_users" ADD COLUMN     "mfa_enabled_at" TIMESTAMPTZ(6),
ADD COLUMN     "mfa_last_step" BIGINT,
ADD COLUMN     "mfa_pending_at" TIMESTAMPTZ(6),
ADD COLUMN     "mfa_pending_secret" TEXT,
ADD COLUMN     "mfa_secret" TEXT;

-- CreateTable
CREATE TABLE "platform_mfa_recovery_codes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_mfa_challenges" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_mfa_recovery_codes_code_hash_key" ON "platform_mfa_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "platform_mfa_recovery_codes_user_id_idx" ON "platform_mfa_recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_mfa_challenges_token_hash_key" ON "platform_mfa_challenges"("token_hash");

-- CreateIndex
CREATE INDEX "platform_mfa_challenges_user_id_idx" ON "platform_mfa_challenges"("user_id");

-- AddForeignKey
ALTER TABLE "platform_mfa_recovery_codes" ADD CONSTRAINT "platform_mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_mfa_challenges" ADD CONSTRAINT "platform_mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (PMFA-T01 — roadmap §4o; decisions D-R113..D-R120; master
-- doc section 06). CHECKs Prisma cannot express; Prisma Migrate keeps this SQL
-- verbatim. No role names, no data, no extension. TOTP itself, the sealing of
-- the secret (AES-256-GCM, PLATFORM_MFA_ENCRYPTION_KEY), the 10-minute life of
-- a pending setup and the 5-minute life of a sign-in challenge stay service
-- rules. The same shape as the academy migration 20261116123656_mfa_totp. Every
-- CHECK below is written so that it can never evaluate to NULL (a NULL result
-- would let the row through), and none compares a column the application
-- stamps (`expires_at`, `consumed_at`, `mfa_*_at`) with one the database stamps
-- (`created_at`): the two clocks are not the same machine. For the same reason
-- the academy's "used after created" CHECK of the recovery codes is not copied.
-- ---------------------------------------------------------------------------

-- platform_users
-- MFA is on exactly when a sealed secret and its enabling instant are both set.
ALTER TABLE "platform_users" ADD CONSTRAINT "ck_platform_users_mfa_enabled"
    CHECK (("mfa_secret" IS NULL) = ("mfa_enabled_at" IS NULL));
-- A setup not confirmed yet carries its sealed secret and its start together (10 minutes — a service rule).
ALTER TABLE "platform_users" ADD CONSTRAINT "ck_platform_users_mfa_pending"
    CHECK (("mfa_pending_secret" IS NULL) = ("mfa_pending_at" IS NULL));
-- The replay guard (the last accepted TOTP step) exists only while MFA is on, and a step is never negative.
ALTER TABLE "platform_users" ADD CONSTRAINT "ck_platform_users_mfa_last_step"
    CHECK ("mfa_last_step" IS NULL OR ("mfa_secret" IS NOT NULL AND "mfa_last_step" >= 0));
-- Both secrets are stored sealed only, `v<version>.<iv>.<ciphertext>.<tag>` in base64url: never a bare Base32 secret.
ALTER TABLE "platform_users" ADD CONSTRAINT "ck_platform_users_mfa_secret_format"
    CHECK ("mfa_secret" IS NULL OR "mfa_secret" ~ '^v[0-9]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$');
ALTER TABLE "platform_users" ADD CONSTRAINT "ck_platform_users_mfa_pending_secret_format"
    CHECK ("mfa_pending_secret" IS NULL OR "mfa_pending_secret" ~ '^v[0-9]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$');

-- platform_mfa_recovery_codes
-- Only the keyed SHA-256 of a code is stored, as 64 lower-case hex characters — never the code itself.
ALTER TABLE "platform_mfa_recovery_codes" ADD CONSTRAINT "ck_platform_mfa_recovery_codes_hash_format"
    CHECK ("code_hash" ~ '^[0-9a-f]{64}$');

-- platform_mfa_challenges
-- Only the SHA-256 of a challenge is stored, as 64 lower-case hex characters — never the challenge itself.
ALTER TABLE "platform_mfa_challenges" ADD CONSTRAINT "ck_platform_mfa_challenges_hash_format"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
-- The wrong factors tried on one challenge: 0..5 (PLATFORM_MFA_CHALLENGE_MAX_ATTEMPTS — the fifth consumes it).
ALTER TABLE "platform_mfa_challenges" ADD CONSTRAINT "ck_platform_mfa_challenges_attempts"
    CHECK ("attempts" BETWEEN 0 AND 5);
