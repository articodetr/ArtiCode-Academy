-- CreateEnum
CREATE TYPE "identity_provider" AS ENUM ('google');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "subject_id" UUID;

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" VARCHAR(16) NOT NULL,
    "name" JSONB NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "provider" "identity_provider" NOT NULL,
    "provider_subject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(320),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subjects_code_key" ON "subjects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_subjects_sort_order" ON "subjects"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_identities_provider_subject" ON "user_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_identities_user_provider" ON "user_identities"("user_id", "provider");

-- CreateIndex
CREATE INDEX "courses_subject_id_idx" ON "courses"("subject_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written (PORTAL-04): what Prisma cannot express. Every CHECK is written
-- so that it cannot evaluate to NULL (a NULL CHECK lets the row through).
-- ---------------------------------------------------------------------------

-- Reordering swaps sort_order values inside one transaction (as for levels,
-- ADR-046): the order unique becomes a DEFERRABLE constraint with the same name.
-- A deferrable constraint cannot be an ON CONFLICT arbiter.
DROP INDEX "uq_subjects_sort_order";
ALTER TABLE "subjects" ADD CONSTRAINT "uq_subjects_sort_order"
    UNIQUE ("sort_order") DEFERRABLE INITIALLY DEFERRED;

-- subjects
ALTER TABLE "subjects" ADD CONSTRAINT "ck_subjects_code_trimmed"
    CHECK ("code" = btrim("code") AND "code" <> '');
ALTER TABLE "subjects" ADD CONSTRAINT "ck_subjects_name_localized"
    CHECK (jsonb_typeof("name") = 'object' AND "name" ? 'ar');
ALTER TABLE "subjects" ADD CONSTRAINT "ck_subjects_sort_order_nonnegative"
    CHECK ("sort_order" >= 0);

-- user_identities: a real subject, and a reported e-mail stored trimmed and lower-cased.
ALTER TABLE "user_identities" ADD CONSTRAINT "ck_user_identities_subject_trimmed"
    CHECK ("provider_subject" = btrim("provider_subject") AND "provider_subject" <> '');
ALTER TABLE "user_identities" ADD CONSTRAINT "ck_user_identities_email_normalized"
    CHECK ("email" IS NULL OR ("email" = lower(btrim("email")) AND "email" <> ''));
